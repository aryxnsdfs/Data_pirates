import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Headphones, Video, Upload, Sparkles, X, AlertCircle, Zap, Clock, ChevronRight, Folder } from 'lucide-react';
import { getSavedReports } from '../utils/storage';

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
      </div>
      <div className="space-y-2">
        {visible.map((report) => (
          <motion.button
            key={report.id}
            whileHover={{ x: 4 }}
            onClick={() => onOpenReport(report.analysis)}
            className="w-full text-left p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors flex items-center gap-3 group"
          >
            <div className="p-2 rounded-lg bg-violet-500/10 shrink-0">
              <FileText className="w-4 h-4 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{report.caseName || 'Untitled'}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-neutral-400">
                  {report.contradictionCount || 0} findings
                </span>
                <span className="text-[10px] text-neutral-300 dark:text-neutral-600">&middot;</span>
                <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {report.savedAt ? new Date(report.savedAt).toLocaleDateString() : 'Recently'}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 transition-colors shrink-0" />
          </motion.button>
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

        {/* Saved Reports */}
        <motion.div variants={itemVariants}>
          <SavedReports onOpenReport={onOpenReport} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
