export async function analyzeEvidence(files, onUploadProgress) {
  const formData = new FormData();
  // Each type is now an array of files
  if (files.pdf?.length) files.pdf.forEach(f => formData.append('pdf', f));
  if (files.audio?.length) files.audio.forEach(f => formData.append('audio', f));
  if (files.video?.length) files.video.forEach(f => formData.append('video', f));

  // Use XMLHttpRequest for upload progress tracking on large files
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/analyze');
    xhr.timeout = 600000; // 10 min timeout

    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.message || 'Analysis failed'));
        }
      } catch {
        reject(new Error('Failed to parse response'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error — check your connection and try again'));
    xhr.ontimeout = () => reject(new Error('Request timed out — try a shorter video or smaller file'));

    xhr.send(formData);
  });
}

export async function translateAnalysis(analysis, language) {
  // Strip file data to reduce payload
  const stripped = { ...analysis };
  delete stripped.files;

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis: stripped, language }),
  });

  if (!response.ok) {
    throw new Error('Translation failed');
  }

  const translated = await response.json();
  // Preserve original files
  translated.files = analysis.files;
  return translated;
}

export async function deepScanVideo(payload) {
  const response = await fetch('/api/deepscan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Deep scan failed');
  return response.json();
}

export function formatTimestamp(seconds) {
  if (seconds == null) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function getSeverityConfig(severity) {
  switch (severity) {
    case 'high':
      return { label: 'SERIOUS', color: 'text-red-500', bg: 'bg-red-500', ring: 'ring-red-500/20', dot: 'bg-red-500', className: 'severity-high' };
    case 'medium':
      return { label: 'MODERATE', color: 'text-amber-500', bg: 'bg-amber-500', ring: 'ring-amber-500/20', dot: 'bg-amber-500', className: 'severity-medium' };
    case 'low':
      return { label: 'MINOR', color: 'text-blue-500', bg: 'bg-blue-500', ring: 'ring-blue-500/20', dot: 'bg-blue-500', className: 'severity-low' };
    default:
      return { label: 'NOTE', color: 'text-neutral-500', bg: 'bg-neutral-500', ring: 'ring-neutral-500/20', dot: 'bg-neutral-500', className: '' };
  }
}

// Normalize contradiction to always have sources array
export function normalizeSources(contradiction) {
  if (contradiction.sources && contradiction.sources.length > 0) {
    return contradiction.sources;
  }
  // Backward compat with source1/source2 format
  const sources = [];
  if (contradiction.source1) sources.push(contradiction.source1);
  if (contradiction.source2) sources.push(contradiction.source2);
  return sources;
}
