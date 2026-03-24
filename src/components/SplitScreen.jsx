import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, FileText, Headphones, Video, Quote, Clock, BookOpen, Image, Eye, Send, Loader2 } from 'lucide-react';
import { getSeverityConfig, formatTimestamp, normalizeSources } from '../utils/api';

const sourceIcons  = { pdf: FileText, audio: Headphones, video: Video, image: Image };
const sourceColors = { pdf: 'text-blue-500', audio: 'text-emerald-500', video: 'text-amber-500', image: 'text-blue-500' };
const sourceBgColors = { pdf: 'bg-blue-500/10', audio: 'bg-emerald-500/10', video: 'bg-amber-500/10', image: 'bg-blue-500/10' };

function isImageFile(p) {
  if (!p) return false;
  return ['jpg','jpeg','png','gif','webp','bmp','tiff','tif','heic','heif','svg'].includes(p.split('.').pop().toLowerCase());
}

// ── Source Panel ────────────────────────────────────────────────────────
function SourcePanel({ source, file, label, index }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const Icon = sourceIcons[source.type] || FileText;

  useEffect(() => {
    const seekTo = source.timestamp ?? null;
    if (seekTo == null || seekTo < 0) return;
    if (source.type === 'video' && videoRef.current) {
      const go = () => { try { videoRef.current.currentTime = seekTo; } catch {} };
      videoRef.current.readyState >= 1 ? go() : videoRef.current.addEventListener('loadedmetadata', go, { once: true });
    }
    if (source.type === 'audio' && audioRef.current) {
      const go = () => { try { audioRef.current.currentTime = seekTo; } catch {} };
      audioRef.current.readyState >= 1 ? go() : audioRef.current.addEventListener('loadedmetadata', go, { once: true });
    }
  }, [source]);

  const isImg = source.type === 'image' || (file && isImageFile(file));
  // A video file can serve audio if the source thinks it's audio
  const renderAsVideo = source.type === 'video' || (source.type === 'audio' && file && !isImageFile(file) && (file.includes('.mp4') || file.includes('.mkv') || file.includes('.mov') || file.includes('.webm') || file.includes('.avi')));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.08, duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <div className={`p-2 rounded-xl ${sourceBgColors[source.type] || sourceBgColors.pdf}`}>
          <Icon className={`w-5 h-5 ${sourceColors[source.type] || sourceColors.pdf}`} />
        </div>
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{source.label}</p>
        </div>
      </div>

      {/* Card */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 overflow-hidden flex flex-col h-full">
        {/* Reference bar */}
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3 flex-wrap">
          {source.page && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <BookOpen className="w-3.5 h-3.5" /> Page {source.page}
            </span>
          )}
          {source.timestamp != null && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="w-3.5 h-3.5" /> {formatTimestamp(source.timestamp)}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
          {source.finding && (
            <div className="px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
              <p className="text-xs font-medium text-violet-600 dark:text-violet-400">{source.finding}</p>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + index * 0.08 }}
            className="p-4 rounded-xl bg-white dark:bg-neutral-800/80 border-l-4 border-violet-500"
          >
            <div className="flex items-start gap-2">
              <Quote className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed italic text-neutral-700 dark:text-neutral-300">{source.quote}</p>
            </div>
          </motion.div>

          {/* VIDEO player — shown for type:video (or type:audio with a video file) */}
          {renderAsVideo && file && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} src={file} controls className="w-full max-h-[260px] object-contain" />
            </motion.div>
          )}

          {/* AUDIO player — only for true standalone audio files */}
          {source.type === 'audio' && !renderAsVideo && file && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
              <audio ref={audioRef} src={file} controls className="w-full" />
            </motion.div>
          )}

          {/* Image */}
          {isImg && file && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="rounded-xl overflow-hidden">
              <img src={file} alt={source.label} className="w-full max-h-[260px] object-contain bg-white dark:bg-neutral-800 rounded-xl" />
            </motion.div>
          )}

          {/* PDF embed */}
          {source.type === 'pdf' && file && !isImg && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700" style={{ height: 320 }}>
              <iframe
                src={`${file}#page=${source.page || 1}&toolbar=1&navpanes=0`}
                className="w-full h-full border-0"
                style={{ background: '#fff' }}
                title="PDF Viewer"
              />
            </motion.div>
          )}

          {/* No file available */}
          {!file && (
            <div className="flex items-center justify-center p-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/40">
              <div className="text-center">
                <Icon className={`w-8 h-8 mx-auto mb-2 ${sourceColors[source.type] || sourceColors.pdf} opacity-40`} />
                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Preview not available</p>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">Quote and findings above are from the original file</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Inline Query Box ────────────────────────────────────────────────────
function QueryBox({ contradiction }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer]     = useState('');
  const [loading, setLoading]   = useState(false);

  const context = [
    `Issue: ${contradiction.title}`,
    `Description: ${contradiction.description}`,
    ...(contradiction.sources || []).map((s, i) =>
      `Source ${i+1} (${s.type}, ${s.label}): ${s.finding || ''} — "${(s.quote||'').substring(0,200)}"`
    ),
    contradiction.additionalNotes ? `Notes: ${contradiction.additionalNotes}` : '',
  ].filter(Boolean).join('\n');

  const submit = async (e) => {
    e?.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setAnswer('');
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), context }),
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
      className="mb-6 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm">
      <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-3 flex items-center gap-1.5">
        <Send className="w-3.5 h-3.5" /> Ask about this discrepancy
      </p>
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. Why does this matter? What could explain it?"
          className="flex-1 px-4 py-2 text-sm rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
        />
        <motion.button whileTap={{ scale: 0.93 }} type="submit" disabled={loading || !question.trim()}
          className="p-2 rounded-xl bg-violet-500 text-white disabled:opacity-40 hover:bg-violet-600 transition-all shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </motion.button>
      </form>
      <AnimatePresence>
        {answer && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15">
            <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main SplitScreen ────────────────────────────────────────────────────
export default function SplitScreen({ contradiction, files, analysisFiles, onBack }) {
  const sev = getSeverityConfig(contradiction.severity);
  const sources = normalizeSources(contradiction);

  // Smart file lookup: prefer server path, then blob URL, then fallback audio→video
  const getFilePath = (type) => {
    if (analysisFiles?.[type]) return analysisFiles[type];
    if (files?.[type]) return URL.createObjectURL(files[type]);
    // Fallback: if audio requested but only video exists, use video file
    // (shouldn't happen after server normalization, but safety net)
    if (type === 'audio') {
      if (analysisFiles?.video) return analysisFiles.video;
      if (files?.video) return URL.createObjectURL(files.video);
    }
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-[calc(100vh-4rem)] flex flex-col"
    >
      {/* Top bar */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="px-4 sm:px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-16 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sev.dot}`} />
            <h2 className="text-base font-semibold truncate">{contradiction.title}</h2>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${sev.bg} bg-opacity-15 ${sev.color} shrink-0`}>{sev.label}</span>
        </div>
      </motion.div>

      {/* Description */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="px-4 sm:px-6 py-3 bg-neutral-50 dark:bg-neutral-900/50 border-b border-neutral-200 dark:border-neutral-800">
        <p className="max-w-6xl mx-auto text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {contradiction.description}
        </p>
      </motion.div>

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full">

        {/* Query box — above sources */}
        <QueryBox contradiction={contradiction} />

        {/* Source panels — always 2 col on desktop */}
        <div className={`grid gap-4 ${sources.length === 1 ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
          {sources.map((src, i) => (
            <SourcePanel
              key={i}
              source={src}
              file={getFilePath(src.type)}
              label={`Source ${i + 1}`}
              index={i}
            />
          ))}
        </div>

        {/* Additional notes */}
        {contradiction.additionalNotes && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="mt-4 p-4 rounded-2xl bg-violet-500/5 border border-violet-500/10">
            <div className="flex items-start gap-2.5">
              <Eye className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-1">Additional Notes</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{contradiction.additionalNotes}</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
