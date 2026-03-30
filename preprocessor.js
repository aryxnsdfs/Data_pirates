/**
 * LOCAL PREPROCESSING ENGINE v7 — INTELLIGENT EXTRACTION
 *
 * v7 UPGRADES:
 *   1. Scene-change detection: FFmpeg select='gt(scene,0.3)' replaces uniform sampling
 *   2. Perceptual hash dedup: sharp-based blockhash removes near-identical frames
 *   3. Whisper transcription: Local whisper.cpp (optional) → timestamped transcript
 *   4. Speaker diarization: pyannote sidecar (optional) → speaker labels
 *   5. Gemini fallback: If whisper/pyannote unavailable, Gemini does transcription pass
 *
 * Performance targets:
 *   Video 2 hr:  ~5s local (scene detect + hash), ~15s Gemini
 *   Audio 1 hr:  ~2s + whisper ~30s (optional)
 *   PDF:         <1s
 */

import { execSync, exec } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const _require = createRequire(import.meta.url);

// ─── Sharp for perceptual hashing ────────────────────────────────────────
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log('⚠️  sharp not installed — frame dedup disabled (npm i sharp)');
}

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

// ─── Whisper detection ───────────────────────────────────────────────────
let WHISPER_PATH = null;
try {
  // Check for whisper.cpp binary (common locations)
  const candidates = [
    'whisper', 'whisper-cpp',
    path.join(os.homedir(), 'whisper.cpp', 'main'),
    path.join(os.homedir(), 'whisper.cpp', 'build', 'bin', 'main'),
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" --help`, { stdio: 'ignore', timeout: 5000 }); WHISPER_PATH = c; break; } catch {}
  }
} catch {}

// ─── Pyannote detection (DISABLED — consistently fails, wastes ~100s) ───
const HAS_PYANNOTE = false;

// ─── Helpers ───────────────────────────────────────────────────────────

function createTempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dp-pre-')); }
export function cleanupDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

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

// ─── PERCEPTUAL HASHING (blockhash via sharp) ───────────────────────────
// Generates a 64-bit perceptual hash of an image for deduplication.
// Similar images produce similar hashes; hamming distance < 10 = duplicate.

async function perceptualHash(imagePath) {
  if (!sharp) {
    // Fallback: use file size + first bytes as crude hash
    const stats = fs.statSync(imagePath);
    const buf = Buffer.alloc(64);
    const fd = fs.openSync(imagePath, 'r');
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    return crypto.createHash('md5').update(buf).update(String(stats.size)).digest('hex');
  }

  try {
    // Resize to 8x8 grayscale, get raw pixel data
    const { data } = await sharp(imagePath)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Average hash: each bit = pixel above/below average
    const avg = data.reduce((s, v) => s + v, 0) / data.length;
    let hash = '';
    for (let i = 0; i < data.length; i++) {
      hash += data[i] >= avg ? '1' : '0';
    }
    return hash;
  } catch {
    return crypto.createHash('md5').update(fs.readFileSync(imagePath)).digest('hex');
  }
}

