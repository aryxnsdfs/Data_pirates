![Data Pirates Banner](https://capsule-render.vercel.app/api?type=waving&color=auto&height=300&section=header&text=Data%20Pirates&fontSize=80&fontColor=ffffff&textAlignY=40&desc=The%2099.99%25%20Compression%20Multimodal%20Engine&descSize=22&descColor=c4b5fd&descAlignY=65)

# <img src="https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/scale-balanced.svg" width="24" height="24"> Data Pirates: The Lightning-Fast Forensic Engine

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

## <img src="https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/bolt.svg" width="20" height="20"> What It Does
* **Upload Anything:** Drop in massive video files, audio tracks, or dense PDFs.
* **Instant Timelines:** Automatically plots key events, witness statements, and actions on an interactive timeline.
* **Catch Contradictions:** Cross-references all your files to flag inconsistencies (e.g., a witness on video contradicting a police report PDF).
* **Millisecond Interrogation:** Ask questions like *"What happened at 1:32?"* and get instant answers without re-uploading the video.

## <img src="https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/microchip.svg" width="20" height="20"> Under the Hood (How the Magic Works)

We didn't just build an API wrapper; we engineered a highly optimized data pipeline. Here is the logic powering the engine:

### 1. Bypassing the RAM Crash
Standard web apps try to load uploaded files into the server's RAM, which instantly crashes Node.js on large files. We bypassed this entirely. We use `XMLHttpRequest (XHR)` on the frontend to track progress, and configure `Multer` on our Express backend to stream the file chunks directly to the hard drive. **A 10GB upload utilizes almost zero RAM.**

### 2. 99.994% Compression via Local FFmpeg
You can't send a 2-hour video to an LLM quickly. Instead, we run 16 parallel FFmpeg threads locally. 
* **For Video:** We fast-seek and extract evenly spaced keyframes, scaling them down to exactly 280px. This is 25x smaller than 1080p, but visually identical to the AI's vision model. 
* **For Audio:** A custom `silenceremove` filter strips out all dead air, leaving a hyper-dense, highly compressed mono speech track.
* **The Math:** A 10GB video payload becomes a ~560KB payload.

### 3. "Zero-Wait" UI & React Hacks
Nobody likes staring at a loading spinner. We deliver an initial lightweight case summary in just 15 seconds. While you read it, a silent background process triggers a deep-scan, seamlessly injecting granular events into your timeline. We also use a custom Regex parser to turn AI-generated text timestamps into clickable React buttons that instantly seek the HTML5 video player to that exact moment.

### 4. Factual AI & JSON Repair
Forensic analysis cannot tolerate AI hallucinations. We strictly enforce `temperature: 0.2` and use negative prompting (e.g., "Describe what is happening, NEVER what it looks like"). Because LLMs sometimes truncate long outputs, we wrote a custom JSON repair algorithm that dynamically closes broken arrays and objects so the app never crashes.

## <img src="https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/rocket.svg" width="20" height="20"> Quick Start Guide

Want to run this locally? It's incredibly simple. All you need is [Node.js](https://nodejs.org/) installed on your machine.

1. **Clone the repository** to your local machine and open the folder in your terminal.
2. **Run the initialization block below.** Make sure to replace `YOUR_API_KEY_HERE` with your actual free Gemini API key from [Google AI Studio](https://aistudio.google.com/).

```bash
# Install all dependencies
npm install

# Create the .env file and inject your API key
echo "GEMINI_API_KEY=YOUR_API_KEY_HERE" > .env

# Start the lightning-fast dev server
npm run dev
