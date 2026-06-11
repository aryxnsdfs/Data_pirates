/**
 * CLIENT-SIDE PREPROCESSING (browser ffmpeg.wasm + pdfjs)
 *
 * Mirrors server-side preprocessor.js but runs entirely in the browser so the
 * big source file NEVER gets uploaded. Only the small extracted parts (frames,
 * audio samples, PDF text) are sent to the cloud server. This is what makes a
 * cloud-hosted site feel instant on a 429MB video — there is no 429MB upload.
 *
 * Output shapes match what server.js buildGeminiParts() expects:
 *   video: { type:'video', frames[], allFrames[], audioSamples[], duration, originalName }
 *   audio: { type:'audio', audioSamples[], duration, originalName }
 *   pdf:   { type:'pdf_text', text, pageCount, originalName }
 *   image: { type:'image', inline:{inlineData}, originalName }
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const SAMPLE_SEC = 15; // must match server SAMPLE_SEC

// ─── Lazy singleton FFmpeg loader (single-thread core, no COOP/COEP needed) ──
let _ffmpeg = null;
let _loadPromise = null;

async function getFFmpeg() {
  if (_ffmpeg) return _ffmpeg;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    _ffmpeg = ffmpeg;
    return ffmpeg;
  })();

  return _loadPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Uint8Array → base64 (chunked to avoid call-stack overflow on large buffers)
function toBase64(uint8) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Read duration cheaply via a media element (no ffmpeg decode needed)
function getMediaDuration(file, kind = 'video') {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    const url = URL.createObjectURL(file);
    const cleanup = () => { URL.revokeObjectURL(url); };
    el.onloadedmetadata = () => {
      const d = el.duration && isFinite(el.duration) ? el.duration : 0;
      cleanup();
      resolve(d);
    };
    el.onerror = () => { cleanup(); resolve(0); };
    el.src = url;
  });
}

const ext = (name) => (name.split('.').pop() || '').toLowerCase();

async function safeReadDelete(ffmpeg, name) {
  const data = await ffmpeg.readFile(name);
  try { await ffmpeg.deleteFile(name); } catch {}
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

// ─── VIDEO ───────────────────────────────────────────────────────────────

async function preprocessVideoClient(file, onProgress) {
  const ffmpeg = await getFFmpeg();
  const duration = await getMediaDuration(file, 'video');
  if (!duration || duration <= 0) throw new Error('Could not read video duration');

  // Frame counts — mirror server preprocessor.js
  let numLocalFrames;
  if      (duration < 30)    numLocalFrames = Math.max(6, Math.floor(duration / 4));
  else if (duration < 300)   numLocalFrames = 20;
  else if (duration < 900)   numLocalFrames = 30;
  else if (duration < 1800)  numLocalFrames = 40;
  else if (duration < 3600)  numLocalFrames = 40;
  else                       numLocalFrames = 35;

  let numGeminiFrames;
  if      (duration < 60)    numGeminiFrames = Math.min(numLocalFrames, 4);
  else if (duration < 300)   numGeminiFrames = 6;
  else if (duration < 1800)  numGeminiFrames = 7;
  else                       numGeminiFrames = 8;

  const inName = `in.${ext(file.originalname || file.name) || 'mp4'}`;
  onProgress?.(8);
  await ffmpeg.writeFile(inName, await fetchFile(file));
  onProgress?.(20);

  // Extract evenly-spaced frames in ONE pass via the fps filter
  const fps = (numLocalFrames / duration).toFixed(5);
  await ffmpeg.exec([
    '-i', inName,
    '-vf', `fps=${fps},scale=280:-2:flags=fast_bilinear`,
    '-q:v', '5', '-vsync', 'vfr',
    'frame_%04d.jpg',
  ]);
  onProgress?.(55);

  // Collect frames
  const interval = duration / numLocalFrames;
  const frames = [];
  for (let i = 1; i <= numLocalFrames + 2; i++) {
    const fname = `frame_${String(i).padStart(4, '0')}.jpg`;
    let data;
    try { data = await safeReadDelete(ffmpeg, fname); } catch { break; }
    if (!data || data.length < 400) continue;
    const ts = Math.min(Math.floor((i - 1) * interval), Math.floor(duration - 1));
    frames.push({
      part: { inlineData: { mimeType: 'image/jpeg', data: toBase64(data) } },
      timestamp: Math.max(0, ts),
    });
  }
  if (frames.length === 0) throw new Error('No frames extracted');

  // Pick the Gemini subset (first, evenly-spaced middle, last) — mirror server
  let geminiFrames;
  if (frames.length <= numGeminiFrames) {
    geminiFrames = frames.slice();
  } else {
    geminiFrames = [frames[0]];
    const step = (frames.length - 2) / (numGeminiFrames - 2);
    for (let i = 1; i < numGeminiFrames - 1; i++) geminiFrames.push(frames[Math.floor(i * step)]);
    geminiFrames.push(frames[frames.length - 1]);
  }
  onProgress?.(62);

  // Audio samples — mirror server table
  const audioSamples = await extractAudioSamples(ffmpeg, inName, duration, (p) => onProgress?.(62 + Math.round(p * 0.3)));

  try { await ffmpeg.deleteFile(inName); } catch {}
  onProgress?.(95);

  return {
    type: 'video',
    frames: geminiFrames,
    allFrames: frames,
    audioSamples,
    transcript: null,
    duration,
    originalName: file.originalname || file.name,
  };
}

// ─── AUDIO SAMPLING (shared by video + standalone audio) ─────────────────

async function extractAudioSamples(ffmpeg, inName, duration, onProgress) {
  const numSamples =
    duration <= 60   ? 2 :
    duration <= 300  ? 3 :
    duration <= 1800 ? 4 : 5;

  const interval = duration / numSamples;
  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const ts = Math.max(0, Math.floor(i * interval));
    const out = `as_${i}.mp3`;
    try {
      await ffmpeg.exec([
        '-ss', String(ts), '-t', String(SAMPLE_SEC), '-i', inName,
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '16k', out,
      ]);
      const data = await safeReadDelete(ffmpeg, out);
      if (data && data.length > 400) samples.push({ ts, data: toBase64(data) });
    } catch {}
    onProgress?.((i + 1) / numSamples);
  }
  return samples;
}

// ─── STANDALONE AUDIO ────────────────────────────────────────────────────

async function preprocessAudioClient(file, onProgress) {
  const ffmpeg = await getFFmpeg();
  const duration = await getMediaDuration(file, 'audio');
  if (!duration || duration <= 0) throw new Error('Could not read audio duration');

  const inName = `in_a.${ext(file.originalname || file.name) || 'mp3'}`;
  onProgress?.(10);
  await ffmpeg.writeFile(inName, await fetchFile(file));
  onProgress?.(35);

  let audioSamples;
  if (duration <= 180) {
    const out = 'full.mp3';
    await ffmpeg.exec(['-i', inName, '-ac', '1', '-ar', '16000', '-b:a', '24k', out]);
    const data = await safeReadDelete(ffmpeg, out);
    audioSamples = [{ ts: 0, data: toBase64(data), isFullAudio: true }];
  } else {
    audioSamples = await extractAudioSamples(ffmpeg, inName, duration, (p) => onProgress?.(35 + Math.round(p * 55)));
  }

  try { await ffmpeg.deleteFile(inName); } catch {}
  onProgress?.(95);

  return { type: 'audio', audioSamples, transcript: null, duration, originalName: file.originalname || file.name };
}

// ─── PDF (pdfjs text extraction) ─────────────────────────────────────────

async function preprocessPdfClient(file) {
  const pdfjsLib = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(' ');
    text += `\n[Page ${p}]\n${pageText}\n`;
  }
  text = text.trim();
  if (!text || text.length < 30) throw new Error('PDF has no extractable text');
  return { type: 'pdf_text', text, pageCount: pdf.numPages, originalName: file.originalname || file.name };
}

// ─── IMAGE (canvas resize) ───────────────────────────────────────────────

function preprocessImageClient(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxW = 1024;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(url);
        const base64 = dataUrl.split(',')[1];
        resolve({
          type: 'image',
          inline: { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          originalName: file.originalname || file.name,
        });
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// ─── DISPATCHER ──────────────────────────────────────────────────────────

const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'svg'];

async function preprocessOne(file, kind, onProgress) {
  const e = ext(file.name);
  const isImage = file.type?.startsWith('image/') || IMG_EXT.includes(e);
  if (kind === 'video') return preprocessVideoClient(file, onProgress);
  if (kind === 'audio') return preprocessAudioClient(file, onProgress);
  if (e === 'pdf' || file.type === 'application/pdf') return preprocessPdfClient(file);
  if (isImage) return preprocessImageClient(file);
  // pdf-field that's actually a pdf already handled; otherwise unsupported
  throw new Error(`Unsupported file for client preprocessing: ${file.name}`);
}

/**
 * Preprocess all uploaded files in the browser.
 * @param {{pdf:File[],audio:File[],video:File[]}} files
 * @param {(percent:number)=>void} onProgress  0..100
 * @returns {Promise<Array>} results array (server-compatible shapes)
 */
export async function preprocessAllClient(files, onProgress) {
  const entries = [];
  for (const kind of ['video', 'audio', 'pdf']) {
    for (const f of files[kind] || []) entries.push({ kind, file: f });
  }
  if (entries.length === 0) throw new Error('No files to process');

  const results = [];
  let done = 0;
  for (const { kind, file } of entries) {
    const base = Math.round((done / entries.length) * 100);
    const span = Math.round((1 / entries.length) * 100);
    const r = await preprocessOne(file, kind, (p) => {
      onProgress?.(Math.min(99, base + Math.round((p / 100) * span)));
    });
    if (r) results.push(r);
    done++;
    onProgress?.(Math.round((done / entries.length) * 100));
  }
  if (results.length === 0) throw new Error('Client preprocessing produced no results');
  return results;
}
