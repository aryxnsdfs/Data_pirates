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

// ─── 3-PASS ANALYSIS PIPELINE PROMPTS ─────────────────────────────────
// Pass 1: EXTRACTION — Pure fact extraction from evidence
// Pass 2: CONTRADICTION DETECTION — Cross-reference all claims
// Pass 3: ADVERSARIAL VERIFICATION — Challenge each contradiction

const PASS1_EXTRACTION_PROMPT = `You are a FORENSIC EVIDENCE EXTRACTION AGENT. Your ONLY job is to extract structured CLAIMS and FACTS from the evidence. NO analysis, NO opinions, NO comparisons.

CRITICAL RULES FOR VIDEO:
- NEVER describe people's appearance. That is USELESS and FORBIDDEN.
- NEVER write generic labels like "man speaks in courtroom" or "courtroom proceedings continue"
- Instead: describe the SPECIFIC legal argument, EXACT claim or statement, EVIDENCE being presented
- LISTEN TO AUDIO: transcribe ACTUAL words spoken, identify WHO is speaking, what LEGAL ARGUMENT is being made
- Each event MUST include a DIRECT QUOTE or SPECIFIC FACTUAL CLAIM from the audio
- Reference specific legal statutes, case names, organizations, dates, and numbers

CRITICAL RULES FOR DOCUMENTS:
- Analyze EVERY SINGLE PAGE. Do NOT skip pages.
- Quote EXACT text from each page
- For document events: set "page" to actual page number, "time" to "Page X"
- CRITICAL: For EACH document event, set "related_video_seconds" to the ACTUAL video timestamp (in seconds, must be > 0) where that page's topic is discussed in the video. Find the video moment where the speaker references or discusses the same subject as the document page. NEVER use 0. If you cannot find a match, use null.

VIDEO TIMELINE SPACING:
- Space events EVENLY across the video duration
- Do NOT cluster events at the beginning (1s, 2s, 3s). That is WRONG.
- EVERY event needs a meaningful label and 3-5 sentence description

Return ONLY valid JSON (no markdown, no code fences):
{
  "caseId": "string",
  "caseName": "string",
  "summary": "4-6 sentence comprehensive summary of ALL evidence",
  "claims": {
    "video_claims": [
      {
        "timestamp_seconds": number,
        "time": "HH:MM:SS",
        "speaker": "who said it (judge/attorney/witness name if known)",
        "claim": "EXACT quote or precise paraphrase of what was stated",
        "context": "2-3 sentences: what was happening, what argument was being made",
        "type": "testimony|argument|ruling|objection|statement|evidence_presentation",
        "icon": "phone|siren|car|user|alert|file|camera|mic|map|clock"
      }
    ],
    "document_claims": [
      {
        "page": number,
        "claim": "EXACT quote from the document",
        "context": "2-3 sentences: what the page is about, what it asserts",
        "document_section": "which part of the document (header, paragraph, footnote)",
        "related_video_seconds": number_greater_than_0_or_null (NEVER 0)
      }
    ]
  },
  "timeline": [
    {
      "time": "HH:MM:SS for video/audio, or 'Page X' for documents",
      "timestamp_seconds": number_for_video_or_null,
      "page": number_for_documents_or_null,
      "related_video_seconds": number_greater_than_0_or_null (NEVER 0 — find the real video timestamp),
      "label": "5-10 word SPECIFIC description",
      "source": "pdf|video|audio|image|conflict",
      "description": "3-5 detailed sentences with SPECIFIC quotes and facts",
      "icon": "phone|siren|car|user|alert|file|camera|mic|map|clock"
    }
  ],
  "keyObservations": [
    {
      "title": "Observation title",
      "description": "Detailed description with specific page/timestamp references",
      "timestamp_seconds": REQUIRED_if_video_evidence — set to the actual video timestamp in seconds where this is observed (must be > 0, NOT null if video is present),
      "page": number_or_null — set to the document page number if this relates to a document,
      "relatedSources": ["Video Evidence", "Document Evidence", etc.]
    }
  ]
}

MINIMUM REQUIREMENTS:
- Video: 1 event per 2 minutes minimum; for videos longer than 10 minutes generate at least 15 events spaced EVENLY across the FULL duration
- Document: 1 event per page minimum
- video_claims: minimum 15 claims with exact quotes (more is better)
- document_claims: 1 per page minimum with exact quotes
- keyObservations: minimum 5

CRITICAL: For a 30-minute video you MUST produce at least 15 timeline events. Do NOT stop after 6.

Return ONLY the JSON.`;