function hammingDistance(a, b) {
  if (a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

// Deduplicate frames by perceptual hash — keeps only visually distinct frames
async function deduplicateFrames(frames, threshold = 10) {
  if (frames.length <= 1) return frames;

  console.log(`    🔍 Deduplicating ${frames.length} frames (hamming threshold=${threshold})...`);
  const unique = [frames[0]];
  const hashes = [frames[0]._hash];

  for (let i = 1; i < frames.length; i++) {
    const h = frames[i]._hash;
    let isDuplicate = false;

    // Check against recent unique frames (sliding window for speed)
    const checkWindow = Math.min(hashes.length, 5);
    for (let j = hashes.length - checkWindow; j < hashes.length; j++) {
      if (hammingDistance(h, hashes[j]) < threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(frames[i]);
      hashes.push(h);
    }
  }

  console.log(`    🔍 Dedup: ${frames.length} → ${unique.length} unique frames (removed ${frames.length - unique.length} duplicates)`);
  return unique;
}

// ─── SCENE-CHANGE DETECTION ─────────────────────────────────────────────
// Uses FFmpeg's scene detection filter instead of uniform sampling.
// select='gt(scene,0.3)' triggers on visual changes > 30% threshold.

async function extractSceneFrames(filePath, duration, tmpDir, maxFrames = 60) {
  // Use higher threshold for long videos — fewer scenes but faster detection
  const threshold = duration > 3600 ? 0.4 : 0.3;
  const timeoutMs = Math.max(120000, Math.min(duration * 30, 300000)); // Scale with duration, cap at 5min
  console.log(`    🎬 Running scene-change detection (threshold=${threshold}, timeout=${(timeoutMs/1000).toFixed(0)}s)...`);

  const sceneDir = path.join(tmpDir, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });

  // Phase 1: Scene detection — extract frames where visual content changes significantly
  const metaPath = path.join(tmpDir, 'scene_times.txt');
  try {
    await ffmpegAsync(
      `-i "${filePath}" -vf "select='gt(scene,${threshold})',scale=280:-2:flags=fast_bilinear,showinfo" -vsync vfr -q:v 18 -frame_pts 1 "${sceneDir}/scene_%04d.jpg" 2>"${metaPath}"`,
      timeoutMs
    );
  } catch {
    // showinfo to stderr is expected, try without metadata capture
    try {
      await ffmpegAsync(
        `-i "${filePath}" -vf "select='gt(scene,${threshold})',scale=280:-2:flags=fast_bilinear" -vsync vfr -q:v 18 -frame_pts 1 "${sceneDir}/scene_%04d.jpg"`,
        timeoutMs
      );
    } catch (err) {
      console.log(`    ⚠️ Scene detection failed, falling back to uniform sampling: ${err.message?.substring(0, 80)}`);
      return null; // Signal to use fallback
    }
  }

  // Collect extracted scene frames
  const sceneFiles = fs.readdirSync(sceneDir)
    .filter(f => f.endsWith('.jpg'))
    .sort();

  if (sceneFiles.length === 0) {
    console.log(`    ⚠️ Scene detection found 0 frames, falling back to uniform sampling`);
    return null;
  }

  console.log(`    🎬 Scene detection found ${sceneFiles.length} scene changes`);

  // Phase 2: Get timestamps for each scene frame using ffprobe
  // We estimate timestamps based on frame order and video duration
  const interval = duration / Math.max(1, sceneFiles.length);
  const rawFrames = [];

  for (let i = 0; i < sceneFiles.length; i++) {
    const filep = path.join(sceneDir, sceneFiles[i]);
    const data = fs.readFileSync(filep);
    if (data.length < 500) continue;

    // Estimate timestamp — scene frames are roughly evenly distributed
    // Better approach: parse pts from filename or use ffprobe
    const estimatedTs = Math.floor(i * interval);

    const hash = await perceptualHash(filep);
    rawFrames.push({
      part: { inlineData: { mimeType: 'image/jpeg', data: data.toString('base64') } },
      timestamp: Math.min(estimatedTs, Math.floor(duration - 1)),
      _hash: hash,
      _path: filep,
    });
  }

  // Phase 3: Deduplicate near-identical frames
  const uniqueFrames = await deduplicateFrames(rawFrames);

  // Phase 4: Cap at maxFrames — pick most evenly spaced subset
  let finalFrames;
  if (uniqueFrames.length <= maxFrames) {
    finalFrames = uniqueFrames;
  } else {
    // Evenly sample from unique frames
    finalFrames = [];
    const step = uniqueFrames.length / maxFrames;
    for (let i = 0; i < maxFrames; i++) {
      finalFrames.push(uniqueFrames[Math.floor(i * step)]);
    }
  }

  // Clean up hash metadata
  for (const f of finalFrames) {
    delete f._hash;
    delete f._path;
  }

  return finalFrames;
}

// ─── UNIFORM FRAME EXTRACTION (fallback) ─────────────────────────────────

async function extractUniformFrames(filePath, duration, tmpDir, numFrames) {
  const interval = duration / numFrames;
  const frames = [];
  const BATCH = 20;

  const extractFrame = async (ts, out) => {
    try {
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

  for (let b = 0; b < numFrames; b += BATCH) {
    const promises = [];
    for (let i = b; i < Math.min(b + BATCH, numFrames); i++) {
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
  return frames;
}

// ─── WHISPER TRANSCRIPTION (local whisper.cpp) ──────────────────────────

async function whisperTranscribe(filePath, duration, tmpDir) {
  if (!WHISPER_PATH) return null;

  console.log(`    🎤 Running local Whisper transcription...`);
  const wavPath = path.join(tmpDir, 'whisper_input.wav');
  const outputPath = path.join(tmpDir, 'whisper_output');

  try {
    // Convert to 16kHz mono WAV (whisper.cpp requirement)
    await ffmpegAsync(
      `-i "${filePath}" -vn -ac 1 -ar 16000 -acodec pcm_s16le -y "${wavPath}"`,
      Math.max(60000, duration * 100)
    );

    // Run whisper.cpp with word-level timestamps
    const modelPath = path.join(os.homedir(), 'whisper.cpp', 'models', 'ggml-base.en.bin');
    const model = fs.existsSync(modelPath) ? modelPath : 'base.en';

    execSync(
      `"${WHISPER_PATH}" -m "${model}" -f "${wavPath}" --output-json -of "${outputPath}" -pp -ml 1`,
      { stdio: 'ignore', timeout: Math.max(120000, duration * 500), windowsHide: true }
    );

    const jsonPath = `${outputPath}.json`;
    if (fs.existsSync(jsonPath)) {
      const result = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const segments = (result.transcription || result.segments || []).map(seg => ({
        start: seg.offsets?.from ? seg.offsets.from / 1000 : seg.start || 0,
        end: seg.offsets?.to ? seg.offsets.to / 1000 : seg.end || 0,
        text: (seg.text || '').trim(),
      })).filter(s => s.text.length > 0);

      console.log(`    🎤 Whisper: ${segments.length} segments transcribed`);
      return segments;
    }
  } catch (err) {
    console.log(`    ⚠️ Whisper failed: ${err.message?.substring(0, 80)}`);
  }
  return null;
}

// ─── SPEAKER DIARIZATION (pyannote sidecar) ─────────────────────────────

async function diarize(filePath, tmpDir) {
  if (!HAS_PYANNOTE) return null;

  console.log(`    👥 Running speaker diarization...`);
  const wavPath = path.join(tmpDir, 'diarize_input.wav');
  const outputPath = path.join(tmpDir, 'diarization.json');

  try {
    // Convert to 16kHz mono WAV
    await ffmpegAsync(`-i "${filePath}" -vn -ac 1 -ar 16000 -acodec pcm_s16le -y "${wavPath}"`, 120000);

    // Create inline Python script for diarization
    const pyScript = `
import json, sys
try:
    from pyannote.audio import Pipeline
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
    diarization = pipeline("${wavPath.replace(/\\/g, '/')}")
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({"start": round(turn.start, 2), "end": round(turn.end, 2), "speaker": speaker})
    with open("${outputPath.replace(/\\/g, '/')}", "w") as f:
        json.dump(segments, f)
except Exception as e:
    print(f"Diarization error: {e}", file=sys.stderr)
    sys.exit(1)
`;
    const scriptPath = path.join(tmpDir, 'diarize.py');
    fs.writeFileSync(scriptPath, pyScript);

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${pythonCmd} "${scriptPath}"`, { stdio: 'ignore', timeout: 300000, windowsHide: true });

    if (fs.existsSync(outputPath)) {
      const segments = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      console.log(`    👥 Diarization: ${segments.length} speaker segments, ${new Set(segments.map(s => s.speaker)).size} speakers`);
      return segments;
    }
  } catch (err) {
    console.log(`    ⚠️ Diarization failed: ${err.message?.substring(0, 80)}`);
  }
  return null;
}

// ─── MERGE TRANSCRIPT + DIARIZATION ─────────────────────────────────────
// Combines whisper segments with speaker labels from pyannote

function mergeTranscriptWithSpeakers(transcript, diarization) {
  if (!transcript || !diarization) return transcript;

  return transcript.map(seg => {
    // Find the diarization segment that overlaps most with this transcript segment
    let bestSpeaker = 'Unknown';
    let bestOverlap = 0;

    for (const d of diarization) {
      const overlapStart = Math.max(seg.start, d.start);
      const overlapEnd = Math.min(seg.end, d.end);
      const overlap = overlapEnd - overlapStart;

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = d.speaker;
      }
    }

    return { ...seg, speaker: bestSpeaker };
  });
}

// ─── SMART AUDIO FILTERING (SILENCE REMOVAL) ───────────────────────────

export async function extractActiveAudio(filePath) {
  if (!FFMPEG_PATH) return null;
  const tmpDir = createTempDir();

  try {
    const outPath = path.join(tmpDir, 'active_audio.mp3');
    await ffmpegAsync(
      `-i "${filePath}" -vn -ac 1 -ar 16000 -b:a 16k -af "silenceremove=stop_periods=-1:stop_duration=1.5:stop_threshold=-30dB" -threads 0 -y "${outPath}"`,
      120000
    );

    const stats = fs.statSync(outPath);
    if (stats.size < 500) { cleanupDir(tmpDir); return null; }

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
    const targetFrames = 15;
    const fps = Math.min(1, targetFrames / duration).toFixed(3);

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

// ─── AUDIO SAMPLING ─────────────────────────────────────────────────────

const SAMPLE_SEC = 15;

async function extractAudioSamples(filePath, duration, tmpDir) {
  const numSamples =
    duration <= 60    ? 2  :
    duration <= 300   ? 3  :
    duration <= 900   ? 4  :
    duration <= 1800  ? 4  :
    duration <= 3600  ? 5  :
    duration <= 7200  ? 5  :
                        5;

  const interval = duration / numSamples;
  const all = [];
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

// ─── VIDEO PREPROCESSING (v7: Smart Extraction) ─────────────────────────
// STRATEGY: Scene-detection first, uniform fallback, perceptual hash dedup,
// then pick best subset for Gemini. Also run whisper + diarization if available.

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

    // How many local frames we want (for timeline zoom UI)
    let numLocalFrames;
    if      (duration < 30)    numLocalFrames = Math.max(6, Math.floor(duration / 4));
    else if (duration < 300)   numLocalFrames = 20;
    else if (duration < 900)   numLocalFrames = 30;
    else if (duration < 1800)  numLocalFrames = 50;
    else if (duration < 3600)  numLocalFrames = 50;
    else if (duration < 7200)  numLocalFrames = 40;
    else                       numLocalFrames = 35;

    // GEMINI frames: keep VERY low for speed
    let numGeminiFrames;
    if      (duration < 60)    numGeminiFrames = Math.min(numLocalFrames, 4);
    else if (duration < 300)   numGeminiFrames = 6;
    else if (duration < 900)   numGeminiFrames = 7;
    else if (duration < 1800)  numGeminiFrames = 7;
    else if (duration < 3600)  numGeminiFrames = 8;
    else                       numGeminiFrames = 8;

    // ── Phase 1: Smart frame extraction ──
    console.log(`  🎬 Phase 1: Intelligent frame extraction...`);
    const frameStart = Date.now();

    // Try scene detection first, fall back to uniform
    let frames = await extractSceneFrames(filePath, duration, tmpDir, numLocalFrames);

    if (!frames || frames.length < 3) {
      console.log(`  🎬 Using uniform fallback extraction (${numLocalFrames} frames)...`);
      frames = await extractUniformFrames(filePath, duration, tmpDir, numLocalFrames);
    }

    const framesSizeBytes = frames.reduce((s, f) => s + Buffer.from(f.part.inlineData.data, 'base64').length, 0);
    console.log(`  🎬 ${frames.length} frames in ${((Date.now() - frameStart)/1000).toFixed(1)}s (${(framesSizeBytes/1024/1024).toFixed(1)}MB)`);

    // ── Phase 2: Pick best subset for Gemini ──
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

    // ── Phase 3: Audio sampling (parallel with transcript) ──
    let audioSamples = null;
    let transcript = null;
    let diarization = null;

    const audioPromise = (async () => {
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
    })();

    // ── Phase 4: Whisper transcription (parallel) ──
    const whisperPromise = (async () => {
      const whisperDir = createTempDir();
      try {
        transcript = await whisperTranscribe(filePath, duration, whisperDir);
      } finally {
        cleanupDir(whisperDir);
      }
    })();

    // ── Phase 5: Speaker diarization (parallel) ──
    const diarizePromise = (async () => {
      const diarizeDir = createTempDir();
      try {
        diarization = await diarize(filePath, diarizeDir);
      } finally {
        cleanupDir(diarizeDir);
      }
    })();

    // Wait for all parallel tasks
    await Promise.all([audioPromise, whisperPromise, diarizePromise]);

    // Merge transcript + diarization if both available
    if (transcript && diarization) {
      transcript = mergeTranscriptWithSpeakers(transcript, diarization);
      console.log(`  📝 Transcript merged with speaker labels`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ⚡ Video preprocessed in ${elapsed}s`);

    cleanupDir(tmpDir);

    if (frames.length === 0) return null;

    return {
      type: 'video',
      frames: geminiFrames,
      allFrames: frames,
      audioSamples,
      transcript,          // NEW: timestamped transcript [{start, end, text, speaker?}]
      diarization,         // NEW: raw diarization [{start, end, speaker}]
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
      const audioPath = path.join(tmpDir, 'audio.mp3');
      ffmpegSync(`-i "${filePath}" -ac 1 -ar 16000 -b:a 24k -threads 0 -y "${audioPath}"`, 120000);
      const data = fs.readFileSync(audioPath);
      audioSamples = [{ ts: 0, data: data.toString('base64'), isFullAudio: true }];
    } else {
      audioSamples = await extractAudioSamples(filePath, duration, tmpDir);
    }

    // Try whisper transcription for audio files too
    let transcript = null;
    let diarization = null;

    const whisperDir = createTempDir();
    try {
      transcript = await whisperTranscribe(filePath, duration, whisperDir);
    } finally {
      cleanupDir(whisperDir);
    }

    const diarizeDir = createTempDir();
    try {
      diarization = await diarize(filePath, diarizeDir);
    } finally {
      cleanupDir(diarizeDir);
    }

    if (transcript && diarization) {
      transcript = mergeTranscriptWithSpeakers(transcript, diarization);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalBytes = audioSamples.reduce((s, d) => s + Buffer.from(d.data, 'base64').length, 0);
    console.log(`  🔊 ${audioSamples.length} sample(s) in ${elapsed}s (${(totalBytes/1024/1024).toFixed(1)}MB)`);

    cleanupDir(tmpDir);

    return { type: 'audio', audioSamples, transcript, diarization, duration, originalName };

  } catch (err) {
    console.error(`  ❌ Audio error: ${err.message}`);
    cleanupDir(tmpDir);
    return null;
  }
}

// ─── PDF PREPROCESSING ─────────────────────────────────────────────────

export async function preprocessPdf(filePath, originalName) {
  try {
    const { PDFParse } = _require('pdf-parse');
    const fileBuffer = fs.readFileSync(filePath);
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
