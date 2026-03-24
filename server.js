import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isPreprocessingAvailable,
  preprocessFile,
  cleanupDir,
} from './preprocessor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// No timeout on the server for long uploads + analysis
app.use((req, res, next) => {
  req.setTimeout(0);
  res.setTimeout(0);
  next();
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const MIME_MAP = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv', '.m4v': 'video/mp4', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus', '.amr': 'audio/amr',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.tiff': 'image/tiff', '.tif': 'image/tiff', '.heic': 'image/heic',
  '.heif': 'image/heif', '.svg': 'image/svg+xml',
};

function getProperMimeType(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return MIME_MAP[ext] || file.mimetype || 'application/octet-stream';
}

// No file size limit — preprocessing compresses locally before any cloud upload
const upload = multer({ storage });

// Gemini AI setup
const ai = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_api_key_here'
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const ANALYSIS_PROMPT = `You are a forensic evidence analyst. Analyze ALL provided evidence (video frames, audio clips, and documents) together.

ABSOLUTE RULES FOR DESCRIPTIONS — VIOLATIONS WILL MAKE THE ANALYSIS USELESS:

1. NEVER EVER describe what things LOOK LIKE. No chairs, tables, desks, walls, rooms, screens, podiums, curtains, furniture, clothing, hair color, skin color, camera angles, lighting, or any physical appearance.

2. ALWAYS describe what is HAPPENING, what is being SAID, what CLAIMS are being made, what EVIDENCE is shown.

EXAMPLES OF BANNED DESCRIPTIONS (never write anything like these):
× "A person sitting at a desk with papers"
× "Wide shot of a room with chairs and a podium"
× "Man in blue uniform speaking into microphone"
× "Document displayed on screen with text"
× "Close-up of a table with evidence bags"

EXAMPLES OF CORRECT DESCRIPTIONS (always write like these):
✓ "Officer Smith testifies the suspect was found at 412 Oak Avenue at 11:15 PM"
✓ "Defense attorney argues the chain of custody was broken — 3 hours unaccounted for"
✓ "Dispatch recording confirms units were called to 4th and Main, contradicting the report's address"
✓ "Page 12 reveals the forensic report was filed 5 days after evidence collection, outside standard procedure"
✓ "Witness states she heard two gunshots at approximately 10:30 PM, not three as the report claims"

For EVERY timeline event ask yourself: "Am I describing WHAT HAPPENED or WHAT IT LOOKS LIKE?" If you're describing appearances, REWRITE IT.

AUDIO ANALYSIS: Listen to what people SAY. Transcribe key quotes. Note tone, urgency, contradictions.

VIDEO FRAME ANALYSIS: Read any on-screen text, transcribe visible documents/exhibits, identify what proceeding or activity is underway. IGNORE the physical setting.

SOURCE TYPE RULES:
- "video" = anything from a video file (frames AND its audio track)
- "audio" = ONLY for standalone audio files uploaded separately
- "pdf" = documents
- NEVER label video audio as "audio"

SEVERITY: "high" = direct contradiction or missing evidence, "medium" = inconsistency, "low" = minor difference.

Return ONLY valid JSON (no markdown, no code fences):
{
  "caseId": "unique-id",
  "caseName": "descriptive case name",
  "summary": "4-5 sentences: what the evidence shows, key contradictions found, what needs investigation",
  "timeline": [
    {
      "time": "HH:MM:SS or Page N",
      "timestamp_seconds": number_or_null,
      "page": number_or_null,
      "label": "5-8 words: the ACTION or CLAIM (never appearance)",
      "source": "pdf|video|audio|image|conflict",
      "description": "2-3 sentences: what is said/claimed/done, why it matters to the case",
      "icon": "phone|siren|car|user|alert|file|camera|mic|map|clock"
    }
  ],
  "contradictions": [
    {
      "id": "c1",
      "severity": "high|medium|low",
      "title": "specific contradiction title",
      "description": "2-3 sentences explaining the contradiction",
      "sources": [
        { "type": "pdf|video|audio|image", "label": "source name", "page": null, "quote": "exact quote or description", "timestamp": null, "finding": "what this source claims" }
      ],
      "additionalNotes": "string or null"
    }
  ],
  "keyObservations": [
    { "title": "string", "description": "string with timestamps/pages", "timestamp_seconds": null, "page": null, "relatedSources": ["string"] }
  ]
}

MINIMUM QUANTITIES:
- Video timeline: 1 event per 5 minutes of video
- Document timeline: 1 event per 2 pages
- Contradictions: at least 3
- Key observations: at least 3

Be concise and fast. Focus on SUBSTANCE — every event must describe meaningful content.`;

// ─── FALLBACK: Direct upload to Gemini (for when preprocessing fails) ──

const INLINE_SIZE_LIMIT = 15 * 1024 * 1024;

async function uploadToGemini(file) {
  const mimeType = getProperMimeType(file);
  const fileSize = fs.statSync(file.path).size;

  if (fileSize < INLINE_SIZE_LIMIT) {
    const data = fs.readFileSync(file.path).toString('base64');
    console.log(`  📦 Inline base64: ${file.originalname} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
    return { inlineData: { mimeType, data } };
  }

  console.log(`  ☁️  Files API upload: ${file.originalname} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
  const uploaded = await ai.files.upload({
    file: file.path,
    config: { mimeType, displayName: file.originalname },
  });

  let fileState = uploaded;
  let attempts = 0;
  const maxAttempts = fileSize > 100 * 1024 * 1024 ? 60 : 30; // More patience for large files
  while (fileState.state === 'PROCESSING' && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 3000));
    fileState = await ai.files.get({ name: fileState.name });
    attempts++;
    if (attempts % 10 === 0) console.log(`    Still processing... (${attempts}/${maxAttempts})`);
  }

  if (fileState.state === 'FAILED') {
    throw new Error(`File processing failed for ${file.originalname}`);
  }

  return { fileData: { fileUri: fileState.uri, mimeType: fileState.mimeType } };
}

// ─── Upload a raw file path to Gemini Files API ────────────────────────

async function uploadPathToGemini(filePath, mimeType, displayName) {
  const fileSize = fs.statSync(filePath).size;
  console.log(`  ☁️  Files API upload: ${displayName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

  const uploaded = await ai.files.upload({
    file: filePath,
    config: { mimeType, displayName },
  });

  let fileState = uploaded;
  let attempts = 0;
  const maxAttempts = fileSize > 100 * 1024 * 1024 ? 60 : 30;
  while (fileState.state === 'PROCESSING' && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 3000));
    fileState = await ai.files.get({ name: fileState.name });
    attempts++;
    if (attempts % 10 === 0) console.log(`    Still processing... (${attempts}/${maxAttempts})`);
  }

  if (fileState.state === 'FAILED') throw new Error(`File processing failed: ${displayName}`);
  return { fileData: { fileUri: fileState.uri, mimeType: fileState.mimeType } };
}

// ─── Assemble Gemini parts from preprocessed results ───────────────────
// Handles: video (frames + audioSamples[]), audio (audioSamples[]), pdf_text, image

const SAMPLE_SEC = 15; // must match preprocessor.js

async function buildGeminiParts(preprocessedResults) {
  const parts = [];
  let context = 'Evidence files for combined cross-reference analysis:\n\n';

  for (const result of preprocessedResults) {
    if (!result) continue;

    if (result.type === 'video') {
      const durationStr = result.duration >= 3600
        ? `${(result.duration / 3600).toFixed(1)}hr`
        : `${(result.duration / 60).toFixed(1)}min`;
      context += `VIDEO: "${result.originalName}" (${durationStr})\n`;
      context += `${result.frames.length} keyframes, each labelled with its timestamp:\n`;

      // Add labelled frames
      for (const frame of result.frames) {
        if (!frame || !frame.part) continue; // ✅ ADD THIS: Skip broken frames
        const h = Math.floor(frame.timestamp / 3600);
        const m = Math.floor((frame.timestamp % 3600) / 60);
        const s = String(frame.timestamp % 60).padStart(2, '0');
        const label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
        parts.push({ text: `[Keyframe @ ${label} (${frame.timestamp}s)]` });
        parts.push(frame.part);
      }

      // Add audio samples — explicitly label them as coming from the VIDEO file
      if (result.audioSamples?.length > 0) {
        const isFullAudio = result.audioSamples.length === 1 && result.audioSamples[0].isFullAudio;
        context += `\nAUDIO TRACK from the VIDEO file "${result.originalName}" (${isFullAudio ? 'full audio' : `${result.audioSamples.length} samples × ${SAMPLE_SEC}s`}):\n`;
        context += `NOTE: This audio is the SOUNDTRACK of the video above. When referencing this content, use source type "video", NOT "audio".\n`;
        for (const sample of result.audioSamples) {
          if (!isFullAudio) {
            const h = Math.floor(sample.ts / 3600);
            const m = Math.floor((sample.ts % 3600) / 60);
            const s = String(sample.ts % 60).padStart(2, '0');
            const label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
            parts.push({ text: `[VIDEO audio track @ ${label} (${sample.ts}s) from "${result.originalName}"]` });
          }
          parts.push({ inlineData: { mimeType: 'audio/mpeg', data: sample.data } });
        }
      }
      context += '\n';

    } else if (result.type === 'audio') {
      const durationStr = `${(result.duration / 60).toFixed(1)}min`;
      context += `AUDIO FILE: "${result.originalName}" (${durationStr})\n`;

      if (result.audioSamples?.length > 0) {
        const isFullAudio = result.audioSamples.length === 1 && result.audioSamples[0].isFullAudio;
        if (!isFullAudio) context += `${result.audioSamples.length} samples (${SAMPLE_SEC}s each):\n`;
        for (const sample of result.audioSamples) {
          if (!isFullAudio) {
            const m = Math.floor(sample.ts / 60);
            const s = String(sample.ts % 60).padStart(2, '0');
            parts.push({ text: `[Audio @ ${m}:${s} (${sample.ts}s)]` });
          }
          parts.push({ inlineData: { mimeType: 'audio/mpeg', data: sample.data } });
        }
      }
      context += '\n';

    } else if (result.type === 'pdf_text') {
      context += `PDF: "${result.originalName}" (${result.pageCount} pages)\n`;
      context += `Extracted text:\n${result.text}\n\n`;

    } else if (result.type === 'image') {
      context += `IMAGE: "${result.originalName}"\n\n`;
      if (result.inline) parts.push(result.inline);
    }
  }

  return { parts, context };
}

// ─── JSON repair helper — closes unclosed arrays/objects from truncated Gemini output ──

function repairJson(str) {
  // Remove trailing comma before closing brace/bracket
  let s = str.replace(/,\s*([}\]])/g, '$1');
  // Count open structures and close them
  const stack = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  // If we're mid-string, close it
  if (inString) s += '"';
  // Close all unclosed structures
  return s + stack.reverse().join('');
}

// ─── POST /api/analyze ─────────────────────────────────────────────────

function handleUpload(req, res, next) {
  upload.fields([
    { name: 'pdf', maxCount: 10 },
    { name: 'audio', maxCount: 10 },
    { name: 'video', maxCount: 10 },
  ])(req, res, (err) => {
    if (err) {
      // Return clean JSON instead of Express HTML error page
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large — restart the server (a stale process with old limits may be running)'
        : `Upload error: ${err.message}`;
      return res.status(400).json({ message: msg });
    }
    next();
  });
}

app.post('/api/analyze', handleUpload, async (req, res) => {
  try {
    if (!ai) {
      return res.status(400).json({ message: 'GEMINI_API_KEY not configured. Add a valid API key to .env file.' });
    }

    const files = req.files;
    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ message: 'No files uploaded.' });
    }

    const totalStartTime = Date.now();
    const usePreprocessing = isPreprocessingAvailable();
    const totalFileCount = Object.values(files).reduce((n, arr) => n + arr.length, 0);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📂 ${totalFileCount} file(s) received | Preprocessing: ${usePreprocessing ? '✅ ON' : '❌ OFF (FFmpeg not found)'}`);

    let parts = [];
    let contextText = '';
    let successResults = [];

    if (usePreprocessing) {
      // ── FAST PATH: Local preprocessing ──
      console.log('🔧 Preprocessing locally...');
      const preprocessStart = Date.now();

      // Flatten all files from all types, preprocess in parallel
      const allFileEntries = [];
      for (const [key, fileArr] of Object.entries(files)) {
        for (const file of fileArr) {
          allFileEntries.push({ key, file });
        }
      }

      const preprocessResults = await Promise.all(
        allFileEntries.map(async ({ key, file }) => {
          console.log(`  Processing ${key}: ${file.originalname}`);
          const result = await preprocessFile(file, key);
          return { key, file, result };
        })
      );

      const preprocessTime = ((Date.now() - preprocessStart) / 1000).toFixed(1);
      console.log(`⚡ Local preprocessing done in ${preprocessTime}s`);

      // Save keyframes as static files so the frontend can display them
      const framesUploadDir = path.join(__dirname, 'uploads', 'frames');
      if (!fs.existsSync(framesUploadDir)) fs.mkdirSync(framesUploadDir, { recursive: true });

      // Separate successful preprocessed files from fallback files
      const fallbackFiles = [];

      for (const { key, file, result } of preprocessResults) {
        if (result) {
          successResults.push(result);
        } else {
          console.log(`  ⚠️  Fallback to direct upload for: ${file.originalname}`);
          fallbackFiles.push({ key, file });
        }
      }

      // Build parts from preprocessed results
      if (successResults.length > 0) {
        const built = await buildGeminiParts(successResults);
        parts = built.parts;
        contextText = built.context;
      }

      // Handle fallback files (direct upload for files that couldn't be preprocessed)
      for (const { key, file } of fallbackFiles) {
        try {
          const part = await uploadToGemini(file);
          parts.push(part);
          contextText += `FILE: "${file.originalname}" (uploaded directly)\n`;
        } catch (uploadErr) {
          console.error(`  Upload failed: ${file.originalname}: ${uploadErr.message}`);
          return res.status(500).json({
            message: `Failed to process ${file.originalname}: ${uploadErr.message}`
          });
        }
      }
    } else {
      // ── SLOW PATH: Direct upload (no FFmpeg) ──
      console.log('☁️  Uploading directly to Gemini (install FFmpeg for 10x faster processing)...');
      const fileList = [];

      for (const [key, fileArr] of Object.entries(files)) {
        for (const file of fileArr) {
          fileList.push(`${key.toUpperCase()}: ${file.originalname}`);

          try {
            const part = await uploadToGemini(file);
            parts.push(part);
          } catch (uploadErr) {
            console.error(`  Upload error: ${file.originalname}: ${uploadErr.message}`);
            return res.status(500).json({
              message: `Failed to process ${file.originalname}: ${uploadErr.message}`
            });
          }
        }
      }

      contextText = `I am uploading ${fileList.length} evidence file(s) for combined analysis:\n${fileList.join('\n')}\n\nAnalyze ALL of these files TOGETHER.\n\n`;
    }

    // Add the prompt
    parts.push({ text: contextText + ANALYSIS_PROMPT });

    // Send to Gemini
    parts = parts.filter(p => p != null); // Strips out any undefined garbage first
const inlineParts = parts.filter(p => p.inlineData);
    const totalInlineMB = inlineParts.reduce((s, p) => s + Buffer.from(p.inlineData.data, 'base64').length, 0) / (1024 * 1024);
    console.log(`🧠 Sending to Gemini: ${parts.length} parts, ${totalInlineMB.toFixed(1)}MB inline data...`);
    const geminiStart = Date.now();

    // Model priority: fastest first, fallback if quota/rate-limit hit
    const MODEL_CHAIN = [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.2 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } } },
    ];

    let response;
    let lastErr;
    for (const { model, config } of MODEL_CHAIN) {
      try {
        console.log(`🧠 Trying model: ${model}...`);
        response = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }], config });
        console.log(`✅ Model ${model} responded`);
        break;
      } catch (err) {
        const isSkip = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('404') || err.message?.includes('NOT_FOUND') || err.status === 429 || err.status === 404;
        lastErr = err;
        if (isSkip) {
          console.warn(`⚠️  ${model} unavailable — trying next model...`);
          continue;
        }
        // Non-quota error — fail immediately
        const geminiTime = ((Date.now() - geminiStart) / 1000).toFixed(1);
        console.error(`❌ Gemini API error after ${geminiTime}s:`, err.message || err);
        return res.status(500).json({ message: `AI analysis failed: ${err.message || 'Unknown error'}` });
      }
    }

    if (!response) {
      const geminiTime = ((Date.now() - geminiStart) / 1000).toFixed(1);
      console.error(`❌ All models quota-exhausted after ${geminiTime}s`);
      return res.status(429).json({
        message: 'API quota exhausted on all models. Wait a minute and try again, or check your Gemini API plan at aistudio.google.com.'
      });
    }

    const geminiTime = ((Date.now() - geminiStart) / 1000).toFixed(1);
    console.log(`🧠 Gemini responded in ${geminiTime}s`);

    // Parse JSON response — with repair for truncated/broken JSON
    const text = response.text?.trim();
    if (!text) throw new Error('Empty response from Gemini');

    // Strip markdown fences if present
    let jsonStr = text;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    // Try to extract JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let analysis;
    try {
      analysis = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Try to fix common JSON issues: trailing commas, unescaped quotes
      let fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1')           // trailing commas
        .replace(/(['"])?(\w+)(['"])?\s*:/g, '"$2":')  // unquoted keys
        .replace(/:\s*'([^']*)'/g, ': "$1"');     // single-quoted values
      try {
        analysis = JSON.parse(fixed);
      } catch {
        console.error('Parse error:', parseErr.message);
        console.error('Raw text (first 500):', text.substring(0, 500));
        throw new Error('Failed to parse AI response as JSON. Please try again.');
      }
    }

    // Normalize: ensure sources array exists (backward compat)
    // Also normalize severity — Gemini sometimes returns "HIGH", "Serious", "SERIOUS" etc.
    function normalizeSeverity(s) {
      if (!s) return 'medium';
      const v = s.toLowerCase().trim();
      if (['high', 'serious', 'critical', 'severe', 'major'].includes(v)) return 'high';
      if (['medium', 'moderate', 'notable', 'significant'].includes(v)) return 'medium';
      if (['low', 'minor', 'minimal', 'info', 'informational'].includes(v)) return 'low';
      return 'medium';
    }

    if (analysis.contradictions) {
      analysis.contradictions = analysis.contradictions.map(c => {
        if (!c.sources && c.source1) {
          c.sources = [c.source1, c.source2].filter(Boolean);
        }
        return { ...c, severity: normalizeSeverity(c.severity) };
      });
    }
    if (!analysis.keyObservations) analysis.keyObservations = [];

    // ── Normalize source types based on what was ACTUALLY uploaded ──────
    // Gemini often says type:"audio" for speech heard from a VIDEO file's
    // audio track. Fix: if no standalone audio was uploaded, remap all
    // "audio" sources to "video" so the correct player is shown.
    const uploadedTypes = new Set(Object.keys(files));
    const hasStandaloneAudio = uploadedTypes.has('audio');
    const hasVideo = uploadedTypes.has('video');

    function fixType(t) {
      if (t === 'audio' && !hasStandaloneAudio && hasVideo) return 'video';
      return t;
    }

    if (analysis.contradictions) {
      analysis.contradictions = analysis.contradictions.map(c => ({
        ...c,
        sources: (c.sources || []).map(s => ({ ...s, type: fixType(s.type) })),
      }));
    }
    if (analysis.timeline) {
      analysis.timeline = analysis.timeline.map(e => ({
        ...e,
        source: fixType(e.source),
        // mic icon doesn't make sense for video — swap to camera
        icon: (e.source === 'audio' && fixType(e.source) === 'video' && e.icon === 'mic') ? 'camera' : e.icon,
      }));
    }

    // Attach file paths for media viewer
    analysis.files = {};
    for (const [key, fileArr] of Object.entries(files)) {
      analysis.files[key] = `/uploads/${fileArr[0].filename}`;
    }

    // Save ALL local keyframes (including extras not sent to Gemini) for timeline zoom
    analysis.keyframes = [];
    const ts_stamp = Date.now();
    for (const result of successResults) {
      // Use allFrames (full local set) if available, otherwise fall back to frames (Gemini subset)
      const frameSet = result?.allFrames || result?.frames;
      if (result?.type === 'video' && frameSet?.length > 0) {
        for (const frame of frameSet) {
          try {
            const fname = `kf_${ts_stamp}_${frame.timestamp}.jpg`;
            const fpath = path.join(__dirname, 'uploads', 'frames', fname);
            fs.writeFileSync(fpath, Buffer.from(frame.part.inlineData.data, 'base64'));
            analysis.keyframes.push({ ts: frame.timestamp, path: `/uploads/frames/${fname}` });
          } catch { }
        }
        break;
      }
    }

    // Also send all keyframe timestamps so frontend can build zoom timeline
    analysis.allKeyframeTimestamps = analysis.keyframes.map(kf => kf.ts).sort((a, b) => a - b);

    // Attach video duration for frontend timeline zoom
    for (const result of successResults) {
      if (result?.type === 'video' && result.duration > 0) {
        analysis.videoDuration = result.duration;
        break;
      }
    }

    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
    console.log(`✅ Total: ${totalTime}s | Findings: ${analysis.contradictions?.length || 0} | Observations: ${analysis.keyObservations?.length || 0}`);
    console.log(`${'─'.repeat(60)}\n`);

    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ message: error.message || 'Analysis failed.' });
  }
});

