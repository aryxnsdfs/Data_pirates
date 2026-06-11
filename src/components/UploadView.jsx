import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Headphones, Video, Upload, Sparkles, X, AlertCircle, Zap, Clock, ChevronRight, Folder, HardDrive, Trash2, Cloud, Info, CheckCircle2, Download, Rocket } from 'lucide-react';
import { getSavedReports, deleteReport } from '../utils/storage';
import { detectLocalServer } from '../utils/api';

function HowToGuide({ isLocal }) {
  const [open, setOpen] = useState(false);

  const uploadSteps = [
    { step: '1', text: 'Drop or click to add your video footage, documents (PDF/images), or audio recordings into the boxes below.' },
    { step: '2', text: 'Mix evidence types for best results — e.g. a court video + a document PDF will find contradictions between them.' },
    { step: '3', text: 'Click Analyze Evidence and wait ~2 min while AI cross-references everything.' },
    { step: '4', text: 'Results are automatically saved to the cloud and appear in Saved Reports for future access.' },
  ];

  const localSteps = [
    { step: '1', text: 'Switch to the Local Files tab (only visible when the server is running on this machine).' },
    { step: '2', text: 'Paste the full file path — e.g. C:\\Users\\you\\Videos\\footage.mp4 — into the matching field.' },
    { step: '3', text: 'Click Analyze Local Files. The server reads directly from your disk — no upload, instant start.' },
    { step: '4', text: 'Paths are remembered so next time you can analyze the same files in one click.' },
  ];

  return (
    <motion.div
      variants={itemVariants}
      className="mb-6 rounded-2xl border border-violet-200 dark:border-violet-900/40 bg-violet-500/5 overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-violet-500 shrink-0" />
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">How to get the best results</span>
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          className="text-violet-400 text-xs"
        >▼</motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className={`px-4 pb-4 grid gap-6 ${isLocal ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              {/* Upload mode guide */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Upload className="w-3.5 h-3.5 text-violet-500" />
                  <p className="text-xs font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">Upload Mode</p>
                  <span className="text-[10px] text-neutral-400">— works on any device</span>
                </div>
                <div className="space-y-2">
                  {uploadSteps.map(({ step, text }) => (
                    <div key={step} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</span>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Local mode guide — only show if local server detected */}
              {isLocal && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Local Files Mode</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">Instant</span>
                  </div>
                  <div className="space-y-2">
                    {localSteps.map(({ step, text }) => (
                      <div key={step} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</span>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tips row */}
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              {[
                'Add both video + PDF for contradiction detection',
                'Results auto-save to cloud after every analysis',
                'Install the app for faster local access',
              ].map(tip => (
                <div key={tip} className="flex items-center gap-1.5 text-[10px] text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3 text-violet-400 shrink-0" />
                  {tip}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Where the desktop installer lives (GitHub Releases). Update per release.
const DESKTOP_DOWNLOAD_URL = 'https://github.com/aryxnsdfs/Data_pirates/releases/latest';

// Shown only on the hosted website (not inside the desktop app, not on a local
// server). Drives users to the native desktop app for instant, upload-free speed.
function InstallAppBanner() {
  const isDesktop = typeof window !== 'undefined' && window.dataPiratesDesktop?.isDesktop;
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isLocalHost = /^(localhost|127\.|192\.168\.|10\.|172\.)/.test(host);
  if (isDesktop || isLocalHost) return null;

  return (
    <motion.a
      variants={itemVariants}
      href={DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className="group block mb-6 rounded-2xl border border-violet-400/40 bg-gradient-to-r from-violet-600 to-fuchsia-600 p-[1.5px] shadow-lg shadow-violet-500/20"
    >
      <div className="flex items-center gap-4 rounded-2xl bg-white dark:bg-neutral-950 px-5 py-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shrink-0">
          <Rocket className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-base">Get the Desktop App</p>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Instant · No upload</span>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
            Big files analyze in seconds — the app reads them straight off your disk. No waiting for uploads.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-semibold group-hover:shadow-lg group-hover:shadow-violet-500/30 transition-shadow">
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Download</span>
        </div>
      </div>
    </motion.a>
  );
}

const FILE_CONFIGS = {
  pdf: {
    label: 'Documents & Images',
    accept: '.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tiff,.tif,.heic,.heif,.svg',
    icon: FileText,
    color: 'text-blue-500', bgColor: 'bg-blue-500/10', activeColor: 'border-blue-500/50',
    desc: 'PDF, JPG, PNG, or any image',
  },
  audio: {
    label: 'Audio Recording',
    accept: '.mp3,.wav,.m4a,.ogg,.aac,.flac,.wma,.opus,.amr,.webm',
    icon: Headphones,
    color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', activeColor: 'border-emerald-500/50',
    desc: 'MP3, WAV, AAC, FLAC, OGG, M4A, OPUS',
  },
  video: {
    label: 'Video Footage',
    accept: '.mp4,.webm,.mov,.avi,.mkv,.wmv,.flv,.m4v,.3gp',
    icon: Video,
    color: 'text-amber-500', bgColor: 'bg-amber-500/10', activeColor: 'border-amber-500/50',
    desc: 'MP4, MOV, AVI, MKV, WebM, WMV',
  },
};

function DropZone({ type, files, onDrop, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const cfg = FILE_CONFIGS[type];
  const Icon = cfg.icon;

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);
  const handleDropEvt = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    Array.from(e.dataTransfer.files).forEach(f => onDrop(type, f));
  }, [type, onDrop]);

  const handleInputChange = useCallback((e) => {
    Array.from(e.target.files).forEach(f => onDrop(type, f));
    e.target.value = '';
  }, [type, onDrop]);

  return (
    <motion.div
      whileHover={{ scale: files.length ? 1 : 1.03, y: files.length ? 0 : -2 }}
      whileTap={{ scale: 0.97 }}
      className={`
        relative rounded-2xl border-2 border-dashed p-5 sm:p-6 cursor-pointer
        transition-all duration-300 group min-h-[140px]
        ${dragging ? `${cfg.activeColor} ${cfg.bgColor}` : ''}
        ${files.length ? `border-solid ${cfg.activeColor} ${cfg.bgColor}` : 'border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropEvt}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={cfg.accept} multiple onChange={handleInputChange} className="hidden" />
      <div className="flex flex-col items-center text-center gap-2">
        <motion.div
          animate={dragging ? { scale: 1.2, rotate: 5 } : { scale: 1, rotate: 0 }}
          className={`p-3 rounded-2xl ${cfg.bgColor} transition-colors`}
        >
          <Icon className={`w-6 h-6 ${cfg.color}`} />
        </motion.div>
        {files.length > 0 ? (
          <div className="w-full space-y-1.5 mt-1">
            {files.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white/50 dark:bg-neutral-800/50">
                <p className="text-xs font-medium truncate max-w-[150px]">{file.name}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-neutral-400">{(file.size / (1024 * 1024)).toFixed(1)}MB</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(type, idx); }}
                    className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                  >
                    <X className="w-3 h-3 text-neutral-400" />
                  </button>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-neutral-400 mt-1">+ Drop or click to add more</p>
          </div>
        ) : (
          <>
            <div>
              <p className="font-medium text-sm">{cfg.label}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{cfg.desc}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-neutral-400 group-hover:text-neutral-500 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>Drop files or click to browse</span>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function SavedReports({ onOpenReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    getSavedReports().then(r => { setReports(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    await deleteReport(id).catch(() => {});
    setReports(prev => prev.filter(r => r.id !== id));
  };

  if (loading) return null;
  if (reports.length === 0) return null;

  const visible = showAll ? reports : reports.slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
      className="mt-8 w-full"
    >
      <div className="flex items-center gap-2 mb-4">
        <Folder className="w-4 h-4 text-violet-500" />
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Saved Reports</h3>
        <span className="text-xs text-neutral-400">({reports.length})</span>
        <Cloud className="w-3 h-3 text-violet-400 ml-auto" title="Synced to cloud" />
      </div>
      <div className="space-y-2">
        {visible.map((report) => (
          <motion.div
            key={report.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="group w-full text-left p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors flex items-center gap-3 cursor-pointer"
            onClick={() => onOpenReport(report.analysis)}
          >
            <div className="p-2 rounded-lg bg-violet-500/10 shrink-0">
              <FileText className="w-4 h-4 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{report.caseName || 'Untitled'}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-neutral-400">{report.contradictionCount || 0} findings</span>
                <span className="text-[10px] text-neutral-300 dark:text-neutral-600">&middot;</span>
                <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {report.savedAt ? new Date(report.savedAt).toLocaleDateString() : 'Recently'}
                </span>
                {report._savedFrom && report._savedFrom !== window.location.hostname && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">other device</span>
                )}
              </div>
            </div>
            <button
              onClick={(e) => handleDelete(e, report.id)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-500/10 text-neutral-400 hover:text-red-500 transition-all shrink-0 mr-1"
              title="Delete report"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 transition-colors shrink-0" />
          </motion.div>
        ))}
      </div>
      {reports.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs text-violet-500 hover:text-violet-600 font-medium transition-colors"
        >
          {showAll ? 'Show less' : `Show all ${reports.length} reports`}
        </button>
      )}
    </motion.div>
  );
}

// ─── Local Path Mode (only visible when server is on same machine) ─────
const LOCAL_PATHS_KEY = 'dp_last_local_paths';

function LocalPathMode({ onAnalyze }) {
  const [paths, setPaths] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LOCAL_PATHS_KEY) || '{}'); } catch { return {}; }
  });
  const [error, setError] = useState(null);

  const set = (key, val) => setPaths(p => ({ ...p, [key]: val }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const active = Object.fromEntries(Object.entries(paths).filter(([, v]) => v?.trim()));
    if (Object.keys(active).length === 0) { setError('Enter at least one file path.'); return; }
    // Convert pdf to array
    if (active.pdf) active.pdf = [active.pdf];
    localStorage.setItem(LOCAL_PATHS_KEY, JSON.stringify(paths));
    setError(null);
    onAnalyze({ _localPaths: active });
  };

  const fields = [
    { key: 'video', label: 'Video File', icon: Video, color: 'text-amber-500', placeholder: 'C:\\Users\\...\\footage.mp4' },
    { key: 'pdf',   label: 'Document',   icon: FileText, color: 'text-blue-500',  placeholder: 'C:\\Users\\...\\document.pdf' },
    { key: 'audio', label: 'Audio File', icon: Headphones, color: 'text-emerald-500', placeholder: 'C:\\Users\\...\\recording.mp3' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
        Paste the full path to files on this machine. The server reads them directly — no upload needed.
      </p>
      {fields.map(({ key, label, icon: Icon, color, placeholder }) => (
        <div key={key} className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
          <Icon className={`w-4 h-4 ${color} shrink-0`} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-1">{label}</p>
            <input
              value={paths[key] || ''}
              onChange={e => set(key, e.target.value)}
              placeholder={placeholder}
              className="w-full text-xs bg-transparent text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none font-mono"
            />
          </div>
          {paths[key] && (
            <button type="button" onClick={() => set(key, '')} className="p-0.5 text-neutral-400 hover:text-neutral-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <motion.button
        type="submit"
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        disabled={!Object.values(paths).some(v => v?.trim())}
        className="w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-violet-700 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-lg hover:shadow-violet-500/25 transition-all"
      >
        <Zap className="w-4 h-4" /> Analyze Local Files (Instant)
      </motion.button>
    </form>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
};

export default function UploadView({ onAnalyze, onOpenReport, error }) {
  const [files, setFiles] = useState({ pdf: [], audio: [], video: [] });
  const [isLocal, setIsLocal] = useState(false);
  const [tab, setTab] = useState('upload'); // 'upload' | 'local'

  useEffect(() => {
    detectLocalServer().then(local => {
      setIsLocal(local);
    });
  }, []);

  const handleDrop = useCallback((type, file) => {
    setFiles(prev => ({ ...prev, [type]: [...prev[type], file] }));
  }, []);

  const handleRemove = useCallback((type, index) => {
    setFiles(prev => ({ ...prev, [type]: prev[type].filter((_, i) => i !== index) }));
  }, []);

  const hasFiles = Object.values(files).some(arr => arr.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6"
    >
      <motion.div variants={containerVariants} initial="hidden" animate="show" className="w-full max-w-3xl">
        {/* Hero */}
        <motion.div variants={itemVariants} className="text-center mb-10">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 15 }}
            className="inline-flex p-4 rounded-2xl bg-violet-500/10 mb-5"
          >
            <Sparkles className="w-9 h-9 text-violet-500" />
          </motion.div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3 tracking-tight">Upload Evidence Files</h2>
          <p className="text-neutral-500 dark:text-neutral-400 max-w-lg mx-auto leading-relaxed">
            Drop your case files for AI-powered analysis. Upload documents, audio, and video together for the best results.
          </p>
        </motion.div>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </motion.div>
        )}

        {/* Install desktop app — website only */}
        <InstallAppBanner />

        {/* How-to guide */}
        <HowToGuide isLocal={isLocal} />

        {/* Mode tabs — local tab only shows when server is on same machine */}
        {isLocal && (
          <motion.div variants={itemVariants} className="flex gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 mb-6">
            <button
              onClick={() => setTab('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'upload' ? 'bg-white dark:bg-neutral-800 shadow-sm text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
            >
              <Upload className="w-3.5 h-3.5" /> Upload Files
            </button>
            <button
              onClick={() => setTab('local')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'local' ? 'bg-white dark:bg-neutral-800 shadow-sm text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              Local Files
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-semibold">Instant</span>
            </button>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {tab === 'local' ? (
            <motion.div key="local" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <LocalPathMode onAnalyze={onAnalyze} />
            </motion.div>
          ) : (
            <motion.div key="upload" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {/* Drop Zones */}
              <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {['pdf', 'audio', 'video'].map((type) => (
                  <DropZone key={type} type={type} files={files[type]} onDrop={handleDrop} onRemove={handleRemove} />
                ))}
              </motion.div>

              {/* Actions */}
              <motion.div variants={itemVariants} className="flex flex-col items-center gap-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => hasFiles && onAnalyze(files)}
                  disabled={!hasFiles}
                  className={`
                    w-full max-w-md py-3.5 px-6 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2
                    transition-all duration-300 shadow-lg
                    ${hasFiles
                      ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white hover:shadow-violet-500/25 hover:shadow-xl cursor-pointer'
                      : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed'}
                  `}
                >
                  <Zap className="w-4 h-4" />
                  Analyze Evidence
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Saved Reports */}
        <motion.div variants={itemVariants}>
          <SavedReports onOpenReport={onOpenReport} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
