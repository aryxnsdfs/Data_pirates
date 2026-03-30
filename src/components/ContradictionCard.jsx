import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, FileText, Headphones, Video, Image, Eye, Clock, Hash, Shield, ShieldCheck } from 'lucide-react';
import { getSeverityConfig, formatTimestamp, normalizeSources } from '../utils/api';

const sourceIcons = { pdf: FileText, audio: Headphones, video: Video, image: Image };

const sourceColors = {
  pdf:   { icon: 'text-blue-500',   bg: 'bg-blue-500/8',   border: 'border-blue-500/15',   badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  audio: { icon: 'text-emerald-500', bg: 'bg-emerald-500/8', border: 'border-emerald-500/15', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  video: { icon: 'text-amber-500',   bg: 'bg-amber-500/8',   border: 'border-amber-500/15',   badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  image: { icon: 'text-purple-500',  bg: 'bg-purple-500/8',  border: 'border-purple-500/15',  badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
};



function SourceBlock({ src, index }) {
  const SrcIcon = sourceIcons[src.type] || FileText;
  const colors = sourceColors[src.type] || sourceColors.pdf;
  const sourceLabel = { pdf: 'Document', audio: 'Audio', video: 'Video', image: 'Image' };

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-3.5`}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <SrcIcon className={`w-3.5 h-3.5 ${colors.icon} shrink-0`} />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${colors.icon}`}>
            Source {index + 1} — {sourceLabel[src.type] || src.type}
          </span>
        </div>
        <span className="text-[10px] text-neutral-500 truncate max-w-[120px]">{src.label}</span>
        {src.page && (
          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.badge} flex items-center gap-1`}>
            <Hash className="w-2.5 h-2.5" /> Page {src.page}
          </span>
        )}
        {src.timestamp != null && (
          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.badge} flex items-center gap-1`}>
            <Clock className="w-2.5 h-2.5" /> {formatTimestamp(src.timestamp)}
          </span>
        )}
      </div>

      {src.finding && (
        <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed mb-2">
          {src.finding}
        </p>
      )}

      {src.quote && (
        <blockquote className="text-xs text-neutral-500 dark:text-neutral-400 italic border-l-2 border-current/20 pl-2.5 leading-relaxed mt-1">
          &ldquo;{src.quote}&rdquo;
        </blockquote>
      )}
    </div>
  );
}

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
      <div className="flex items-center justify-between mb-3 gap-2">
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
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 leading-relaxed">
        {contradiction.description}
      </p>

      {/* Sources */}
      <div className="space-y-2.5">
        {sources.map((src, i) => (
          <SourceBlock key={i} src={src} index={i} />
        ))}
      </div>

      {/* Adversarial notes — shows what the verification agent found */}
      {contradiction.adversarial_notes && (
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <div className="flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-0.5">Adversarial Review</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                {contradiction.adversarial_notes}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Innocent explanation if exists */}
      {contradiction.innocent_explanation && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-0.5">Possible Explanation</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 leading-relaxed">
                {contradiction.innocent_explanation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Additional notes */}
      {contradiction.additionalNotes && (
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/10">
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