const PASS2_COMBINED_PROMPT = `You are a CONTRADICTION DETECTION + ADVERSARIAL VERIFICATION AGENT. You perform TWO tasks in ONE pass:

TASK 1: Cross-reference EVERY video claim against EVERY document claim to find mismatches, inconsistencies, and contradictions.
TASK 2: For EACH contradiction found, immediately play devil's advocate — challenge it, look for innocent explanations, and assign a confidence score.

DETECTION RULES:
- Every contradiction MUST cite BOTH a video source (with real timestamp in seconds, NOT 0) AND a document source (with real page number, NOT 0)
- Include EXACT QUOTES from both sources showing the contradiction
- Each source.finding must be 2-3 sentences explaining what was found
- Severity: "high" = direct factual contradiction, "medium" = significant inconsistency, "low" = minor discrepancy
- Be AGGRESSIVE in finding contradictions — look for: different numbers/dates, contradicting statements, omissions, reframing of events, things said on video but missing from documents, things in documents not supported by video

VERIFICATION RULES (apply to EACH contradiction):
- Could there be an innocent explanation? (paraphrasing, different context, time gap)
- Are the quotes accurate and in proper context?
- Is the severity rating justified?
- If confidence_score < 20, set survived=false to DROP the contradiction
- Scoring: 90-100=undeniable, 70-89=strong, 50-69=real but contextual, 30-49=weak, 0-29=not real

VIDEO CLAIMS:
{VIDEO_CLAIMS}

DOCUMENT CLAIMS:
{DOCUMENT_CLAIMS}

Return ONLY valid JSON (no markdown, no code fences):
{
  "contradictions": [
    {
      "id": "c1",
      "survived": true_or_false,
      "confidence_score": 0_to_100,
      "severity": "high|medium|low",
      "title": "Clear title of the discrepancy",
      "description": "3-4 sentences: what contradicts what, why it matters",
      "sources": [
        {
          "type": "video",
          "label": "Video evidence",
          "timestamp": number_NOT_ZERO,
          "page": null,
          "quote": "EXACT quote from video transcript",
          "finding": "2-3 sentences explaining what this source shows"
        },
        {
          "type": "pdf",
          "label": "Document evidence",
          "timestamp": null,
          "page": number_NOT_ZERO,
          "quote": "EXACT quote from document",
          "finding": "2-3 sentences explaining what this source shows and why it contradicts"
        }
      ],
      "additionalNotes": "string or null",
      "video_timestamp": number,
      "document_page": number,
      "innocent_explanation": "Best possible innocent explanation, or null",
      "adversarial_notes": "2-3 sentences: your adversarial assessment"
    }
  ]
}

MINIMUM: Find at least 5 contradictions. Look harder if you find fewer.
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
      context += `${result.frames.length} keyframes (scene-change detected, deduplicated), each labelled with its timestamp:\n`;

      // Add labelled frames
      for (const frame of result.frames) {
        if (!frame || !frame.part) continue;
        const h = Math.floor(frame.timestamp / 3600);
        const m = Math.floor((frame.timestamp % 3600) / 60);
        const s = String(frame.timestamp % 60).padStart(2, '0');
        const label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
        parts.push({ text: `[Keyframe @ ${label} (${frame.timestamp}s)]` });
        parts.push(frame.part);
      }

      // Add transcript if available (from whisper.cpp + pyannote diarization)
      if (result.transcript?.length > 0) {
        context += `\n=== LOCAL WHISPER TRANSCRIPT (with speaker diarization) ===\n`;
        context += `NOTE: This transcript was generated locally by whisper.cpp. Use these timestamps and speaker labels as ground truth.\n`;
        for (const seg of result.transcript) {
          const startMin = Math.floor(seg.start / 60);
          const startSec = Math.floor(seg.start % 60);
          const label = `${startMin}:${String(startSec).padStart(2, '0')}`;
          const speaker = seg.speaker ? `[${seg.speaker}]` : '';
          context += `[${label} (${seg.start.toFixed(1)}s)] ${speaker} "${seg.text}"\n`;
        }
        context += '\n';
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

      // Add transcript if available
      if (result.transcript?.length > 0) {
        context += `\n=== LOCAL WHISPER TRANSCRIPT ===\n`;
        for (const seg of result.transcript) {
          const startMin = Math.floor(seg.start / 60);
          const startSec = Math.floor(seg.start % 60);
          const speaker = seg.speaker ? `[${seg.speaker}]` : '';
          context += `[${startMin}:${String(startSec).padStart(2, '0')}] ${speaker} "${seg.text}"\n`;
        }
        context += '\n';
      }

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

// ─── Core pipeline (shared by /api/analyze and /api/analyze-local) ───────
async function runAnalysisPipeline(files, totalStartTime) {
    const usePreprocessing = isPreprocessingAvailable();
    const totalFileCount = Object.values(files).reduce((n, arr) => n + arr.length, 0);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📂 ${totalFileCount} file(s) | Preprocessing: ${usePreprocessing ? '✅ ON' : '❌ OFF'}`);

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

    // Detect uploaded types early (needed for Pass 2 skip logic)
    const uploadedTypes = new Set(Object.keys(files));
    const hasStandaloneAudio = uploadedTypes.has('audio');
    const hasVideo = uploadedTypes.has('video');

    // ═══════════════════════════════════════════════════════════════════
    // 2-PASS ANALYSIS PIPELINE (optimized from 3-pass)
    // Pass 1: Extraction — structured claims from evidence
    // Pass 2: Combined Contradiction Detection + Adversarial Verification
    // ═══════════════════════════════════════════════════════════════════

    parts = parts.filter(p => p != null);
    const inlineParts = parts.filter(p => p.inlineData);
    const totalInlineMB = inlineParts.reduce((s, p) => s + Buffer.from(p.inlineData.data, 'base64').length, 0) / (1024 * 1024);
    console.log(`🧠 2-Pass Pipeline starting: ${parts.length} parts, ${totalInlineMB.toFixed(1)}MB inline data...`);

    // Pass 1 uses flash first (large multimodal output needs high token limit)
    // Passes 2 & 3 use flash-lite first (text-only, smaller output, faster + cheaper)
    const PASS1_MODEL_CHAIN = [
      { model: 'gemini-2.5-flash', config: { temperature: 0, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 } } },
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0, maxOutputTokens: 32768 } },
    ];
    const TEXT_MODEL_CHAIN = [
      { model: 'gemini-2.5-flash-lite', config: { temperature: 0, maxOutputTokens: 32768 } },
      { model: 'gemini-2.5-flash', config: { temperature: 0, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 } } },
    ];

    // Helper: call Gemini with model fallback + JSON parsing + repair
    async function callGeminiWithParts(promptParts, label, modelChain = PASS1_MODEL_CHAIN) {
      const start = Date.now();
      let response;
      for (const { model, config } of modelChain) {
        try {
          console.log(`  🧠 ${label}: Trying ${model}...`);
          response = await ai.models.generateContent({ model, contents: [{ role: 'user', parts: promptParts }], config });
          console.log(`  ✅ ${label}: ${model} responded in ${((Date.now() - start) / 1000).toFixed(1)}s`);
          break;
        } catch (err) {
          const isSkip = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('404') || err.message?.includes('NOT_FOUND') || err.status === 429 || err.status === 404;
          if (isSkip) { console.warn(`  ⚠️  ${model} unavailable — trying next...`); continue; }
          throw err;
        }
      }
      if (!response) throw new Error(`${label}: All models quota-exhausted`);

      const raw = response.text?.trim();
      if (!raw) throw new Error(`${label}: Empty response`);

      let jsonStr = raw;
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const jsonMatch = jsonStr.match(/[\[{][\s\S]*[\]}]/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      try { return JSON.parse(jsonStr); } catch {
        let fixed = jsonStr.replace(/,\s*([}\]])/g, '$1').replace(/(['"])?(\w+)(['"])?\s*:/g, '"$2":').replace(/:\s*'([^']*)'/g, ': "$1"');
        try { return JSON.parse(fixed); } catch {
          try { return JSON.parse(repairJson(fixed)); } catch {
            console.error(`  ⚠️  ${label}: JSON parse failed, raw:`, raw.substring(0, 500));
            throw new Error(`${label}: Failed to parse AI response as JSON`);
          }
        }
      }
    }

    // Helper: call Gemini with text-only prompt (uses cheaper flash-lite first)
    async function callGeminiText(promptText, label) {
      return callGeminiWithParts([{ text: promptText }], label, TEXT_MODEL_CHAIN);
    }

    const geminiStart = Date.now();

    // ═══ PASS 1: EXTRACTION ═══════════════════════════════════════════
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`📋 PASS 1: Fact Extraction...`);

    const pass1Parts = [...parts, { text: contextText + PASS1_EXTRACTION_PROMPT }];
    const pass1Result = await callGeminiWithParts(pass1Parts, 'Pass 1 (Extraction)');

    const videoClaims = pass1Result.claims?.video_claims || [];
    const docClaims = pass1Result.claims?.document_claims || [];
    console.log(`  📋 Extracted ${videoClaims.length} video claims, ${docClaims.length} document claims`);

    // ═══ PASS 2: COMBINED CONTRADICTION DETECTION + ADVERSARIAL VERIFICATION ═══
    const canRunPass2 = videoClaims.length > 0 || hasStandaloneAudio;
    let verifiedContradictions = [];

    if (canRunPass2) {
      console.log(`\n⚔️🛡️  PASS 2: Contradiction Detection + Adversarial Verification (combined)...`);

      const pass2Prompt = PASS2_COMBINED_PROMPT
        .replace('{VIDEO_CLAIMS}', JSON.stringify(videoClaims, null, 2))
        .replace('{DOCUMENT_CLAIMS}', JSON.stringify(docClaims, null, 2));

      const pass2Result = await callGeminiText(pass2Prompt, 'Pass 2 (Detect+Verify)');
      const allContradictions = pass2Result.contradictions || [];
      console.log(`  ⚔️  Found ${allContradictions.length} contradictions`);

      // Filter: drop contradictions that didn't survive adversarial review
      verifiedContradictions = allContradictions
        .filter(c => c.survived !== false || (c.confidence_score || 50) >= 20)
        .map(c => ({
          ...c,
          confidence: c.confidence_score || 50,
          adversarial_notes: c.adversarial_notes || null,
          innocent_explanation: c.innocent_explanation || null,
        }));

      const dropped = allContradictions.length - verifiedContradictions.length;
      if (dropped > 0) console.log(`  🛡️  ${verifiedContradictions.length}/${allContradictions.length} survived (${dropped} dropped)`);
    } else {
      console.log(`\n⚔️  PASS 2: Skipped — no video/audio to cross-reference against documents`);
    }

    const geminiTime = ((Date.now() - geminiStart) / 1000).toFixed(1);
    console.log(`\n🧠 2-Pass Pipeline complete in ${geminiTime}s`);

    // ═══ ASSEMBLE FINAL ANALYSIS ══════════════════════════════════════
    let analysis = {
      caseId: pass1Result.caseId || 'case-001',
      caseName: pass1Result.caseName || 'Forensic Analysis',
      summary: pass1Result.summary || '',
      timeline: pass1Result.timeline || [],
      contradictions: verifiedContradictions,
      keyObservations: pass1Result.keyObservations || [],
      claims: { video: videoClaims, document: docClaims },
      pipeline: {
        pass1_claims: { video: videoClaims.length, document: docClaims.length },
        pass2_contradictions: verifiedContradictions.length,
        total_time: parseFloat(geminiTime),
      },
    };

    // Normalize severity
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
        // Calculate confidence score from multiple signals
        let confidence = c.confidence || 50;

        // Boost: multiple source types agreeing
        const sourceTypes = new Set((c.sources || []).map(s => s.type));
        if (sourceTypes.size >= 2) confidence = Math.min(100, confidence + 10);

        // Boost: has exact quotes from both sides
        const hasQuotes = (c.sources || []).every(s => s.quote && s.quote.length > 20);
        if (hasQuotes) confidence = Math.min(100, confidence + 5);

        // Boost: has real timestamps/pages
        const hasRealCitations = (c.sources || []).every(s =>
          (s.type === 'video' && s.timestamp > 0) || (s.type === 'pdf' && s.page > 0)
        );
        if (hasRealCitations) confidence = Math.min(100, confidence + 5);

        return {
          ...c,
          severity: normalizeSeverity(c.severity),
          confidence: Math.round(confidence),
        };
      });
    }
    if (!analysis.keyObservations) analysis.keyObservations = [];

    // ── Normalize source types based on what was ACTUALLY uploaded ──────
    // Gemini often says type:"audio" for speech heard from a VIDEO file's
    // audio track. Fix: if no standalone audio was uploaded, remap all
    // "audio" sources to "video" so the correct player is shown.
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
    // .filename = multer-assigned name; .path = full disk path (local mode uses path only)
    const getUploadUrl = (f) => {
      const fname = f.filename || path.basename(f.path || '');
      return fname ? `/uploads/${fname}` : null;
    };
    analysis.files = {};
    for (const [key, fileArr] of Object.entries(files)) {
      if (fileArr.length === 1) {
        analysis.files[key] = getUploadUrl(fileArr[0]);
      } else {
        analysis.files[key] = fileArr.map(getUploadUrl).filter(Boolean);
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

    return analysis;
}

app.post('/api/analyze', handleUpload, async (req, res) => {
  try {
    if (!ai) return res.status(400).json({ message: 'GEMINI_API_KEY not configured. Add a valid API key to .env file.' });
    const files = req.files;
    if (!files || Object.keys(files).length === 0) return res.status(400).json({ message: 'No files uploaded.' });
    const result = await runAnalysisPipeline(files, Date.now());
    res.json(result);
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

// ─── GET /api/ping — Local mode detection ──────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, local: true, preprocessing: isPreprocessingAvailable() });
});

// ─── POST /api/analyze-local — Read files directly from local paths ────
// Used when PWA is installed and server runs on same machine (no upload needed)
app.post('/api/analyze-local', async (req, res) => {
  try {
    if (!ai) return res.status(400).json({ message: 'GEMINI_API_KEY not configured.' });

    const { paths } = req.body; // { video?: string, pdf?: string[], audio?: string }
    if (!paths || Object.keys(paths).length === 0) {
      return res.status(400).json({ message: 'No file paths provided.' });
    }

    // Security: validate all paths are absolute and exist
    const allPaths = [
      ...(paths.video ? [{ type: 'video', p: paths.video }] : []),
      ...(paths.audio ? [{ type: 'audio', p: paths.audio }] : []),
      ...((paths.pdf || []).map(p => ({ type: 'pdf', p }))),
    ];

    for (const { p } of allPaths) {
      if (!path.isAbsolute(p)) return res.status(400).json({ message: `Path must be absolute: ${p}` });
      if (!fs.existsSync(p)) return res.status(404).json({ message: `File not found: ${p}`, code: 'FILE_NOT_FOUND' });
    }

    const totalStartTime = Date.now();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📂 Local-path mode: ${allPaths.length} file(s)`);
    allPaths.forEach(({ type, p }) => console.log(`  ${type}: ${p}`));

    // Copy files into uploads dir under temp names so we can serve them later
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const fakeFiles = {};
    const copiedPaths = {};
    for (const { type, p } of allPaths) {
      const ext = path.extname(p);
      const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const dest = path.join(uploadsDir, fname);
      fs.copyFileSync(p, dest);
      copiedPaths[type] = dest;
      if (!fakeFiles[type]) fakeFiles[type] = [];
      fakeFiles[type].push({
        path: dest,
        originalname: path.basename(p),
        mimetype: getMimeByExt(ext),
        size: fs.statSync(p).size,
        _localSourcePath: p,
      });
    }

    const result = await runAnalysisPipeline(fakeFiles, totalStartTime);
    result.localPaths = paths; // store original paths for re-use
    res.json(result);
  } catch (error) {
    console.error('Local analysis error:', error);
    res.status(500).json({ message: error.message || 'Analysis failed.' });
  }
});

function getMimeByExt(ext) {
  return {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.wmv': 'video/x-ms-wmv',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  }[ext.toLowerCase()] || 'application/octet-stream';
}

app.listen(PORT, () => {
  console.log(`\n  🏴‍☠️  Data Pirates Server — http://localhost:${PORT}`);
  console.log(`  API key: ${ai ? '✅ Configured' : '❌ Missing (demo mode only)'}`);
  console.log(`  Preprocessing: ${isPreprocessingAvailable() ? '✅ FFmpeg available (fast mode)' : '⚠️  FFmpeg not found (using direct upload)'}`);
  if (!isPreprocessingAvailable()) {
    console.log(`  💡 Tip: FFmpeg is bundled via ffmpeg-static — it should auto-resolve.\n     If not, install FFmpeg manually for 10x faster video/audio processing.`);
  }
  console.log('');
});
