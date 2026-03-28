/**
 * LOCAL PREPROCESSING ENGINE v6 — SPEED OPTIMIZED
 *
 * Strategy: Extract MANY frames locally (for timeline zoom), but only SEND
 * a subset to Gemini for AI analysis. This keeps the API payload tiny
 * while still having rich local data for the UI.
 *
 * Performance targets:
 *   Video 2 hr:  ~3s local, ~15s Gemini (was 160s)
 *   Audio 1 hr:  ~2s
 *   PDF:         <1s
 */

import { execSync, exec } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const _require = createRequire(import.meta.url);

let FFMPEG_PATH = null;
let FFPROBE_PATH = null;

try {
  const ffmpegStatic = await import('ffmpeg-static');
  FFMPEG_PATH = ffmpegStatic.default;
  if (FFMPEG_PATH) {
    const dir = path.dirname(FFMPEG_PATH);
    const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const probePath = path.join(dir, probeName);
    FFPROBE_PATH = fs.existsSync(probePath) ? probePath : null;
  }
} catch {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); FFMPEG_PATH = 'ffmpeg'; FFPROBE_PATH = 'ffprobe'; } catch {}
}

// ─── Helpers ───────────────────────────────────────────────────────────

function createTempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dp-pre-')); }
export function cleanupDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
// ─── SMART AUDIO FILTERING (SILENCE REMOVAL) ───────────────────────────

export async function extractActiveAudio(filePath) {
  if (!FFMPEG_PATH) return null;
  const tmpDir = createTempDir();
  
  try {
    const outPath = path.join(tmpDir, 'active_audio.mp3');
    // silenceremove: strips out any silence longer than 1.5s below -30dB
    // This creates a dense, speech-only file that Gemini can process instantly.
    await ffmpegAsync(
      `-i "${filePath}" -vn -ac 1 -ar 16000 -b:a 16k -af "silenceremove=stop_periods=-1:stop_duration=1.5:stop_threshold=-30dB" -threads 0 -y "${outPath}"`, 
      120000
    );
    
    const stats = fs.statSync(outPath);
    if (stats.size < 500) { cleanupDir(tmpDir); return null; } // No audio found
    
    const data = fs.readFileSync(outPath).toString('base64');
    cleanupDir(tmpDir);
    return data;
  } catch (err) {
    console.error(`Audio extraction failed:`, err.message);
    cleanupDir(tmpDir);
    return null;
  }
}
// ─── CUSTOM RANGE EXTRACTION ───────────────────────────────────────────

export async function extractCustomRange(filePath, startSec, endSec) {
  if (!FFMPEG_PATH) return null;
  const tmpDir = createTempDir();
  
  try {
    const outPath = path.join(tmpDir, 'range_clip.mp4');
    const duration = Math.max(1, endSec - startSec);

    // 🔥 TUNING TRICK 1: Dynamic FPS. Limit the clip to ~15 frames max. 
    // This cuts Gemini's visual token processing time from ~50s down to ~2s!
    const targetFrames = 15;
    const fps = Math.min(1, targetFrames / duration).toFixed(3);

    // 🔥 TUNING TRICK 2: Fast Seek (-ss before -i), precise duration (-t),
    // fast_bilinear scaling, and hyper-compressed mono audio.
    await ffmpegAsync(
      `-ss ${startSec} -t ${duration} -i "${filePath}" -vf "fps=${fps},scale=280:-2:flags=fast_bilinear" -crf 32 -preset ultrafast -c:a aac -b:a 16k -ac 1 -ar 16000 -threads 0 -y "${outPath}"`, 
      60000
    );
    
    const data = fs.readFileSync(outPath).toString('base64');
    cleanupDir(tmpDir);
    return data;
  } catch (err) {
    cleanupDir(tmpDir);
    return null;
  }
}
function ffmpegSync(args, timeout = 600000) {
  if (!FFMPEG_PATH) throw new Error('FFmpeg not available');
  execSync(`"${FFMPEG_PATH}" ${args}`, { stdio: 'ignore', timeout, windowsHide: true });
}

function ffmpegAsync(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const proc = exec(`"${FFMPEG_PATH}" ${args}`, { timeout, windowsHide: true }, (err) => {
      if (err) reject(err); else resolve();
    });
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', () => {});
  });
}

