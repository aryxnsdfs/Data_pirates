import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Clock, BarChart3, Download, Check,
  Phone, Siren, Car, User, AlertCircle, FileText, Camera, Mic, MapPin,
  X, Eye, Lightbulb, Send, Loader2, ZoomIn, ZoomOut, Search,
  ChevronDown, Star, MessageSquare,
} from 'lucide-react';
import ContradictionCard from './ContradictionCard';
import { Shield } from 'lucide-react';
import { saveReport } from '../utils/storage';

const TIMELINE_ICONS = {
  phone: Phone, siren: Siren, car: Car, user: User, alert: AlertTriangle,
  file: FileText, camera: Camera, mic: Mic, map: MapPin, clock: Clock,
};

// ── Time formatting ──────────────────────────────────────────────────────
function formatEventTime(timeStr, timestampSeconds) {
  if (timestampSeconds != null) {
    const h = Math.floor(timestampSeconds / 3600);
    const m = Math.floor((timestampSeconds % 3600) / 60);
    const s = Math.floor(timestampSeconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (!timeStr) return '';
  const match = timeStr.match(/^(\d+):(\d{2})$/);
  if (match) {
    const a = parseInt(match), b = parseInt(match);
    if (a >= 60) {
      const total = a * 60 + b;
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }
  }
  return timeStr;
}

// ── Parse timestamp_seconds from a time string ──────────────────────────
function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  // Match H:MM:SS, MM:SS, or just M:SS
  const full = timeStr.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (full) return parseInt(full) * 3600 + parseInt(full) * 60 + parseInt(full);
  const short = timeStr.match(/^(\d+):(\d{2})$/);
  if (short) {
    const a = parseInt(short), b = parseInt(short);
    if (a >= 60) return a * 60 + b; // MM:SS where MM >= 60
    return a * 60 + b;
  }
  return null;
}

// ── Download helpers ─────────────────────────────────────────────────────
function downloadTextReport(analysis) {
  let text = `DATA PIRATES — EVIDENCE ANALYSIS REPORT\n${'='.repeat(50)}\n\n`;
  text += `Case: ${analysis.caseName || 'N/A'}\nCase ID: ${analysis.caseId || 'N/A'}\nGenerated: ${new Date().toLocaleString()}\n\n`;
  text += `SUMMARY\n${'-'.repeat(30)}\n${analysis.summary}\n\n`;
  text += `TIMELINE\n${'-'.repeat(30)}\n`;
  (analysis.timeline || []).forEach(e => {
    text += `  ${formatEventTime(e.time, e.timestamp_seconds)} — ${e.label}\n    ${e.description}\n\n`;
  });
  text += `DISCREPANCIES (${(analysis.contradictions || []).length})\n${'-'.repeat(30)}\n`;
  (analysis.contradictions || []).forEach(c => {
    text += `\n  [${c.severity.toUpperCase()}] ${c.title}\n  ${c.description}\n\n`;
    (c.sources || []).forEach((s, i) => {
      text += `  Source ${i + 1}: ${s.label}`;
      if (s.page) text += ` (Page ${s.page})`;
      if (s.timestamp != null) text += ` (@ ${formatEventTime(null, s.timestamp)})`;
      text += `\n    ${s.finding || ''}\n    "${s.quote}"\n\n`;
    });
    if (c.additionalNotes) text += `  Note: ${c.additionalNotes}\n`;
  });
  if (analysis.keyObservations?.length) {
    text += `\nKEY OBSERVATIONS\n${'-'.repeat(30)}\n`;
    analysis.keyObservations.forEach(o => {
      text += `\n  ${o.title}\n  ${o.description}\n  Related: ${o.relatedSources?.join(', ') || 'N/A'}\n`;
    });
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${(analysis.caseName || 'analysis').replace(/[^a-zA-Z0-9]/g, '_')}_report.txt` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function downloadJSON(analysis) {
  const blob = new Blob([JSON.stringify({ ...analysis, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${(analysis.caseName || 'analysis').replace(/[^a-zA-Z0-9]/g, '_')}_report.json` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── Seek video helper ───────────────────────────────────────────────────
function seekVideo(videoRef, seconds) {
  if (seconds == null || !videoRef?.current) return;
  const vid = videoRef.current;
  const go = () => {
    try {
      vid.currentTime = seconds;
      // Flash highlight without scrolling
      vid.parentElement?.classList.add('ring-2', 'ring-violet-500', 'ring-offset-2');
      setTimeout(() => vid.parentElement?.classList.remove('ring-2', 'ring-violet-500', 'ring-offset-2'), 2000);
    } catch { }
  };
  if (vid.readyState >= 1) go();
  else vid.addEventListener('loadedmetadata', go, { once: true });
}

// ── Timeline Node (video/audio only) ────────────────────────────────────
function TimelineNode({ event, index, total, isSelected, onClick, zoom, keyframeUrl }) {
  const isConflict = event.source === 'conflict';
  const EventIcon = TIMELINE_ICONS[event.icon] || Clock;
  const displayTime = formatEventTime(event.time, event.timestamp_seconds);

  // Wider nodes at higher zoom
  const minWidth = zoom === 1 ? 140 : zoom === 2 ? 180 : 240;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3 + index * 0.04, duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center shrink-0 relative cursor-pointer group"
      style={{ minWidth: `${minWidth}px` }}
      onClick={() => onClick && onClick(event)}
    >
      {index < total - 1 && (
        <div className="absolute top-5 left-1/2 w-full h-px bg-neutral-300 dark:bg-neutral-700 z-0" />
      )}
      <div className="relative z-10">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-110 ${isSelected ? 'ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-neutral-950' : ''
          } ${isConflict ? 'bg-red-500/20 ring-2 ring-red-500/40' : 'bg-neutral-100 dark:bg-neutral-800 group-hover:bg-neutral-200 dark:group-hover:bg-neutral-700'}`}>
          <EventIcon className={`w-4.5 h-4.5 ${isConflict ? 'text-red-500' : event.source === 'audio' ? 'text-emerald-500' : event.source === 'video' ? 'text-amber-500' : 'text-blue-500'
            }`} />
        </div>
        {isConflict && (
          <motion.div className="absolute inset-0 rounded-full border-2 border-red-500/30"
            animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }} />
        )}
      </div>
      <div className="mt-3 text-center px-1">
        <p className={`text-xs font-bold ${isConflict ? 'text-red-500' : 'text-neutral-700 dark:text-neutral-300'}`}>{displayTime}</p>
        <p className={`text-[11px] mt-0.5 max-w-[120px] leading-snug font-medium ${isConflict ? 'text-red-400' : 'text-neutral-600 dark:text-neutral-400'}`}>{event.label}</p>
        {/* Show exact seconds at zoom 2+ */}
        {zoom >= 2 && event.timestamp_seconds != null && (
          <p className="text-[10px] mt-0.5 text-neutral-400 font-mono">{event.timestamp_seconds}s</p>
        )}
      </div>
      {/* Keyframe thumbnail at zoom 3+ */}
      {zoom >= 3 && keyframeUrl && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 shadow-sm">
          <img src={keyframeUrl} alt={`Frame @ ${displayTime}`} className="w-28 h-16 object-cover" />
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Timeline Detail Panel ────────────────────────────────────────────────
function TimelineDetail({ event, onClose, onQuery, onSeekVideo, onSeekVideoTimestamp }) {
  if (!event) return null;
  const sourceLabel = { audio: '🎙 Audio', video: '🎬 Video', pdf: '📄 Document', image: '🖼 Image', conflict: '⚠️ Conflict' };
  const isDoc = event.source === 'pdf' || event.source === 'image';
  const displayTime = isDoc ? (event.page ? `Page ${event.page}` : '') : formatEventTime(event.time, event.timestamp_seconds);
  const relatedVideoTime = event.related_video_seconds != null ? formatEventTime(null, event.related_video_seconds) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      className={`mt-4 p-5 rounded-2xl bg-white dark:bg-neutral-900 border shadow-lg ${isDoc ? 'border-blue-200 dark:border-blue-800/40' : 'border-neutral-200 dark:border-neutral-800'}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-sm">{event.label}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-neutral-500">{sourceLabel[event.source] || event.source}</span>
            {isDoc && event.page && (
              <button
                onClick={() => onSeekVideo && onSeekVideo(event.page)}
                className="text-xs font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
                title={`Jump to page ${event.page}`}
              >
                📄 Page {event.page}
              </button>
            )}
            {isDoc && relatedVideoTime && (
              <button
                onClick={() => onSeekVideoTimestamp && onSeekVideoTimestamp(event.related_video_seconds)}
                className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                title={`Jump to related video moment at ${relatedVideoTime}`}
              >
                🎬 Video @ {relatedVideoTime}
              </button>
            )}
            {!isDoc && displayTime && (
              <button
                onClick={() => onSeekVideo && onSeekVideo(event.timestamp_seconds)}
                className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                title="Click to jump video to this time"
              >
                ⏱ {displayTime}
              </button>
            )}
            {!isDoc && event.timestamp_seconds != null && (
              <span className="text-xs text-neutral-400">({event.timestamp_seconds}s)</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0">
          <X className="w-4 h-4 text-neutral-400" />
        </button>
      </div>
      <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed mb-4">{event.description}</p>
      <div className="flex items-center gap-3 flex-wrap">
        {!isDoc && event.timestamp_seconds != null && (
          <button
            onClick={() => onSeekVideo && onSeekVideo(event.timestamp_seconds)}
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
          >
            <Camera className="w-3 h-3" /> Jump to this moment
          </button>
        )}
        {isDoc && event.page && (
          <button
            onClick={() => onSeekVideo && onSeekVideo(event.page)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <FileText className="w-3 h-3" /> Go to page {event.page}
          </button>
        )}
        {isDoc && relatedVideoTime && (
          <button
            onClick={() => onSeekVideoTimestamp && onSeekVideoTimestamp(event.related_video_seconds)}
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
          >
            <Camera className="w-3 h-3" /> Jump to video @ {relatedVideoTime}
          </button>
        )}
        <button
          onClick={() => onQuery && onQuery(`Tell me more about: ${event.label}${isDoc && event.page ? ` on page ${event.page}` : ` at ${displayTime}`}`)}
          className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
        >
          <Send className="w-3 h-3" /> Ask about this event
        </button>
      </div>
    </motion.div>
  );
}

// ── Timeline Query Bar ───────────────────────────────────────────────────
function TimelineQuery({ analysis, prefill, onClearPrefill }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  // Accept prefilled question from clicking a timeline event
  if (prefill && prefill !== question) {
    setQuestion(prefill);
    setAnswer('');
    onClearPrefill?.();
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const buildContext = () => {
    let ctx = `Case: ${analysis.caseName}\nSummary: ${analysis.summary}\n\nTimeline events (ALL):\n`;
    // Include ALL timeline events — not truncated
    (analysis.timeline || []).forEach(e => {
      ctx += `- ${formatEventTime(e.time, e.timestamp_seconds)} (${e.timestamp_seconds ?? '?'}s): ${e.label} — ${e.description}\n`;
    });
    // Include keyframe timestamps so AI knows about ALL analyzed moments
    if (analysis.allKeyframeTimestamps?.length) {
      ctx += `\nAnalyzed keyframe positions (seconds): ${analysis.allKeyframeTimestamps.join(', ')}\n`;
      ctx += `The video was analyzed at each of these timestamps. For times between them, describe what likely happened based on surrounding frames.\n`;
    }
    if (analysis.videoDuration) {
      ctx += `\nTotal video duration: ${(analysis.videoDuration / 60).toFixed(1)} minutes\n`;
    }
    ctx += `\nKey issues:\n`;
    (analysis.contradictions || []).forEach(c => {
      ctx += `- [${c.severity}] ${c.title}: ${c.description}\n`;
    });
    if (analysis.keyObservations?.length) {
      ctx += `\nKey observations:\n`;
      analysis.keyObservations.forEach(o => {
        ctx += `- ${o.title}: ${o.description}\n`;
      });
    }
    return ctx;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setAnswer('');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), context: buildContext() }),
      });
      const data = await res.json();
      setAnswer(data.answer || data.message || 'No answer returned.');
    } catch {
      setAnswer('Could not get an answer — check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask anything about this evidence... (e.g. 'What happened at 1:32?')"
            className="w-full px-4 py-2.5 pr-12 text-sm rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50 transition-all"
          />
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="submit"
          disabled={loading || !question.trim()}
          className="p-2.5 rounded-xl bg-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:bg-violet-600 shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </motion.button>
      </form>
      <AnimatePresence>
        {answer && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/15"
          >
            <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-1.5">Answer</p>
            <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Clickable Timestamp Renderer ─────────────────────────────────────────
// Parses text for time patterns like "23:02", "1:32:45" and makes them clickable
function ClickableText({ text, onTimeClick }) {
  if (!text || !onTimeClick) return <>{text}</>;
  // Match H:MM:SS or M:SS or HH:MM patterns
  const parts = text.split(/(\d{1,2}:\d{2}(?::\d{2})?)/g);
  return (
    <>
      {parts.map((part, i) => {
        const sec = parseTimeToSeconds(part);
        if (sec !== null) {
          return (
            <button
              key={i}
              onClick={() => onTimeClick(sec)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors font-mono text-[11px] font-semibold cursor-pointer mx-0.5"
              title={`Jump to ${part} in video`}
            >
              <Clock className="w-3 h-3" />
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────
export default function Dashboard({ analysis, setAnalysis, onCardClick }) {

  const [customPrompt, setCustomPrompt] = useState('');
  const [customSummary, setCustomSummary] = useState('');
  const [isScanningCustom, setIsScanningCustom] = useState(false);
  const [selectedVideoEvent, setSelectedVideoEvent] = useState(null);
  const [selectedDocEvent, setSelectedDocEvent] = useState(null);
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);
  const [queryPrefill, setQueryPrefill] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1); // 1, 2, 3
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [importantEvents, setImportantEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showEventsDropdown, setShowEventsDropdown] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [caseQuestion, setCaseQuestion] = useState('');
  const [caseAnswer, setCaseAnswer] = useState('');
  const [askingCase, setAskingCase] = useState(false);
  
  // ── Missing Refs & Stats Block Added Back Here ──
  const contradictionsRef = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const pdfIframeRef = useRef(null);
  const pdfSectionRef = useRef(null);
  const askBoxRef = useRef(null);
  const askInputRef = useRef(null);
  const [pdfPage, setPdfPage] = useState(1);

  const highCount = analysis.contradictions?.filter(c => c.severity === 'high').length || 0;
  const medCount = analysis.contradictions?.filter(c => c.severity === 'medium').length || 0;
  const totalCount = analysis.contradictions?.length || 0;

  const visibleContradictions = activeFilter
    ? analysis.contradictions?.filter(c => c.severity === activeFilter)
    : analysis.contradictions;

  // Build keyframe lookup: timestamp → URL
  const keyframeLookup = useMemo(() => {
    const map = {};
    if (analysis.keyframes?.length) {
      for (const kf of analysis.keyframes) {
        map[kf.ts] = kf.path;
      }
    }
    return map;
  }, [analysis.keyframes]);

  // Find nearest keyframe for a timeline event
  const findNearestKeyframe = useCallback((ts) => {
    if (!analysis.keyframes?.length || ts == null) return null;
    let best = null, bestDist = Infinity;
    for (const kf of analysis.keyframes) {
      const dist = Math.abs(kf.ts - ts);
      if (dist < bestDist) { bestDist = dist; best = kf.path; }
    }
    return bestDist < 300 ? best : null; // within 5 minutes
  }, [analysis.keyframes]);

  // ── Dynamic timeline: expands with zoom level ──
  const expandedTimeline = useMemo(() => {
    const aiEvents = analysis.timeline || [];
    if (zoomLevel === 1 || !analysis.keyframes?.length) return aiEvents;

    // Build set of timestamps already covered by AI events (±30s tolerance)
    const aiTimestamps = new Set();
    for (const e of aiEvents) {
      if (e.timestamp_seconds != null) {
        for (let t = e.timestamp_seconds - 30; t <= e.timestamp_seconds + 30; t++) {
          aiTimestamps.add(t);
        }
      }
    }

    // Generate keyframe-based entries for timestamps NOT covered by AI
    const keyframeEvents = [];
    for (const kf of analysis.keyframes) {
      if (!aiTimestamps.has(kf.ts)) {
        const h = Math.floor(kf.ts / 3600);
        const m = Math.floor((kf.ts % 3600) / 60);
        const s = Math.floor(kf.ts % 60);
        const timeStr = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        keyframeEvents.push({
          time: timeStr,
          timestamp_seconds: kf.ts,
          label: `Video scene at ${timeStr}`,
          source: 'video',
          description: `Analyzed frame captured at ${timeStr}. Click to jump to this moment in the video and inspect what is happening at this point.`,
          icon: 'camera',
          _isKeyframe: true, // marker for rendering
        });
      }
    }

    if (zoomLevel === 2) {
      // Mix AI events + every other keyframe event
      const sparse = keyframeEvents.filter((_, i) => i % 2 === 0);
      const merged = [...aiEvents, ...sparse];
      merged.sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));
      return merged;
    }

    // Zoom 3: ALL events
    const merged = [...aiEvents, ...keyframeEvents];
    merged.sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));
    return merged;
  }, [analysis.timeline, analysis.keyframes, zoomLevel]);

  // Navigate PDF to a specific page (no scroll — just change the page)
  const seekPdf = useCallback((page) => {
    if (!page) return;
    setPdfPage(page);
  }, []);

  const handleStatClick = (filter) => {
    setActiveFilter(prev => prev === filter ? null : filter);
    setTimeout(() => {
      contradictionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleSave = useCallback(async (type) => {
    setShowSaveMenu(false);
    if (type === 'firebase') {
      setSaving(true);
      try { await saveReport(analysis); setSaved(true); setTimeout(() => setSaved(false), 2500); }
      catch (e) { console.error('Save failed:', e); }
      finally { setSaving(false); }
    } else if (type === 'text') {
      downloadTextReport(analysis);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } else {
      downloadJSON(analysis);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    }
  }, [analysis]);

  // Seek video to a specific timestamp in seconds
  const handleSeekVideo = useCallback((seconds) => {
    if (seconds == null) return;
    // Try video first, then audio
    if (videoRef.current) {
      seekVideo(videoRef, seconds);
    } else if (audioRef.current) {
      try {
        audioRef.current.currentTime = seconds;
        audioRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { }
    }
  }, []);

  const handleVideoTimelineClick = (event) => {
    setSelectedVideoEvent(prev =>
      prev?.label === event.label && prev?.timestamp_seconds === event.timestamp_seconds ? null : event
    );
    // Seek video to the clicked event's timestamp
    if (event.timestamp_seconds != null) {
      handleSeekVideo(event.timestamp_seconds);
    }
  };

  const handleDocTimelineClick = (event) => {
    setSelectedDocEvent(prev =>
      prev?.label === event.label && prev?.timestamp_seconds === event.timestamp_seconds ? null : event
    );
  };

  const handleCustomScan = async () => {
    if (!customPrompt.trim() || !customStart.trim() || !customEnd.trim()) return;
    setIsScanningCustom(true);
    setCustomSummary('');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/scan-range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: analysis.files?.video || analysis.files?.audio,
          query: customPrompt,
          startTime: customStart,
          endTime: customEnd
        })
      });
      const data = await res.json();
      setCustomSummary(data.summary || data.message || 'No summary available.');
    } catch (err) {
      setCustomSummary('Failed to fetch custom range analysis.');
    } finally {
      setIsScanningCustom(false);
    }
  };

  const handleLoadImportantEvents = async () => {
    if (loadingEvents || importantEvents.length > 0) {
      setShowEventsDropdown(v => !v);
      return;
    }
    setLoadingEvents(true);
    setEventsError('');
    setShowEventsDropdown(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/important-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: analysis.files?.video,
          videoDuration: analysis.videoDuration || 3600,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      setImportantEvents(data.events || []);
    } catch (err) {
      setEventsError(err.message || 'Could not extract important events.');
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleAskCase = async (e) => {
    e?.preventDefault();
    if (!caseQuestion.trim() || askingCase) return;
    setAskingCase(true);
    setCaseAnswer('');
    try {
      let ctx = `Case: ${analysis.caseName}\nSummary: ${analysis.summary}\n\nKey findings:\n`;
      (analysis.contradictions || []).forEach(c => {
        ctx += `- [${c.severity}] ${c.title}: ${c.description}\n`;
      });
      (analysis.keyObservations || []).forEach(o => {
        ctx += `- ${o.title}: ${o.description}\n`;
      });
      const res = await fetch(`${import.meta.env.BASE_URL}api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: caseQuestion.trim(), context: ctx }),
      });
      const data = await res.json();
      setCaseAnswer(data.answer || data.message || 'No answer returned.');
    } catch {
      setCaseAnswer('Could not get an answer — check your connection.');
    } finally {
      setAskingCase(false);
    }
  };
  const stats = [
    {
      icon: AlertTriangle, label: 'Serious', sublabel: 'Needs attention now',
      value: highCount, color: 'text-red-500', bg: 'bg-red-500/10',
      filter: 'high', active: activeFilter === 'high',
    },
    {
      icon: AlertCircle, label: 'Moderate', sublabel: 'Should be reviewed',
      value: medCount, color: 'text-amber-500', bg: 'bg-amber-500/10',
      filter: 'medium', active: activeFilter === 'medium',
    },
    {
      icon: BarChart3, label: 'All Issues', sublabel: `${highCount} serious · ${medCount} moderate`,
      value: totalCount, color: 'text-violet-500', bg: 'bg-violet-500/10',
      filter: null, active: activeFilter === null,
    },
  ];

  const zoomLabels = { 1: 'Overview', 2: 'Detailed', 3: 'Frame View' };

  // Filter video events based on dropdown
  const videoTrackEvents = expandedTimeline.filter(e => e.source === 'video' || e.source === 'conflict');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}
      className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

      {/* ── Stats (clickable filters) ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-3 gap-3 mb-8">
        {stats.map((stat, i) => (
          <motion.button key={i}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
            onClick={() => handleStatClick(stat.filter)}
            className={`p-4 rounded-2xl border text-left transition-all duration-200 ${stat.active
                ? 'bg-white dark:bg-neutral-900/60 border-violet-500/50 shadow-md ring-1 ring-violet-500/20'
                : 'bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
              }`}
          >
            <div className={`p-2 rounded-lg ${stat.bg} w-fit mb-2`}><stat.icon className={`w-4 h-4 ${stat.color}`} /></div>
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{stat.label}</p>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">{stat.sublabel}</p>
            {stat.filter !== null && (
              <p className="text-[10px] text-violet-500 mt-1">{stat.active ? '✓ Filtering' : 'Click to filter'}</p>
            )}
          </motion.button>
        ))}
      </motion.div>

      {/* ── Summary + Save ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="p-5 rounded-2xl bg-violet-500/5 border border-violet-500/10 mb-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-500 mb-2">Summary</h3>
            <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{analysis.summary}</p>
          </div>
          <div className="relative shrink-0">
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowSaveMenu(!showSaveMenu)} disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${saved ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                }`}>
              {saved ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
            </motion.button>
            <AnimatePresence>
              {showSaveMenu && (
                <motion.div initial={{ opacity: 0, y: -5, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden z-20 min-w-[180px]">
                  <button onClick={() => handleSave('firebase')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-violet-500" /> Save Report
                  </button>
                  <button onClick={() => handleSave('text')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2 border-t border-neutral-100 dark:border-neutral-700">
                    <FileText className="w-4 h-4 text-neutral-400" /> Download Text
                  </button>
                  <button onClick={() => handleSave('json')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2 border-t border-neutral-100 dark:border-neutral-700">
                    <BarChart3 className="w-4 h-4 text-neutral-400" /> Download JSON
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* ── Ask Anything About This Case ── */}
      <div ref={askBoxRef} className="mb-8">
        <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-500/8 to-blue-500/8 border border-violet-500/20">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-violet-500" />
            <p className="text-sm font-semibold text-violet-600 dark:text-violet-400">Ask anything about this case</p>
            <span className="text-[10px] text-neutral-400 ml-1">— get instant answers from the evidence</span>
          </div>
          <form onSubmit={handleAskCase} className="flex gap-2">
            <input
              ref={askInputRef}
              value={caseQuestion}
              onChange={e => setCaseQuestion(e.target.value)}
              placeholder="e.g. What are the key contradictions? What does the FOIA request say? Who testified at what time?"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-violet-200 dark:border-violet-800/40 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50 transition-all"
            />
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              type="submit" disabled={askingCase || !caseQuestion.trim()}
              className="p-2.5 rounded-xl bg-violet-500 text-white disabled:opacity-40 hover:bg-violet-600 transition-all shrink-0"
            >
              {askingCase ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </motion.button>
          </form>
          <AnimatePresence>
            {caseAnswer && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-3 p-4 rounded-xl bg-white dark:bg-neutral-900 border border-violet-100 dark:border-violet-900/30">
                <p className="text-xs font-semibold text-violet-500 mb-1.5">Answer</p>
                <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{caseAnswer}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Evidence Files ── */}
      {(analysis.files?.video || analysis.files?.audio || analysis.files?.pdf) && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-4 flex items-center gap-2">
            <Eye className="w-4 h-4" /> Evidence Files
            <span className="text-[10px] font-normal normal-case text-neutral-400 ml-1">Click video timeline pins to jump · Click document pins to navigate pages</span>
          </h2>
          {/* Always: video/audio left, PDF right */}
          <div className={`grid gap-4 ${
            (analysis.files?.video || analysis.files?.audio) && analysis.files?.pdf
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1'
          }`}>
            {/* Left: video then audio */}
            <div className="flex flex-col gap-4">
              {analysis.files?.video && (
                <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-black" id="evidence-video-container">
                  <div className="px-4 py-2.5 bg-neutral-900/80 flex items-center gap-2 border-b border-neutral-700">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-medium text-neutral-300">Video Evidence</span>
                  </div>
                  <video ref={videoRef} src={analysis.files.video} controls className="w-full max-h-[400px] object-contain bg-black" preload="metadata" />
                </div>
              )}
              {analysis.files?.audio && (
                <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden p-4 bg-white dark:bg-neutral-900/60">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-medium text-neutral-500">Audio Recording</span>
                  </div>
                  <audio ref={audioRef} src={analysis.files.audio} controls className="w-full" />
                </div>
              )}
            </div>
            {/* Right: PDF document */}
            {analysis.files?.pdf && (
              <div ref={pdfSectionRef} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden" style={{ height: 520 }}>
                <div className="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-900 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs font-medium text-neutral-500">Document — Page {pdfPage}</span>
                </div>
                <iframe
                  ref={pdfIframeRef}
                  key={pdfPage}
                  src={`${analysis.files.pdf}#page=${pdfPage}&toolbar=1&navpanes=0&view=FitH`}
                  className="w-full border-0"
                  style={{ height: 480, display: 'block' }}
                  title="Document"
                />
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Timeline (split by source) ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Timeline
            </h2>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-neutral-400 mr-1 hidden sm:inline">{zoomLabels[zoomLevel]}</span>
            
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setZoomLevel(z => Math.max(1, z - 1))}
              disabled={zoomLevel <= 1}
              className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5 text-neutral-500" />
            </motion.button>
            
            <div className="flex gap-0.5">
              {[1, 2, 3].map(z => (
                <button 
                  key={z} 
                  onClick={() => setZoomLevel(z)}
                  className={`w-2 h-2 rounded-full transition-all ${z === zoomLevel ? 'bg-violet-500 scale-125' : 'bg-neutral-300 dark:bg-neutral-600 hover:bg-neutral-400'}`}
                />
              ))}
            </div>
            
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setZoomLevel(z => Math.min(3, z + 1))}
              disabled={zoomLevel >= 3}
              className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5 text-neutral-500" />
            </motion.button>
          </div>
        </div>

        {/* ── ALWAYS VISIBLE: Custom Range Request UI ── */}
        <div className="mb-8 p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm">
          <h3 className="text-sm font-semibold mb-3">Targeted Scan (Custom Time Range)</h3>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase text-neutral-500 mb-1 block">Start Time</label>
                <input
                  type="text"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  placeholder="e.g. 01:00"
                  className="w-full px-4 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase text-neutral-500 mb-1 block">End Time</label>
                <input
                  type="text"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  placeholder="e.g. 02:30"
                  className="w-full px-4 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
            </div>
            
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase text-neutral-500 mb-1 block">What should I look for?</label>
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCustomScan()}
                  placeholder="e.g. Summarize the conversation here"
                  className="w-full px-4 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <button 
                onClick={handleCustomScan} 
                disabled={isScanningCustom || !customPrompt || !customStart || !customEnd} 
                className="px-4 py-2 h-[38px] bg-violet-500 text-white text-sm font-medium rounded-lg hover:bg-violet-600 disabled:opacity-50 transition-colors flex items-center gap-2 shrink-0"
              >
                {isScanningCustom ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {isScanningCustom ? 'Scanning...' : 'Scan Range'}
              </button>
            </div>
          </div>
          
          {customSummary && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 bg-violet-50 dark:bg-violet-900/10 rounded-lg border border-violet-100 dark:border-violet-900/20">
              <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">{customSummary}</p>
            </motion.div>
          )}
        </div>

        {/* Video track */}
        {videoTrackEvents.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Video Timeline</span>
              <span className="text-[10px] text-neutral-400">({videoTrackEvents.length} events)</span>
              {/* Important Events dropdown button */}
              {analysis.files?.video && (
                <div className="relative ml-auto">
                  <button
                    onClick={handleLoadImportantEvents}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-all"
                  >
                    {loadingEvents ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                    Important Events
                    <ChevronDown className={`w-3 h-3 transition-transform ${showEventsDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showEventsDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                        className="absolute right-0 top-full mt-2 w-80 max-h-80 overflow-y-auto rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl z-30 p-3 space-y-2"
                      >
                        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Key Events in Video</p>
                        {loadingEvents && (
                          <div className="flex items-center gap-2 py-4 justify-center">
                            <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                            <span className="text-xs text-neutral-400">Analyzing full video...</span>
                          </div>
                        )}
                        {eventsError && <p className="text-xs text-red-500 py-2">{eventsError}</p>}
                        {importantEvents.map((ev, i) => (
                          <button
                            key={i}
                            onClick={() => { handleSeekVideo(ev.timestamp_seconds); setShowEventsDropdown(false); }}
                            className="w-full text-left p-3 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/10 border border-transparent hover:border-amber-200 dark:hover:border-amber-800/30 transition-all group"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                ev.importance === 'critical' ? 'bg-red-500/10 text-red-500' :
                                ev.importance === 'high' ? 'bg-amber-500/10 text-amber-500' :
                                'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
                              }`}>{ev.importance?.toUpperCase() || 'EVENT'}</span>
                              <span className="text-xs font-mono text-amber-600 dark:text-amber-400">{ev.time}</span>
                            </div>
                            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-0.5">{ev.title}</p>
                            <p className="text-[11px] text-neutral-500 leading-snug line-clamp-2">{ev.description}</p>
                          </button>
                        ))}
                        {!loadingEvents && importantEvents.length === 0 && !eventsError && (
                          <p className="text-xs text-neutral-400 text-center py-3">No events loaded yet.</p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
            <div className="overflow-x-auto pb-3 -mx-4 px-4">
              <div className="flex items-start gap-1 min-w-max py-1">
                {videoTrackEvents.map((event, i, arr) => (
                  <TimelineNode key={`v-${event.timestamp_seconds}-${i}`} event={event} index={i} total={arr.length}
                    isSelected={selectedVideoEvent?.label === event.label && selectedVideoEvent?.timestamp_seconds === event.timestamp_seconds}
                    onClick={handleVideoTimelineClick}
                    zoom={zoomLevel}
                    keyframeUrl={findNearestKeyframe(event.timestamp_seconds)}
                  />
                ))}
              </div>
            </div>
            {/* Video detail box - appears right under video timeline */}
            <AnimatePresence>
              {selectedVideoEvent && (
                <TimelineDetail
                  event={selectedVideoEvent}
                  onClose={() => setSelectedVideoEvent(null)}
                  onQuery={(q) => {
                    setSelectedVideoEvent(null);
                    setCaseQuestion(q);
                    setTimeout(() => {
                      askBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      setTimeout(() => askInputRef.current?.focus(), 300);
                    }, 50);
                  }}
                  onSeekVideo={handleSeekVideo}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Document track — dropdown list of page summaries */}
        {expandedTimeline.some(e => e.source === 'pdf' || e.source === 'image') && (() => {
          const docEvents = expandedTimeline.filter(e => e.source === 'pdf' || e.source === 'image');
          return (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Document</span>
                <span className="text-[10px] text-neutral-400">({docEvents.length} pages analyzed)</span>
                <div className="relative ml-auto">
                  <button
                    onClick={() => setDocDropdownOpen(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Document Pages
                    <ChevronDown className={`w-3 h-3 transition-transform ${docDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {docDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                        className="absolute right-0 top-full mt-2 w-96 max-h-96 overflow-y-auto rounded-2xl border border-blue-200 dark:border-blue-800/40 bg-white dark:bg-neutral-900 shadow-xl z-30 p-3 space-y-1.5"
                      >
                        <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-2 px-1">Document Page Summaries</p>
                        {docEvents.map((event, i) => {
                          const rvs = event.related_video_seconds;
                          const rvLabel = rvs != null ? formatEventTime(null, rvs) : null;
                          return (
                            <button
                              key={`doc-drop-${i}`}
                              onClick={() => {
                                if (event.page) seekPdf(event.page);
                                setSelectedDocEvent(event);
                                setDocDropdownOpen(false);
                              }}
                              className={`w-full text-left p-3 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/10 border transition-all group ${
                                selectedDocEvent?.label === event.label && selectedDocEvent?.page === event.page
                                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/15'
                                  : 'border-transparent hover:border-blue-200 dark:hover:border-blue-800/30'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                  <FileText className="w-2.5 h-2.5" />
                                  {event.page ? `Page ${event.page}` : `Section ${i + 1}`}
                                </span>
                                {rvLabel && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                                    <Camera className="w-2.5 h-2.5" /> {rvLabel}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-0.5">{event.label}</p>
                              <p className="text-[11px] text-neutral-500 leading-snug line-clamp-2">{event.description}</p>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Compact page pill bar — click any page to navigate */}
              <div className="overflow-x-auto pb-2 -mx-4 px-4">
                <div className="flex items-end gap-2 min-w-max py-1">
                  {(() => {
                    // Detect if all doc events share the same related_video_seconds — if so, hide them (not useful)
                    const allRvs = docEvents.map(e => e.related_video_seconds > 0 ? e.related_video_seconds : null).filter(Boolean);
                    const uniqueRvs = new Set(allRvs);
                    const allSameTimestamp = uniqueRvs.size <= 1 && allRvs.length > 1;

                    return docEvents.map((event, i) => {
                      const rvs = event.related_video_seconds > 0 ? event.related_video_seconds : null;
                      const rvLabel = (rvs != null && !allSameTimestamp) ? formatEventTime(null, rvs) : null;
                      return (
                        <div key={`dp-wrap-${i}`} className="flex flex-col items-center gap-1 shrink-0">
                          {/* Video timestamp badge ABOVE the page pill — click to seek video (only if unique per page) */}
                          {rvLabel && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSeekVideo(rvs); }}
                              className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 hover:bg-amber-500/30 transition-colors flex items-center gap-0.5 whitespace-nowrap"
                              title={`This page discussed at ${rvLabel} in video — click to jump`}
                            >
                              <Camera className="w-2.5 h-2.5" /> {rvLabel}
                            </button>
                          )}
                          {/* Page pill */}
                          <motion.button
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.1 + i * 0.02 }}
                            onClick={() => {
                              if (event.page) seekPdf(event.page);
                              setSelectedDocEvent(prev =>
                                prev?.label === event.label && prev?.page === event.page ? null : event
                              );
                            }}
                            className={`flex flex-col items-center px-3 py-2 rounded-xl border transition-all cursor-pointer group hover:shadow-md min-w-[90px] ${
                              selectedDocEvent?.label === event.label && selectedDocEvent?.page === event.page
                                ? 'bg-blue-500/10 border-blue-400 dark:border-blue-600 ring-1 ring-blue-400/30'
                                : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                            title={event.label}
                          >
                            <FileText className={`w-4 h-4 mb-0.5 ${
                              selectedDocEvent?.label === event.label && selectedDocEvent?.page === event.page
                                ? 'text-blue-500' : 'text-neutral-400 group-hover:text-blue-500'
                            }`} />
                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                              {event.page ? `Page ${event.page}` : `#${i + 1}`}
                            </span>
                            <p className="text-[9px] mt-0.5 max-w-[90px] text-center leading-tight text-neutral-500 dark:text-neutral-400 line-clamp-2">
                              {event.label}
                            </p>
                          </motion.button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Document detail box - appears right under document section */}
              <AnimatePresence>
                {selectedDocEvent && (
                  <TimelineDetail
                    event={selectedDocEvent}
                    onClose={() => setSelectedDocEvent(null)}
                    onQuery={(q) => {
                      setSelectedDocEvent(null);
                      setCaseQuestion(q);
                      setTimeout(() => {
                        askBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => askInputRef.current?.focus(), 300);
                      }, 50);
                    }}
                    onSeekVideo={seekPdf}
                    onSeekVideoTimestamp={handleSeekVideo}
                  />
                )}
              </AnimatePresence>
            </div>
          );
        })()}

        {/* Audio-only track (if standalone audio file) */}
        {expandedTimeline.some(e => e.source === 'audio') && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Audio</span>
            </div>
            <div className="overflow-x-auto pb-3 -mx-4 px-4">
              <div className="flex items-start gap-1 min-w-max py-1">
                {expandedTimeline.filter(e => e.source === 'audio').map((event, i, arr) => (
                  <TimelineNode key={`a-${i}`} event={event} index={i} total={arr.length}
                    isSelected={selectedVideoEvent?.label === event.label && selectedVideoEvent?.timestamp_seconds === event.timestamp_seconds}
                    onClick={handleVideoTimelineClick}
                    zoom={zoomLevel}
                    keyframeUrl={findNearestKeyframe(event.timestamp_seconds)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {zoomLevel > 1 && (
          <p className="text-[10px] text-neutral-400 mt-1 text-center">
            Showing {expandedTimeline.length} events · {zoomLevel === 2 ? 'AI events + key frames' : 'All analyzed frames'}
          </p>
        )}

      </motion.div>

      {/* ── Key Observations ── */}
      {analysis.keyObservations?.length > 0 && (() => {
        // Pre-compute inferred timestamps for all observations and detect if they're all the same
        const obsWithTs = analysis.keyObservations.map(obs => {
          let inferredTs = obs.timestamp_seconds > 0 ? obs.timestamp_seconds : null;
          if (!inferredTs && analysis.files?.video) {
            const titleWords = (obs.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
            const match = (analysis.timeline || []).find(e =>
              e.timestamp_seconds > 0 &&
              titleWords.some(w => (e.label || '').toLowerCase().includes(w) || (e.description || '').toLowerCase().includes(w))
            );
            if (match) inferredTs = match.timestamp_seconds;
          }
          return { obs, inferredTs };
        });

        const allTs = obsWithTs.map(o => o.inferredTs).filter(Boolean);
        const uniqueTs = new Set(allTs);
        const allSameTs = uniqueTs.size <= 1 && allTs.length > 1;

        return (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-4 flex items-center gap-2">
              <Lightbulb className="w-4 h-4" /> Key Observations ({analysis.keyObservations.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {obsWithTs.map(({ obs, inferredTs }, i) => {
                // Only show video timestamp if it's unique across observations
                const showVideoTs = inferredTs != null && !allSameTs && analysis.files?.video;
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.05 }}
                    className="p-4 rounded-2xl bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800">
                    <div className="flex items-start gap-2 mb-2">
                      <Eye className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                      <p className="text-sm font-semibold">{obs.title}</p>
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed mb-2">
                      <ClickableText text={obs.description} onTimeClick={handleSeekVideo} />
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {showVideoTs && (
                        <button
                          onClick={() => handleSeekVideo(inferredTs)}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors flex items-center gap-1 font-medium"
                        >
                          <Camera className="w-3 h-3" /> Video @ {formatEventTime(null, inferredTs)}
                          {!obs.timestamp_seconds && <span className="opacity-60 ml-0.5">(~)</span>}
                        </button>
                      )}
                      {obs.page != null && (
                        <button
                          onClick={() => seekPdf(obs.page)}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center gap-1 font-medium"
                        >
                          <FileText className="w-3 h-3" /> Page {obs.page}
                        </button>
                      )}
                      {obs.relatedSources?.map((s, j) => (
                        <span key={j} className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500">{s}</span>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        );
      })()}

      {/* ── Contradictions ── */}
      <div ref={contradictionsRef}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {activeFilter ? `${activeFilter === 'high' ? 'Serious' : 'Moderate'} Issues` : `Differences Found`}
            {' '}({visibleContradictions?.length || 0})
          </h2>
          {activeFilter && (
            <button onClick={() => setActiveFilter(null)}
              className="text-xs text-violet-500 hover:underline flex items-center gap-1">
              <X className="w-3 h-3" /> Clear filter
            </button>
          )}
        </div>
        {(!visibleContradictions || visibleContradictions.length === 0) && (
          <div className="p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/15 text-center">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-1">No contradictions detected</p>
            <p className="text-xs text-neutral-500">
              {!analysis.files?.video && !analysis.files?.audio
                ? 'Upload a video or audio file alongside the document to enable cross-reference contradiction detection.'
                : 'The AI found no significant inconsistencies between the evidence files after adversarial verification.'}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleContradictions?.map((c, i) => (
            <ContradictionCard key={c.id || i} contradiction={c} index={i} onClick={(contradiction) => {
              // Evidence linkage: sync video + PDF when clicking a contradiction
              const videoSource = (contradiction.sources || []).find(s => s.type === 'video');
              const pdfSource = (contradiction.sources || []).find(s => s.type === 'pdf');

              // Jump video to the contradiction timestamp
              if (videoSource?.timestamp > 0) {
                handleSeekVideo(videoSource.timestamp);
              }
              // Jump PDF to the contradiction page
              if (pdfSource?.page > 0) {
                seekPdf(pdfSource.page);
              }

              // Also fire original handler for any parent behavior
              if (onCardClick) onCardClick(contradiction);
            }} />
          ))}
        </div>
      </div>

    </motion.div>
  );
}