// ─── POST /api/translate ───────────────────────────────────────────────

app.post('/api/translate', async (req, res) => {
  try {
    if (!ai) return res.status(400).json({ message: 'API key not configured.' });

    const { analysis, language } = req.body;
    if (!analysis || !language) return res.status(400).json({ message: 'Missing analysis or language.' });

    const prompt = `Translate the following JSON analysis into ${language}. Keep the JSON structure and keys exactly the same (in English). Only translate the string VALUES (summary, descriptions, titles, quotes, labels, findings, additionalNotes, etc.) into ${language}. Keep numbers, IDs, severity levels (high/medium/low), source types (pdf/audio/video/image), and icon names unchanged. Return ONLY the translated JSON object, no markdown.

${JSON.stringify(analysis)}`;

    let response;
    for (const { model, config } of [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.1 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } },
    ]) {
      try {
        response = await ai.models.generateContent({ model, contents: [{ role: 'user', parts: [{ text: prompt }] }], config });
        break;
      } catch (e) {
        const isSkip = e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED') || e.message?.includes('404') || e.message?.includes('NOT_FOUND') || e.status === 429 || e.status === 404;
        if (isSkip) continue;
        throw e;
      }
    }
    if (!response) throw new Error('All models quota-exhausted');

    const text = response.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const translated = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    res.json(translated);
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ message: 'Translation failed.' });
  }
});