function getMediaDuration(filePath) {
  if (FFPROBE_PATH) {
    try {
      const result = execSync(
        `"${FFPROBE_PATH}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf-8', timeout: 15000, windowsHide: true }
      ).trim();
      const d = parseFloat(result);
      if (d > 0) return d;
    } catch {}
  }
  try {
    execSync(`"${FFMPEG_PATH}" -i "${filePath}"`, { stdio: 'pipe', timeout: 15000, windowsHide: true });
  } catch (e) {
    const out = (e.stderr || e.stdout || '').toString();
    const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  }
  return 0;
}

export function isPreprocessingAvailable() { return FFMPEG_PATH !== null; }

// ─── AUDIO SAMPLING ─────────────────────────────────────────────────────
// Extract short audio clips from evenly spaced positions.
// SPEED KEY: fewer, shorter samples = much smaller Gemini payload.

const SAMPLE_SEC = 15; // 15s per sample — short clips for fast Gemini processing

async function extractAudioSamples(filePath, duration, tmpDir) {
  // Fewer samples = faster Gemini. 6 × 25s = 2.5 min of audio for a 2hr video.
  const numSamples =
    duration <= 60    ? 2  :  // very short
    duration <= 300   ? 3  :  // < 5 min
    duration <= 900   ? 4  :  // < 15 min
    duration <= 1800  ? 5  :  // < 30 min
    duration <= 3600  ? 5  :  // < 1 hr
    duration <= 7200  ? 6  :  // 1-2 hr
                        7;    // 2 hr+

  const interval = duration / numSamples;
  const all = [];
  // Extract ALL samples in one parallel batch for speed
  const promises = [];
  for (let i = 0; i < numSamples; i++) {
    const ts = Math.max(0, Math.floor(i * interval));
    const out = path.join(tmpDir, `as${i}.mp3`);
    promises.push(
      ffmpegAsync(
        `-ss ${ts} -i "${filePath}" -t ${SAMPLE_SEC} -vn -ac 1 -ar 16000 -b:a 16k -threads 0 -y "${out}"`,
        20000
      ).then(() => ({ ts, out })).catch(() => null)
    );
  }
  const results = await Promise.all(promises);
  for (const r of results) {
    if (r && fs.existsSync(r.out) && fs.statSync(r.out).size > 500) {
      all.push({ ts: r.ts, data: fs.readFileSync(r.out).toString('base64') });
      try { fs.unlinkSync(r.out); } catch {}
    }
  }
  return all;
}

// ─── VIDEO PREPROCESSING ───────────────────────────────────────────────
// STRATEGY: Extract many frames locally (for zoom UI), but mark only a
// subset as "send to Gemini". The rest are saved as keyframes for the
// frontend timeline zoom feature.

export async function preprocessVideo(filePath, originalName) {
  if (!FFMPEG_PATH) return null;

  const tmpDir = createTempDir();
  const startTime = Date.now();

  try {
    console.log(`  🎬 Reading metadata...`);
    const duration = getMediaDuration(filePath);

    if (duration <= 0) { cleanupDir(tmpDir); return null; }

    const durationHrs = duration / 3600;
    const durationMin = duration / 60;
    const fileSizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(0);
    console.log(`  🎬 ${durationHrs >= 1 ? durationHrs.toFixed(1) + 'hr' : durationMin.toFixed(1) + 'min'} | ${fileSizeMB}MB`);

    // LOCAL frames: extract many for the zoom UI
    let numLocalFrames;
    if      (duration < 30)    numLocalFrames = Math.max(6, Math.floor(duration / 4));
    else if (duration < 300)   numLocalFrames = 20;
    else if (duration < 900)   numLocalFrames = 30;
    else if (duration < 1800)  numLocalFrames = 50;
    else if (duration < 3600)  numLocalFrames = 70;
    else if (duration < 7200)  numLocalFrames = 80;  // 2hr: one every ~1.5min
    else                       numLocalFrames = 60;

    // GEMINI frames: keep VERY low for speed (< 15s Gemini response)
    let numGeminiFrames;
    if      (duration < 60)    numGeminiFrames = Math.min(numLocalFrames, 4);
    else if (duration < 300)   numGeminiFrames = 6;
    else if (duration < 900)   numGeminiFrames = 7;
    else if (duration < 1800)  numGeminiFrames = 8;
    else if (duration < 3600)  numGeminiFrames = 9;
    else                       numGeminiFrames = 10;  // max 10 for 2hr+

    const interval = duration / numLocalFrames;
    console.log(`  🎬 Extracting ${numLocalFrames} frames locally (${numGeminiFrames} for AI)...`);

    // ── Parallel frame extraction ──
    const frames = [];
    const BATCH = 20;  // large batch for max speed
    const frameStart = Date.now();

    const extractFrame = async (ts, out) => {
      try {
        // Tiny images: 280px wide, high compression = tiny base64
        await ffmpegAsync(
          `-ss ${ts} -i "${filePath}" -frames:v 1 -vf "scale=280:-2:flags=fast_bilinear" -q:v 18 -threads 0 -y "${out}"`,
          60000
        );
        return { ts, out };
      } catch {
        try {
          await ffmpegAsync(`-ss ${ts} -i "${filePath}" -frames:v 1 -q:v 22 -threads 0 -y "${out}"`, 60000);
          return { ts, out };
        } catch { return null; }
      }
    };

    // Extract all frames in parallel batches
    for (let b = 0; b < numLocalFrames; b += BATCH) {
      const promises = [];
      for (let i = b; i < Math.min(b + BATCH, numLocalFrames); i++) {
        const ts = Math.floor(i * interval + 1);
        const out = path.join(tmpDir, `f${String(i).padStart(4, '0')}.jpg`);
        promises.push(extractFrame(ts, out));
      }
      const results = await Promise.all(promises);
      for (const r of results) {
        if (r && fs.existsSync(r.out)) {
          const data = fs.readFileSync(r.out);
          if (data.length > 500) {
            frames.push({
              part: { inlineData: { mimeType: 'image/jpeg', data: data.toString('base64') } },
              timestamp: r.ts,
            });
          }
        }
      }
    }

    const framesSizeBytes = frames.reduce((s, f) => s + Buffer.from(f.part.inlineData.data, 'base64').length, 0);
    console.log(`  🎬 ${frames.length} frames in ${((Date.now() - frameStart)/1000).toFixed(1)}s (${(framesSizeBytes/1024/1024).toFixed(1)}MB)`);

    // Pick evenly-spaced subset for Gemini
    const geminiFrames = [];
    if (frames.length <= numGeminiFrames) {
      geminiFrames.push(...frames);
    } else {
      geminiFrames.push(frames[0]);
      const step = (frames.length - 2) / (numGeminiFrames - 2);
      for (let i = 1; i < numGeminiFrames - 1; i++) {
        geminiFrames.push(frames[Math.floor(i * step)]);
      }
      geminiFrames.push(frames[frames.length - 1]);
    }
    console.log(`  🎬 Sending ${geminiFrames.length}/${frames.length} frames to AI`);

    // ── Audio: parallel sampling ──
    let audioSamples = null;
    try {
      console.log(`  🔊 Sampling audio...`);
      const audioStart = Date.now();
      const samples = await extractAudioSamples(filePath, duration, tmpDir);
      if (samples.length > 0) {
        const totalBytes = samples.reduce((s, d) => s + Buffer.from(d.data, 'base64').length, 0);
        console.log(`  🔊 ${samples.length} samples×${SAMPLE_SEC}s in ${((Date.now()-audioStart)/1000).toFixed(1)}s (${(totalBytes/1024/1024).toFixed(1)}MB)`);
        audioSamples = samples;
      }
    } catch (e) {
      console.log(`  🔊 No audio: ${e.message?.substring(0, 60)}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ⚡ Video preprocessed in ${elapsed}s`);

    cleanupDir(tmpDir);

    if (frames.length === 0) return null;

    return {
      type: 'video',
      frames: geminiFrames,      // subset for Gemini API
      allFrames: frames,          // ALL frames for local keyframe zoom
      audioSamples,
      duration,
      originalName,
    };

  } catch (err) {
    console.error(`  ❌ Video error: ${err.message}`);
    cleanupDir(tmpDir);
    return null;
  }
}

// ─── AUDIO PREPROCESSING ───────────────────────────────────────────────

export async function preprocessAudio(filePath, originalName) {
  if (!FFMPEG_PATH) return null;
  const tmpDir = createTempDir();
  const startTime = Date.now();

  try {
    const duration = getMediaDuration(filePath);
    console.log(`  🔊 Audio: ${(duration/60).toFixed(1)} min`);

    let audioSamples;

    if (duration <= 180) {
      // Short audio: full extraction
      const audioPath = path.join(tmpDir, 'audio.mp3');
      ffmpegSync(`-i "${filePath}" -ac 1 -ar 16000 -b:a 24k -threads 0 -y "${audioPath}"`, 120000);
      const data = fs.readFileSync(audioPath);
      audioSamples = [{ ts: 0, data: data.toString('base64'), isFullAudio: true }];
    } else {
      audioSamples = await extractAudioSamples(filePath, duration, tmpDir);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalBytes = audioSamples.reduce((s, d) => s + Buffer.from(d.data, 'base64').length, 0);
    console.log(`  🔊 ${audioSamples.length} sample(s) in ${elapsed}s (${(totalBytes/1024/1024).toFixed(1)}MB)`);

    cleanupDir(tmpDir);

    return { type: 'audio', audioSamples, duration, originalName };

  } catch (err) {
    console.error(`  ❌ Audio error: ${err.message}`);
    cleanupDir(tmpDir);
    return null;
  }
}

// ─── PDF PREPROCESSING ─────────────────────────────────────────────────

export async function preprocessPdf(filePath, originalName) {
  try {
    // pdf-parse v2.x: class-based API — new PDFParse({ data }) then .getText()
    const { PDFParse } = _require('pdf-parse');
    const fileBuffer = fs.readFileSync(filePath);
    // Convert Buffer → Uint8Array (required by pdf-parse v2)
    const uint8 = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    const parser = new PDFParse({ data: uint8 });
    const result = await parser.getText();
    const text = result.text?.trim();
    const pageCount = result.total || result.pages?.length || 0;
    if (text && text.length > 30) {
      console.log(`  ⚡ PDF: ${pageCount} pages, ${text.length} chars`);
      return { type: 'pdf_text', text, pageCount, originalName };
    }
    return null;
  } catch (err) {
    console.error(`  ❌ PDF error: ${err.message}`);
    return null;
  }
}

// ─── IMAGE PREPROCESSING ───────────────────────────────────────────────

export async function preprocessImage(filePath, originalName) {
  if (!FFMPEG_PATH) return null;
  const tmpDir = createTempDir();
  try {
    const originalSize = fs.statSync(filePath).size;
    if (originalSize < 500 * 1024) {
      const ext = path.extname(originalName).toLowerCase();
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
      cleanupDir(tmpDir);
      return { type: 'image', inline: { inlineData: { mimeType: mime[ext] || 'image/jpeg', data: fs.readFileSync(filePath).toString('base64') } }, originalName };
    }
    const out = path.join(tmpDir, 'img.jpg');
    ffmpegSync(`-i "${filePath}" -vf "scale='min(1024,iw)':-2:flags=lanczos" -q:v 5 -threads 0 -y "${out}"`, 30000);
    const data = fs.readFileSync(out);
    cleanupDir(tmpDir);
    return { type: 'image', inline: { inlineData: { mimeType: 'image/jpeg', data: data.toString('base64') } }, originalName };
  } catch {
    cleanupDir(tmpDir);
    return null;
  }
}

// ─── MAIN DISPATCHER ───────────────────────────────────────────────────

export async function preprocessFile(file, fileType) {
  const mime = file.mimetype || '';
  const ext = path.extname(file.originalname).toLowerCase();
  if (fileType === 'video' || mime.startsWith('video/')) return preprocessVideo(file.path, file.originalname);
  if (fileType === 'audio' || mime.startsWith('audio/')) return preprocessAudio(file.path, file.originalname);
  if (ext === '.pdf' || mime === 'application/pdf') return preprocessPdf(file.path, file.originalname);
  if (mime.startsWith('image/') || ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.heic','.svg'].includes(ext)) return preprocessImage(file.path, file.originalname);
  return null;
}
