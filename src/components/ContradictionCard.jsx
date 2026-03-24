import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, FileText, Headphones, Video, Image, Eye } from 'lucide-react';
import { getSeverityConfig, formatTimestamp, normalizeSources } from '../utils/api';

const sourceIcons = { pdf: FileText, audio: Headphones, video: Video, image: Image };

export default function ContradictionCard({ contradiction, index, onClick }) {
  const sev = getSeverityConfig(contradiction.severity);
  const sources = normalizeSources(contradiction);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      onClick={() => onClick(contradiction)}
      className={`
        group cursor-pointer rounded-2xl border p-5 sm:p-6
        bg-white dark:bg-neutral-900/60
        hover:shadow-lg dark:hover:shadow-2xl hover:shadow-neutral-200/50 dark:hover:shadow-black/30
        transition-shadow duration-300
        ${sev.className}
      `}
    >
      {/* Severity badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
          <span className={`text-xs font-bold tracking-wider uppercase ${sev.color}`}>{sev.label}</span>
        </div>
        <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 group-hover:translate-x-0.5 transition-all" />
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold mb-2 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
        {contradiction.title}
      </h3>

      {/* Description */}
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 leading-relaxed line-clamp-2">
        {contradiction.description}
      </p>

      {/* All sources */}
      <div className="space-y-2">
        {sources.map((src, i) => {
          const SrcIcon = sourceIcons[src.type] || FileText;
          return (
            <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/50">
              <SrcIcon className={`w-4 h-4 mt-0.5 shrink-0 ${
                src.type === 'pdf' ? 'text-blue-500' : src.type === 'audio' ? 'text-emerald-500' : src.type === 'video' ? 'text-amber-500' : 'text-blue-500'
              }`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-medium">{src.label}</span>
                  {src.page && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                      Page {src.page}
                    </span>
                  )}
                  {src.timestamp != null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                      {formatTimestamp(src.timestamp)}
                    </span>
                  )}
                </div>
                {/* Show finding summary if available */}
                {src.finding && (
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed mb-1">
                    {src.finding}
                  </p>
                )}
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed line-clamp-2 italic">
                  "{src.quote}"
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Additional notes */}
      {contradiction.additionalNotes && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
          <div className="flex items-start gap-2">
            <Eye className="w-3.5 h-3.5 text-violet-500 shrink-0 mt-0.5" />
            <p className="text-xs text-violet-600 dark:text-violet-400 leading-relaxed">
              {contradiction.additionalNotes}
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
