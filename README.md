![Data Pirates Banner](https://capsule-render.vercel.app/api?type=waving&color=auto&height=300&section=header&text=Data%20Pirates&fontSize=80&fontColor=ffffff&textAlignY=40&desc=The%2099.99%25%20Compression%20Multimodal%20Engine&descSize=22&descColor=c4b5fd&descAlignY=65)

# <img src="https://api.iconify.design/fa6-solid:scale-balanced.svg?color=%23C4B5FD" width="28" height="28" align="center"> Data Pirates: The Lightning-Fast Forensic Engine

<p align="left">
  <img src="https://img.shields.io/badge/BUILT%20BY-ARYAN-007EC6?style=for-the-badge&logo=github" alt="Built By Aryan" />
  <img src="https://img.shields.io/badge/LICENSE-MIT-97CA00?style=for-the-badge" alt="License MIT" />
  <img src="https://img.shields.io/badge/NODE.JS-18.x+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/REACT-VITE-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React & Vite" />
  <img src="https://img.shields.io/badge/AI-GEMINI%202.5-8E75B2?style=for-the-badge&logo=google&logoColor=white" alt="Gemini AI" />
</p>

Welcome to **Data Pirates**!

If you've ever tried to feed a 10GB video or a massive stack of PDFs into an AI model, you know exactly what happens: the browser crashes, the server runs out of memory, or the API times out.

We built Data Pirates to solve exactly that. This is a multimodal forensic evidence analysis engine that takes gigabytes of chaotic case files (videos, audio recordings, and documents) and compresses them by **99.99%** locally before the AI even touches them.

The result? You get a full, interactive forensic breakdown of your evidence in under 15 seconds.

---

## <img src="https://api.iconify.design/fa6-solid:bolt.svg?color=%23C4B5FD" width="24" height="24" align="center"> What It Does

* **Upload Anything:** Drop in massive video files (MP4, MKV, MOV, AVI, WebM, WMV, FLV, 3GP), audio tracks (MP3, WAV, M4A, OGG, AAC, FLAC, OPUS), or dense PDFs.
* **Dual-Track Interactive Timelines:** Automatically plots key events on separate **Video** and **Document** timeline tracks, each with independent detail panels. Video events display timestamps; document events display page numbers with compact page-pill navigation.
* **Cross-Reference Engine:** Every document page is linked to relevant video timestamps via `related_video_seconds`. Click a badge on any document page to jump directly to the corresponding moment in the video player.
* **Contradiction Detection:** Cross-references all uploaded evidence to flag inconsistencies, requiring both a real video timestamp and a real document page number as sources (e.g., a witness statement on video at 4:32 contradicting page 7 of the police report).
* **Millisecond Interrogation:** Ask questions like *"What happened at 1:32?"* or *"What does the report say about the weapon?"* and get instant, cited answers without re-uploading anything.
* **Custom Range Scanning:** Select any time range in your video and trigger a deep AI scan of just that segment for granular forensic analysis.
* **Multi-Language Translation:** Translate your entire forensic analysis into any language with a single click, powered by Gemini.
* **Case Report Export:** Download a structured forensic report of your entire analysis with one click.

---

## <img src="https://api.iconify.design/fa6-solid:microchip.svg?color=%23C4B5FD" width="24" height="24" align="center"> Under the Hood (How the Magic Works)

We didn't just build an API wrapper; we engineered a highly optimized data pipeline. Here is the logic powering the engine:

### 1. Bypassing the RAM Crash
Standard web apps try to load uploaded files into the server's RAM, which instantly crashes Node.js on large files. We bypassed this entirely. We use `XMLHttpRequest (XHR)` on the frontend to track upload progress, and configure `Multer` on our Express backend to stream the file chunks directly to the hard drive. **A 10GB upload utilizes almost zero RAM.**

### 2. 99.99% Compression via Local FFmpeg
You can't send a 2-hour video to an LLM quickly. Instead, we run FFmpeg locally with parallel processing.

* **For Video:** We extract 60 evenly-spaced keyframes locally (for timeline thumbnails), but only send **10 representative frames** to Gemini. Each frame is scaled down to exactly 280px wide, which is 25x smaller than 1080p but visually identical to the AI's vision model.
* **For Audio:** We extract 7 audio samples of 15 seconds each, then apply a custom `silenceremove` filter that strips all dead air (silence > 1.5s below -30dB), leaving a hyper-dense mono speech track.
* **For PDFs:** We use `pdf-parse` to extract raw text content instantly (<1s), sending only the text to the AI instead of rendered page images.
* **The Math:** A 324MB video becomes a ~0.4MB payload. That's **99.9% compression** before the AI ever sees it.

### 3. Gemini Model Chain with Automatic Fallback
We use a dual-model strategy for reliability:

* **Primary:** `gemini-2.5-flash-lite-preview-06-17` for speed-optimized analysis.
* **Fallback:** `gemini-2.5-flash-preview-04-17` when the lite model hits rate limits (429) or is unavailable (404).
* The system automatically retries with the fallback model, so the user never sees a failure.

### 4. Case-Specific AI with Negative Prompting
Forensic analysis cannot tolerate generic or hallucinated descriptions. We enforce:

* **`temperature: 0.2`** for factual precision.
* **Strict negative prompting:** The AI is explicitly banned from generating generic descriptions like "man in suit speaks" or "person walks into room." Instead, it must describe specific legal arguments, direct quotes, statute references, and evidentiary significance.
* **Document-Video cross-referencing:** The AI is instructed to generate `related_video_seconds` for each document page, linking written content to corresponding video moments.
* **Contradiction rules:** Every flagged contradiction must cite a real video timestamp AND a real document page as sources.

### 5. JSON Repair Algorithm
Because LLMs sometimes truncate long JSON outputs mid-stream, we wrote a custom repair algorithm that:
* Detects incomplete JSON responses.
* Dynamically closes broken arrays, objects, and strings.
* Ensures the app never crashes on malformed AI output.

### 6. "Zero-Wait" UI with Progressive Loading
Nobody likes staring at a loading spinner. We deliver an initial lightweight case summary in under 15 seconds. While you read it, a silent background process triggers a deep-scan via `/api/important-events`, seamlessly injecting granular events into your timeline using React state merging. We also use a custom Regex parser to turn AI-generated text timestamps into clickable React buttons that instantly seek the HTML5 video player to that exact moment.

---

## <img src="https://api.iconify.design/fa6-solid:sitemap.svg?color=%23C4B5FD" width="24" height="24" align="center"> Architecture

```
                         User uploads video + PDF
                                   |
                    +--------------+--------------+
                    |                             |
              [Video File]                  [PDF Document]
                    |                             |
          FFmpeg Preprocessing              pdf-parse extraction
          - 60 frames extracted             - Raw text extracted
          - 10 sent to Gemini              - Sent as inline text
          - 7 audio samples x 15s
          - Silence removal
                    |                             |
                    +--------------+--------------+
                                   |
                    Gemini 2.5 Flash (Lite/Full)
                    - Timeline events generation
                    - Contradiction detection
                    - Cross-reference mapping
                                   |
                    +--------------+--------------+
                    |              |              |
              [Video Track]  [Doc Track]  [Contradictions]
              - Timestamped   - Page-based   - Dual-sourced
                events         page pills      with citations
                    |              |              |
                    +--------------+--------------+
                                   |
                          React Dashboard
                    - Framer Motion animations
                    - Independent detail panels
                    - Video player with seek
                    - Interactive Q&A chat
```

---

## <img src="https://api.iconify.design/fa6-solid:folder-tree.svg?color=%23C4B5FD" width="24" height="24" align="center"> Project Structure

```
crossexam-ai/
  server.js            # Express backend: all API endpoints, AI prompts, model chain
  preprocessor.js      # Local FFmpeg preprocessing engine (frames, audio, PDF)
  package.json         # Dependencies and scripts
  .env                 # GEMINI_API_KEY (not committed)
  src/
    App.jsx            # Root app component
    main.jsx           # React entry point
    components/
      Dashboard.jsx    # Main dashboard: dual-track timelines, detail panels, chat, controls
      ContradictionCard.jsx  # Contradiction display cards with source citations
    utils/
      api.js           # Frontend API client (XHR upload with progress tracking)
      storage.js       # Local storage utilities for report saving
```

---

## <img src="https://api.iconify.design/fa6-solid:plug.svg?color=%23C4B5FD" width="24" height="24" align="center"> API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analyze` | Upload and analyze video/audio/PDF files. Returns timeline events, contradictions, and case summary. |
| `POST` | `/api/scan-range` | Deep-scan a custom time range within a video for granular forensic analysis. |
| `POST` | `/api/query` | Ask a natural language question about the analyzed evidence. Returns cited answers. |
| `POST` | `/api/important-events` | Extract key events from the entire video (background deep-scan). |
| `POST` | `/api/translate` | Translate the full forensic analysis into any target language. |

---

## <img src="https://api.iconify.design/fa6-solid:rocket.svg?color=%23C4B5FD" width="24" height="24" align="center"> Quick Start Guide

Want to run this locally? It's incredibly simple. All you need is [Node.js](https://nodejs.org/) (v18+) installed on your machine.

1. **Clone the repository** to your local machine and open the folder in your terminal.
2. **Run the initialization block below.** Replace `YOUR_API_KEY_HERE` with your free Gemini API key from [Google AI Studio](https://aistudio.google.com/).

```bash
# Install all dependencies
npm install

# Create the .env file and inject your API key
echo "GEMINI_API_KEY=YOUR_API_KEY_HERE" > .env

# Start the lightning-fast dev server
npm run dev
```

3. Open **http://localhost:3175** in your browser. The backend runs on port `3001`.

> **Note:** FFmpeg is bundled via `ffmpeg-static`, so you don't need to install it separately. If FFmpeg is unavailable, the system falls back to direct file upload (slower, larger payloads).

---

## <img src="https://api.iconify.design/fa6-solid:layer-group.svg?color=%23C4B5FD" width="24" height="24" align="center"> Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + Vite 6 | Fast HMR, component-based UI |
| **Styling** | TailwindCSS 3 | Utility-first responsive design |
| **Animations** | Framer Motion 11 | Smooth timeline transitions and detail panel reveals |
| **Icons** | Lucide React | Consistent, lightweight iconography |
| **Backend** | Express 4 | REST API with streaming file upload |
| **Upload** | Multer | Disk-streaming multipart file handling |
| **Preprocessing** | FFmpeg (ffmpeg-static) | Local video/audio compression and frame extraction |
| **PDF Parsing** | pdf-parse | Text extraction from PDF documents |
| **AI Engine** | Google Gemini 2.5 Flash | Multimodal analysis (vision + text + audio) |
| **Concurrency** | concurrently | Parallel client + server dev mode |

---

## <img src="https://api.iconify.design/fa6-solid:shield-halved.svg?color=%23C4B5FD" width="24" height="24" align="center"> Key Design Decisions

| Decision | Why |
|----------|-----|
| **Local preprocessing over cloud** | Privacy-first: raw evidence never leaves the user's machine. Only compressed frames and text snippets are sent to the AI. |
| **Dual-track timelines** | Video events and document events have fundamentally different semantics (timestamps vs. pages). Separating them prevents confusion and enables cross-referencing. |
| **Negative prompting for AI quality** | Generic LLM descriptions are useless for forensics. Banning vague language forces the AI to extract legally relevant details. |
| **JSON repair over retry** | Retrying a failed 15-second Gemini call wastes time. Repairing truncated JSON is instant and preserves partial results. |
| **Model fallback chain** | Rate limits are inevitable with free-tier APIs. Automatic fallback to the full Flash model ensures zero downtime. |
| **Independent detail panels** | Clicking a video event shouldn't close the document panel, and vice versa. Independent state prevents UI conflicts. |

---

## <img src="https://api.iconify.design/fa6-solid:scale-balanced.svg?color=%23C4B5FD" width="24" height="24" align="center"> License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <sub>Built with forensic precision by <strong>Aryan</strong></sub>
</p>

![Footer](https://capsule-render.vercel.app/api?type=waving&color=auto&height=100&section=footer)
