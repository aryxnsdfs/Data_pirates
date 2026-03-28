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

const ANALYSIS_PROMPT = `You are a FORENSIC EVIDENCE ANALYST. You must analyze ALL evidence and create a comprehensive timeline with detailed findings.

CRITICAL RULES FOR VIDEO DESCRIPTIONS:
- NEVER describe people's appearance (hair color, clothes, glasses, race, gender). That is USELESS and FORBIDDEN.
- NEVER write generic labels like "man speaks in courtroom", "woman testifies", "person at podium", "courtroom scene continues"
- Instead you MUST describe: the SPECIFIC legal argument being made, the EXACT claim or statement, the EVIDENCE being presented, the RULING or OBJECTION
- GOOD: "Attorney argues FOIA Section 552(a)(3) requires BIA to disclose unsolved murder records"
- GOOD: "Judge rules government failed to demonstrate exemption under FOIA Exemption 7(A)"
- GOOD: "Witness testifies that 17,000 homicide cases were reported as unsolved by local agencies"
- BAD: "Man in suit speaks at podium" — NEVER DO THIS
- BAD: "Woman testifies in courtroom" — NEVER DO THIS
- BAD: "Courtroom proceedings continue" — NEVER DO THIS
- LISTEN TO THE AUDIO SAMPLES CAREFULLY: transcribe the ACTUAL words being spoken, identify WHO is speaking (judge, attorney, witness), and describe what LEGAL ARGUMENT or FACTUAL CLAIM is being made
- Each video event description must include at least one DIRECT QUOTE or SPECIFIC FACTUAL CLAIM from the audio
- Reference specific legal statutes, case names, organizations, dates, and numbers mentioned in the video

CRITICAL RULES FOR DOCUMENTS:
- Analyze EVERY SINGLE PAGE. Do NOT skip pages.
- For a 26-page document: produce events for pages 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26
- Quote EXACT text from each page
- Include page number in every document event
- For document events: set "page" to the actual page number (1, 2, 3...), set "time" to "Page X" (e.g. "Page 1", "Page 12")
- Document event labels must describe what the page CONTAINS (e.g. "MAP files FOIA request for unsolved homicide data"), NOT reference timestamps
- IMPORTANT: For EACH document event, set "related_video_seconds" to the video timestamp (in seconds) where the topic on that page is discussed or referenced in the video. Cross-reference the document content with the video to find the most relevant moment. If no direct match, use the closest relevant video moment. This MUST be a real number, NOT null.

VIDEO TIMELINE SPACING:
- Space events EVENLY across the video duration
- For a 2-hour video (7200s): events at ~0:05, ~0:10, ~0:15... every 5 minutes minimum
- Do NOT cluster events at the beginning (1s, 2s, 3s, 6s). That is WRONG.
- timestamp_seconds must reflect real positions throughout the entire video
- EVERY video event MUST have a meaningful "label" that describes WHAT HAPPENS (e.g. "Attorney argues for disclosure of records"), NOT generic labels like "Frame @ 04:19" or "Video continues"
- EVERY video event MUST have a detailed "description" (3-5 sentences) explaining the content, dialogue, and significance at that moment

CONTRADICTIONS — CROSS-REFERENCE BOTH VIDEO AND DOCUMENT:
- Every contradiction MUST have at least 2 sources, referencing BOTH the video AND the document
- Source 1 MUST be from the video (type: "video") with a valid timestamp in seconds (NOT 0)
- Source 2 MUST be from the document (type: "pdf") with a valid page number (NOT 0 or null)
- Do NOT create contradictions that only reference one file type — always cross-reference BOTH
- Include detailed quotes and descriptions (3-4 sentences each), not one-liners
- source.finding must be a full paragraph explaining what was found
- source.timestamp MUST be a real number (seconds into the video where the contradiction is visible/audible)
- source.page MUST be a real page number for pdf sources

SOURCE TYPES: "video" for video files (including audio track), "pdf" for documents, "audio" for standalone audio only, "image" for images
SEVERITY: "high" = direct contradiction, "medium" = inconsistency, "low" = minor difference

Return ONLY valid JSON (no markdown, no code fences):
{
  "caseId": "string",
  "caseName": "string",
  "summary": "4-6 sentence comprehensive summary of ALL evidence and key findings",
  "timeline": [
    {
      "time": "HH:MM:SS for video/audio, or 'Page X' for documents",
      "timestamp_seconds": "number for video/audio, null for documents",
      "page": "number for documents, null for video/audio",
      "related_video_seconds": "FOR DOCUMENT EVENTS ONLY: number (seconds into video where this page's content is discussed). null for video events.",
      "label": "5-10 word SPECIFIC description — what legal argument, claim, or evidence is being presented",
      "source": "pdf|video|audio|image|conflict",
      "description": "3-5 detailed sentences with SPECIFIC quotes, legal citations, case facts — NOT generic visual descriptions",
      "icon": "phone|siren|car|user|alert|file|camera|mic|map|clock"
    }
  ],
  "contradictions": [
    {
      "id": "c1",
      "severity": "high|medium|low",
      "title": "Clear title of the discrepancy",
      "description": "3-4 sentences explaining the contradiction in detail, what it means for the case, and why it matters",
      "sources": [
        {
          "type": "pdf|video|audio|image",
          "label": "File name or description",
          "page": number_or_null,
          "quote": "Exact quote or detailed transcript of what is said/written",
          "timestamp": number_or_null,
          "finding": "2-3 sentence detailed explanation of what this source shows and why it contradicts the other source"
        }
      ],
      "additionalNotes": "string or null"
    }
  ],
  "keyObservations": [
    {
      "title": "Observation title",
      "description": "Detailed description with specific page/timestamp references",
      "timestamp_seconds": number_or_null,
      "page": number_or_null,
      "relatedSources": ["source labels"]
    }
  ]
}

MINIMUM REQUIREMENTS:
- Video timeline: 1 event per 5 minutes minimum (2hr video = 24+ events, evenly spaced)
- Document timeline: 1 event per page minimum (26 pages = 26 events)
- Contradictions: minimum 5 when both video and PDF uploaded, must cross-reference BOTH files
- Each contradiction description: minimum 3 sentences
- Each source finding: minimum 2 sentences
- keyObservations: minimum 5

Return ONLY the JSON.`;

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
        // Last resort: try repairJson which closes unclosed structures
        try {
          analysis = JSON.parse(repairJson(fixed));
          console.log('⚠️  JSON repaired successfully');
        } catch {
          console.error('Parse error:', parseErr.message);
          console.error('Raw text (first 500):', text.substring(0, 500));
          throw new Error('Failed to parse AI response as JSON. Please try again.');
        }
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
      if (fileArr.length === 1) {
        analysis.files[key] = `/uploads/${fileArr[0].filename}`;
      } else {
        // Multiple files of same type: store as array
        analysis.files[key] = fileArr.map(f => `/uploads/${f.filename}`);
      }
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
    // Run clip extraction and model warmup in parallel for speed
    const clipBase64Promise = extractCustomRange(fullPath, startSec, endSec);
    const clipBase64 = await clipBase64Promise;

    if (!clipBase64) {
      console.log(`❌ [Custom Scan] FFmpeg failed to extract range.`);
      throw new Error('Failed to extract the requested time range. Check if the video file is valid.');
    }
    console.log(`✅ [Custom Scan] Clip extracted in ${((Date.now() - clipStart)/1000).toFixed(1)}s. Sending to Gemini...`);

    const prompt = `You are a forensic evidence analyst. Analyze this ${duration}-second video clip (from ${startSec}s to ${endSec}s) and answer: "${query}".

RULES:
- Only state facts visible/audible in this clip. Do NOT hallucinate.
- Describe WHAT IS SAID or CLAIMED, not physical appearances.
- Reference specific timestamps within the clip if relevant.
- Be concise but thorough: 3-5 sentences covering the key factual findings.`;

    const aiStart = Date.now();

    // Detect mime type from file extension for accuracy
    const videoExt = path.extname(fullPath).toLowerCase();
    const videoMime = MIME_MAP[videoExt] || 'video/mp4';

    // Model Chaining for speed — fastest first
    const MODEL_CHAIN = [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.1 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } },
    ];

    let response;
    for (const { model, config } of MODEL_CHAIN) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: videoMime, data: clipBase64 } },
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
    res.json({ summary: response.text?.trim() });
  } catch (err) {
    console.error('❌ [Custom Scan] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/important-events — Extract key events from entire video ──────────
app.post('/api/important-events', handleUpload, async (req, res) => {
  try {
    if (!ai) return res.status(400).json({ message: 'API not configured.' });
    const { videoPath, videoDuration } = req.body;
    if (!videoPath) return res.status(400).json({ message: 'Missing videoPath.' });

    const cleanPath = videoPath.startsWith('/') ? videoPath.slice(1) : videoPath;
    const fullPath = path.join(__dirname, cleanPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: 'Video file not found.' });
    }

    const duration = Number(videoDuration) || 3600;
    console.log(`\n🎬 [Important Events] Processing ${(duration/60).toFixed(1)}min video...`);

    // For long videos: sample at strategic points; for short: use all frames
    // Strategy: extract frames at evenly-spaced intervals + audio samples
    const MAX_SAMPLES = Math.min(12, Math.max(4, Math.floor(duration / 60)));
    const interval = duration / MAX_SAMPLES;

    // Extract multiple clips in parallel for speed
    const samplePoints = Array.from({ length: MAX_SAMPLES }, (_, i) =>
      Math.floor(i * interval + interval / 2)
    ).filter(t => t < duration);

    console.log(`  📍 Sampling at ${samplePoints.length} points: ${samplePoints.map(t => `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`).join(', ')}`);

    // Extract short clips at each sample point in parallel
    const CLIP_DURATION = Math.min(30, Math.floor(interval * 0.4)); // 40% of interval, max 30s
    const clipPromises = samplePoints.map(async (ts) => {
      const start = Math.max(0, ts - Math.floor(CLIP_DURATION / 2));
      const end = Math.min(duration, start + CLIP_DURATION);
      try {
        const data = await extractCustomRange(fullPath, start, end);
        return data ? { ts, start, end, data } : null;
      } catch { return null; }
    });

    const clips = (await Promise.all(clipPromises)).filter(Boolean);
    console.log(`  ✅ Extracted ${clips.length}/${samplePoints.length} clips`);

    if (clips.length === 0) {
      return res.status(500).json({ message: 'Could not extract video segments.' });
    }

    // Build parts for Gemini — all clips + one prompt
    const videoExt = path.extname(fullPath).toLowerCase();
    const videoMime = MIME_MAP[videoExt] || 'video/mp4';
    const parts = [];

    for (const clip of clips) {
      const h = Math.floor(clip.ts / 3600);
      const m = Math.floor((clip.ts % 3600) / 60);
      const s = clip.ts % 60;
      const timeLabel = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      parts.push({ text: `[Video segment @ ~${timeLabel} (${clip.ts}s), covering ${clip.start}s–${clip.end}s]` });
      parts.push({ inlineData: { mimeType: videoMime, data: clip.data } });
    }

    parts.push({ text: `You are a forensic analyst. I have provided ${clips.length} equally-spaced segments from a ${(duration/60).toFixed(1)}-minute video.

Identify the MOST IMPORTANT events in the video. For each event:
- State WHAT is said, claimed, or done (not what things look like)
- Reference the exact approximate timestamp
- Explain why it matters legally or factually
- Do NOT describe appearances, room settings, or clothing

Return a JSON array of important events, sorted by timestamp:
[
  {
    "timestamp_seconds": 0,
    "time": "MM:SS or HH:MM:SS",
    "title": "6-10 word event title",
    "description": "3-4 sentences: what happened, who said what, why it matters, cross-reference with other moments",
    "importance": "critical|high|medium",
    "icon": "phone|siren|car|user|alert|file|camera|mic|map|clock"
  }
]

Return ONLY the JSON array. No markdown. No extra text. Minimum 4 events.` });

    const aiStart = Date.now();
    let response;
    for (const { model, config } of [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.1 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } },
    ]) {
      try {
        response = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }], config });
        break;
      } catch (err) {
        const isSkip = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('404');
        if (isSkip) continue;
        throw err;
      }
    }

    if (!response) return res.status(429).json({ message: 'API quota exhausted.' });
    console.log(`✅ [Important Events] Gemini responded in ${((Date.now()-aiStart)/1000).toFixed(1)}s`);

    const raw = response.text?.trim() || '[]';
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    let events;
    try {
      events = JSON.parse(arrMatch ? arrMatch[0] : raw);
    } catch {
      try { events = JSON.parse(repairJson(arrMatch?.[0] || raw)); } catch { events = []; }
    }

    res.json({ events: Array.isArray(events) ? events : [] });
  } catch (err) {
    console.error('❌ [Important Events] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});
// ─── POST /api/knowledge-graph — 3-Agent Agentic Pipeline ─────────────
// Agent 1: Entity Miner → Agent 2: Relationship Mapper → Agent 3: Critic

app.post('/api/knowledge-graph', async (req, res) => {
  try {
    if (!ai) return res.status(400).json({ message: 'API key not configured.' });

    const { analysis } = req.body;
    if (!analysis) return res.status(400).json({ message: 'No analysis data provided.' });

    const totalStart = Date.now();
    console.log(`\n🕸️  [Knowledge Graph] Starting 3-Agent Pipeline...`);

    // Build context from analysis data for agents
    let evidenceContext = `Case: ${analysis.caseName || 'Unknown'}\n`;
    evidenceContext += `Summary: ${analysis.summary || ''}\n\n`;

    evidenceContext += `=== VIDEO TIMELINE ===\n`;
    (analysis.timeline || []).filter(e => e.source === 'video' || e.source === 'audio').forEach(e => {
      evidenceContext += `[${e.time || ''}] (${e.timestamp_seconds ?? '?'}s): ${e.label} — ${e.description || ''}\n`;
    });

    evidenceContext += `\n=== DOCUMENT PAGES ===\n`;
    (analysis.timeline || []).filter(e => e.source === 'pdf' || e.source === 'image').forEach(e => {
      evidenceContext += `[Page ${e.page || '?'}]: ${e.label} — ${e.description || ''}\n`;
    });

    evidenceContext += `\n=== CONTRADICTIONS FOUND ===\n`;
    (analysis.contradictions || []).forEach(c => {
      evidenceContext += `[${c.severity}] ${c.title}: ${c.description}\n`;
      (c.sources || []).forEach(s => {
        evidenceContext += `  Source (${s.type}): "${s.quote}" — ${s.finding || ''}\n`;
      });
    });

    evidenceContext += `\n=== KEY OBSERVATIONS ===\n`;
    (analysis.keyObservations || []).forEach(o => {
      evidenceContext += `${o.title}: ${o.description}\n`;
    });

    // Collect keyframe URLs for entity-to-frame mapping
    const keyframeList = (analysis.keyframes || []).map(kf => `${kf.ts}s → ${kf.path}`).join('\n');
    if (keyframeList) evidenceContext += `\n=== AVAILABLE KEYFRAMES (timestamp → URL) ===\n${keyframeList}\n`;

    const modelChain = [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0.1 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } },
    ];

    async function callGemini(promptText, label) {
      const start = Date.now();
      let response;
      for (const { model, config } of modelChain) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config,
          });
          console.log(`  ✅ ${label}: ${model} responded in ${((Date.now() - start) / 1000).toFixed(1)}s`);
          break;
        } catch (err) {
          const isSkip = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('404');
          if (isSkip) continue;
          throw err;
        }
      }
      if (!response) throw new Error(`${label}: All models quota-exhausted`);
      let raw = response.text?.trim() || '';
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) raw = fenceMatch[1].trim();
      const jsonMatch = raw.match(/[\[{][\s\S]*[\]}]/);
      if (jsonMatch) raw = jsonMatch[0];
      try { return JSON.parse(raw); } catch {
        try { return JSON.parse(repairJson(raw)); } catch {
          console.error(`  ⚠️  ${label}: JSON parse failed, raw:`, raw.substring(0, 300));
          throw new Error(`${label}: Failed to parse response`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // AGENT 1: THE ENTITY MINER
    // ═══════════════════════════════════════════════════════════════════
    console.log(`  🔍 Agent 1: Entity Miner starting...`);
    const agent1Prompt = `You are an ENTITY EXTRACTION specialist for forensic evidence analysis.

EVIDENCE DATA:
${evidenceContext}

YOUR TASK: Extract the KEY entities from this specific case. Focus on entities that are ACTUALLY named in the evidence. Do NOT invent generic entities.

ENTITY TYPES:
- "person": NAMED individuals only (e.g. "Thomas Hargrove", "Judge Roberts"). DO NOT create generic entries like "attorney" or "witness" without a name.
- "organization": NAMED organizations (e.g. "Murder Accountability Project", "Bureau of Indian Affairs")
- "location": NAMED places (e.g. "U.S. District Court for D.C.", "Indian reservations")
- "document": NAMED documents/acts (e.g. "Freedom of Information Act", "Uniform Federal Crime Reporting Act")
- "evidence": Specific evidence items discussed
- "legal_concept": SPECIFIC legal concepts with identifiers (e.g. "FOIA Exemption 7(A)", "5 U.S.C. § 552")
- "event": SPECIFIC events with dates or context (e.g. "2015 FOIA Request Filing")

For each entity provide:
- The exact video timestamp (seconds) where they appear or are discussed
- The document page number where referenced
- A case-specific description explaining their ROLE in this particular case

Return ONLY valid JSON:
{
  "entities": [
    {
      "name": "Full Specific Name",
      "type": "person|organization|location|document|evidence|legal_concept|event",
      "description": "2-3 sentences: their specific role in THIS case, what they did, why they matter",
      "video_timestamp": number_or_null,
      "page": number_or_null,
      "keyframe_url": "closest keyframe path or null",
      "importance": "high|medium|low"
    }
  ]
}

RULES:
- Only 10-18 entities. Quality over quantity. Every entity must be MEANINGFUL to the case.
- NO generic entries: "a man", "the judge", "courtroom" are BANNED
- Every entity name must be SPECIFIC and NAMED (proper nouns)
- Deduplicate: "MAP" and "Murder Accountability Project" = same entity
- importance "high" = central to the case (max 4-5 high)

Return ONLY the JSON.`;

    const agent1Result = await callGemini(agent1Prompt, 'Agent 1 (Entity Miner)');
    const entities = agent1Result.entities || agent1Result || [];
    console.log(`  📋 Agent 1 found ${entities.length} entities`);

    // ═══════════════════════════════════════════════════════════════════
    // AGENT 2: THE RELATIONSHIP MAPPER (GRAPH BUILDER)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`  🔗 Agent 2: Relationship Mapper starting...`);
    const entityList = entities.map((e, i) => `${i + 1}. "${e.name}" (${e.type}) — ${e.description}`).join('\n');

    const agent2Prompt = `You are a RELATIONSHIP MAPPING specialist building a knowledge graph from forensic evidence.

EVIDENCE DATA:
${evidenceContext}

EXTRACTED ENTITIES:
${entityList}

YOUR TASK: Find ALL meaningful relationships between these entities. Every relationship MUST cite its source (video timestamp OR document page number).

Return ONLY valid JSON with nodes and edges format:
{
  "nodes": [
    {
      "id": "1",
      "label": "Entity Name",
      "type": "person|organization|location|document|date|evidence|legal_concept|event",
      "description": "1-2 sentence description",
      "video_timestamp": number_or_null,
      "page": number_or_null,
      "keyframe_url": "path or null",
      "importance": "high|medium|low"
    }
  ],
  "edges": [
    {
      "source": "node_id",
      "target": "node_id",
      "relation": "verb phrase describing the link (e.g. 'filed FOIA request to', 'testified about', 'authored')",
      "citation": "Video @ MM:SS or Page X",
      "timestamp": number_or_null,
      "page": number_or_null,
      "source_file": "video|pdf",
      "confidence": "high|medium|low",
      "description": "1 sentence explaining this relationship"
    }
  ]
}

RULES:
- Every entity from the list MUST appear as a node
- Find 12-25 edges (relationships). Quality over quantity — every edge must be REAL and EVIDENCE-BASED
- EVERY edge MUST have a citation (video timestamp or page number) — NO uncited edges
- Relationships must be SHORT, SPECIFIC verb phrases: "filed FOIA request to", "oversees", "testified about"
- BANNED generic relations: "is related to", "is associated with", "is connected to", "involves"
- Node IDs must be sequential strings: "1", "2", "3"...
- Each node must be CONNECTED to at least one other node (no orphans)
- DO NOT invent relationships — only include those directly stated in the evidence

Return ONLY the JSON.`;

    const agent2Result = await callGemini(agent2Prompt, 'Agent 2 (Relationship Mapper)');
    const graph = {
      nodes: agent2Result.nodes || [],
      edges: agent2Result.edges || [],
    };
    console.log(`  🕸️  Agent 2 built graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

    // ═══════════════════════════════════════════════════════════════════
    // AGENT 3: THE CRITIC (FACT CHECKER)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`  🔎 Agent 3: Critic starting...`);
    const edgesForReview = graph.edges.map((e, i) => {
      const srcNode = graph.nodes.find(n => n.id === e.source);
      const tgtNode = graph.nodes.find(n => n.id === e.target);
      return `${i + 1}. "${srcNode?.label || e.source}" → "${e.relation}" → "${tgtNode?.label || e.target}" [Citation: ${e.citation || 'NONE'}]`;
    }).join('\n');

    const agent3Prompt = `You are a FORENSIC FACT CHECKER reviewing a knowledge graph built from evidence.

ORIGINAL EVIDENCE:
${evidenceContext}

RELATIONSHIPS TO VERIFY:
${edgesForReview}

YOUR TASK: Review EACH relationship and determine if it is properly supported by the evidence. Challenge claims. Check citations.

For each edge, provide a verdict:
- "verified" = The evidence clearly supports this relationship at the cited location
- "plausible" = The relationship is reasonable but the exact citation may be approximate
- "unsupported" = Cannot find clear evidence for this relationship — it may be hallucinated
- "corrected" = The relationship exists but needs correction (e.g. wrong timestamp, wrong direction)

Return ONLY valid JSON:
{
  "reviews": [
    {
      "edge_index": 1,
      "verdict": "verified|plausible|unsupported|corrected",
      "reason": "1-2 sentence explanation of your assessment",
      "corrected_citation": "Updated citation if corrected, null otherwise",
      "corrected_relation": "Updated relation text if corrected, null otherwise"
    }
  ],
  "graph_quality_score": 0.0_to_1.0,
  "summary": "2-3 sentence overall assessment of the knowledge graph quality"
}

RULES:
- Review ALL edges
- Be strict: if a citation doesn't match, mark as "corrected" or "unsupported"
- Provide specific reasons for each verdict
- The quality score should reflect: % verified or plausible edges

Return ONLY the JSON.`;

    const agent3Result = await callGemini(agent3Prompt, 'Agent 3 (Critic)');
    const reviews = agent3Result.reviews || [];
    console.log(`  ✓ Agent 3 reviewed ${reviews.length} edges | Quality: ${agent3Result.graph_quality_score || '?'}`);

    // ═══════════════════════════════════════════════════════════════════
    // MERGE: Apply critic's feedback to graph
    // ═══════════════════════════════════════════════════════════════════
    const finalEdges = [];
    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];
      const review = reviews.find(r => r.edge_index === i + 1);
      if (review) {
        edge.verdict = review.verdict;
        edge.review_reason = review.reason;
        if (review.corrected_citation) edge.citation = review.corrected_citation;
        if (review.corrected_relation) edge.relation = review.corrected_relation;
      } else {
        edge.verdict = 'unreviewed';
      }
      // Keep all except unsupported
      if (edge.verdict !== 'unsupported') {
        finalEdges.push(edge);
      }
    }
    graph.edges = finalEdges;

    const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
    console.log(`🕸️  [Knowledge Graph] Pipeline complete in ${totalTime}s | ${graph.nodes.length} nodes, ${graph.edges.length} verified edges`);
    console.log(`${'─'.repeat(60)}\n`);

    res.json({
      graph,
      quality: {
        score: agent3Result.graph_quality_score || 0,
        summary: agent3Result.summary || '',
        total_edges_before: agent2Result.edges?.length || 0,
        total_edges_after: graph.edges.length,
        removed_unsupported: (agent2Result.edges?.length || 0) - graph.edges.length,
      },
      agents: {
        entities_found: entities.length,
        relationships_found: agent2Result.edges?.length || 0,
        reviews_completed: reviews.length,
        verdicts: {
          verified: reviews.filter(r => r.verdict === 'verified').length,
          plausible: reviews.filter(r => r.verdict === 'plausible').length,
          corrected: reviews.filter(r => r.verdict === 'corrected').length,
          unsupported: reviews.filter(r => r.verdict === 'unsupported').length,
        },
      },
      pipeline_time: parseFloat(totalTime),
    });

  } catch (err) {
    console.error('❌ [Knowledge Graph] Error:', err.message);
    res.status(500).json({ message: err.message || 'Knowledge graph generation failed.' });
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