// Demo endpoint removed — app is now local-only with PWA support

// ─── POST /api/query — Ask a question about the timeline ───────────────

app.post('/api/query', async (req, res) => {
  try {
    if (!ai) return res.status(400).json({ message: 'API not configured' });
    const { question, context } = req.body;
    if (!question?.trim()) return res.status(400).json({ message: 'No question provided' });

    const prompt = `You are a forensic analyst assistant. Based on this evidence analysis:

${context || 'No context provided'}

Answer this question in plain, simple language (3-5 sentences max): ${question}

Important: Use simple words anyone can understand. Be specific and reference the actual evidence.`;

    let response;
    for (const { model, config } of [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.3 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } },
    ]) {
      try {
        response = await ai.models.generateContent({ model, contents: [{ role: 'user', parts: [{ text: prompt }] }], config });
        break;
      } catch (e) {
        const isSkip = e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED') || e.message?.includes('404') || e.message?.includes('NOT_FOUND') || e.status === 429 || e.status === 404;
        if (isSkip) continue;
        throw e;
      }
    }
    if (!response) return res.status(429).json({ message: 'API quota exhausted — try again in a minute' });

    const answer = response.text?.trim() || 'No answer available.';
    res.json({ answer });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ message: err.message || 'Query failed' });
  }
});
import { extractCustomRange } from './preprocessor.js';
// ─── POST /api/scan-range ───────────────────────────────────────────────
app.post('/api/scan-range', async (req, res) => {
  console.log(`\n🚨🚨🚨 RUNNING UPDATED CODE V2 🚨🚨🚨`); // Add this line!
  console.log(`\n🎯 [Custom Scan] Request received!`);
  try {
    const { videoPath, query, startTime, endTime } = req.body;
    
    if (!videoPath || !query || !startTime || !endTime) {
      return res.status(400).json({ message: 'Missing path, query, or time range.' });
    }

    // 🛡️ BULLETPROOF PARSER: Handles "MM:SS", "1,5", "90", and catches all garbage
    // 🛡️ BULLETPROOF PARSER: Handles "MM:SS", "1,5", "90", and catches all garbage
    const parseTimeRobust = (t) => {
      console.log(`\n--- [DEBUG] parseTimeRobust ---`);
      console.log(`[DEBUG] 1. Raw input received:`, typeof t, t);
      
      if (t === undefined || t === null) {
        console.log(`[DEBUG] -> Input is null/undefined. Returning 0.`);
        return 0;
      }
      
      const str = String(t).trim();
      console.log(`[DEBUG] 2. Stringified and trimmed: '${str}'`);
      
      if (!str) {
        console.log(`[DEBUG] -> String is empty. Returning 0.`);
        return 0;
      }
      
      // Handle HH:MM:SS or MM:SS
      if (str.includes(':')) {
        console.log(`[DEBUG] 3. Colon detected. Splitting by ':'...`);
        const parts = str.split(':').map(Number);
        console.log(`[DEBUG] 4. Parsed parts array:`, parts, `(Is Array? ${Array.isArray(parts)})`);
        
        if (parts.some(isNaN)) {
          console.log(`[DEBUG] -> Warning: One of the parts is NaN. Returning 0.`);
          return 0; 
        }
        
        if (parts.length === 3) {
          console.log(`[DEBUG] 5. Found 3 parts. Calculating (HH:MM:SS)...`);
          // Actually using the array indices this time!
          const result = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
          console.log(`[DEBUG] -> Result:`, result);
          return result;
        }
        if (parts.length === 2) {
          console.log(`[DEBUG] 5. Found 2 parts. Calculating (MM:SS)...`);
          // Actually using the array indices this time!
          const result = (parts[0] * 60) + parts[1];
          console.log(`[DEBUG] -> Result:`, result);
          return result;
        }
      }
      
      // Handle pure seconds and swap European commas for dots (e.g., "1,5" -> "1.5")
      console.log(`[DEBUG] 3. No colon detected. Treating as pure seconds.`);
      const safeStr = str.replace(',', '.');
      console.log(`[DEBUG] 4. Replaced commas with dots: '${safeStr}'`);
      
      const num = parseFloat(safeStr);
      console.log(`[DEBUG] 5. Parsed float:`, num);
      
      if (isNaN(num)) {
         console.log(`[DEBUG] -> Float is NaN. Returning 0.`);
         return 0;
      }
      
      const finalNum = Math.floor(num);
      console.log(`[DEBUG] -> Final valid result:`, finalNum);
      return finalNum;
    };

    // Safely parse the inputs into guaranteed integers
    const startSec = parseTimeRobust(startTime);
    const endSec = parseTimeRobust(endTime);

    console.log(`🎯 [Custom Scan] Cleaned Inputs -> Start: ${startSec}s | End: ${endSec}s`);

    if (startSec >= endSec) {
      return res.status(400).json({ message: 'Start time must be before end time.' });
    }

    const duration = endSec - startSec;
    const cleanPath = videoPath.startsWith('/') ? videoPath.slice(1) : videoPath;
    const fullPath = path.join(__dirname, cleanPath);
    
    console.log(`🎯 [Custom Scan] Extracting ${duration}s clip from ${startSec}s to ${endSec}s...`);

    const clipStart = Date.now();
    const clipBase64 = await extractCustomRange(fullPath, startSec, endSec);

    if (!clipBase64) {
      console.log(`❌ [Custom Scan] FFmpeg failed to extract range.`);
      throw new Error('Failed to extract the requested time range. Check if the video file is valid.');
    }
    console.log(`✅ [Custom Scan] Clip extracted in ${((Date.now() - clipStart)/1000).toFixed(1)}s. Sending to Gemini...`);

    const prompt = `Analyze this video clip (extracted from ${startSec}s to ${endSec}s) and fulfill the following request: "${query}". Provide a direct, factual summary in 2-4 sentences max.`;

    const aiStart = Date.now();

    // Model Chaining for speed
    const MODEL_CHAIN = [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.2 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } } },
    ];

    let response;
    for (const { model, config } of MODEL_CHAIN) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: 'video/mp4', data: clipBase64 } },
            { text: prompt }
          ]}],
          config
        });
        break; 
      } catch (err) {
        const isSkip = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('404');
        if (isSkip) continue;
        throw err;
      }
    }

    if (!response) throw new Error("API quota exhausted.");

    console.log(`✅ [Custom Scan] Gemini responded in ${((Date.now() - aiStart)/1000).toFixed(1)}s.`);
    res.json({ summary: response.text });
  } catch (err) {
    console.error('❌ [Custom Scan] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`\n  🏴‍☠️  Data Pirates Server — http://localhost:${PORT}`);
  console.log(`  API key: ${ai ? '✅ Configured' : '❌ Missing (demo mode only)'}`);
  console.log(`  Preprocessing: ${isPreprocessingAvailable() ? '✅ FFmpeg available (fast mode)' : '⚠️  FFmpeg not found (using direct upload)'}`);
  if (!isPreprocessingAvailable()) {
    console.log(`  💡 Tip: FFmpeg is bundled via ffmpeg-static — it should auto-resolve.\n     If not, install FFmpeg manually for 10x faster video/audio processing.`);
  }
  console.log('');
});
