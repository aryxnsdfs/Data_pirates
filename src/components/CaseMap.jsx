import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, X, User, Building2, MapPin, FileText, Calendar, Package, Scale, Zap,
  ChevronRight, CheckCircle, AlertTriangle, HelpCircle, Edit3, Shield, Camera, Clock,
  ZoomIn, ZoomOut, Maximize2, Filter, GripVertical,
} from 'lucide-react';

const NODE_CONFIG = {
  person:        { icon: User,       color: '#f59e0b', bg: '#fef3c7', dark: '#78350f', label: 'Person' },
  organization:  { icon: Building2,  color: '#3b82f6', bg: '#dbeafe', dark: '#1e3a5f', label: 'Organization' },
  location:      { icon: MapPin,     color: '#10b981', bg: '#d1fae5', dark: '#064e3b', label: 'Location' },
  document:      { icon: FileText,   color: '#8b5cf6', bg: '#ede9fe', dark: '#4c1d95', label: 'Document' },
  date:          { icon: Calendar,   color: '#ec4899', bg: '#fce7f3', dark: '#831843', label: 'Date' },
  evidence:      { icon: Package,    color: '#ef4444', bg: '#fee2e2', dark: '#7f1d1d', label: 'Evidence' },
  legal_concept: { icon: Scale,      color: '#06b6d4', bg: '#cffafe', dark: '#164e63', label: 'Legal' },
  event:         { icon: Zap,        color: '#f97316', bg: '#ffedd5', dark: '#7c2d12', label: 'Event' },
};

const VERDICT_CONFIG = {
  verified:   { icon: CheckCircle,   color: '#10b981', label: 'Verified' },
  plausible:  { icon: HelpCircle,    color: '#f59e0b', label: 'Plausible' },
  corrected:  { icon: Edit3,         color: '#3b82f6', label: 'Corrected' },
  unreviewed: { icon: AlertTriangle, color: '#6b7280', label: 'Unreviewed' },
};

function formatTime(seconds) {
  if (seconds == null) return null;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Hierarchical radial layout — groups by type, high-importance in center ──
function computeLayout(nodes, edges, width, height) {
  if (!nodes.length) return {};

  const cx = width / 2, cy = height / 2;

  // Build adjacency for connected component detection
  const adj = {};
  nodes.forEach(n => { adj[n.id] = new Set(); });
  edges.forEach(e => {
    if (adj[e.source]) adj[e.source].add(e.target);
    if (adj[e.target]) adj[e.target].add(e.source);
  });

  // Count connections per node
  const connCount = {};
  nodes.forEach(n => { connCount[n.id] = adj[n.id]?.size || 0; });

  // Sort: high importance + most connections first (center)
  const sorted = [...nodes].sort((a, b) => {
    const impA = a.importance === 'high' ? 3 : a.importance === 'medium' ? 2 : 1;
    const impB = b.importance === 'high' ? 3 : b.importance === 'medium' ? 2 : 1;
    if (impB !== impA) return impB - impA;
    return (connCount[b.id] || 0) - (connCount[a.id] || 0);
  });

  // Place in concentric rings: top nodes near center, rest in outer rings
  const positions = {};
  const innerCount = Math.min(5, Math.ceil(sorted.length * 0.2));
  const midCount = Math.min(12, Math.ceil(sorted.length * 0.4));
  const padding = 80;
  const maxR = Math.min(width, height) / 2 - padding;

  const rings = [
    { nodes: sorted.slice(0, innerCount), radius: maxR * 0.15 },
    { nodes: sorted.slice(innerCount, innerCount + midCount), radius: maxR * 0.5 },
    { nodes: sorted.slice(innerCount + midCount), radius: maxR * 0.85 },
  ];

  rings.forEach(ring => {
    if (!ring.nodes.length) return;
    const count = ring.nodes.length;
    const angleStep = (2 * Math.PI) / Math.max(count, 1);
    const startAngle = -Math.PI / 2; // Start from top
    ring.nodes.forEach((node, i) => {
      const angle = startAngle + i * angleStep;
      // Add small jitter to prevent perfect overlap
      const jitter = ring.radius < maxR * 0.3 ? 15 : 5;
      positions[node.id] = {
        x: cx + ring.radius * Math.cos(angle) + (Math.random() - 0.5) * jitter,
        y: cy + ring.radius * Math.sin(angle) + (Math.random() - 0.5) * jitter,
      };
    });
  });

  // Simple force-based refinement (fewer iterations, just to untangle)
  for (let iter = 0; iter < 80; iter++) {
    const forces = {};
    nodes.forEach(n => { forces[n.id] = { x: 0, y: 0 }; });

    // Repulsion between close nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id, b = nodes[j].id;
        const dx = positions[a].x - positions[b].x;
        const dy = positions[a].y - positions[b].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 120) {
          const force = (120 - dist) * 0.3;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          forces[a].x += fx; forces[a].y += fy;
          forces[b].x -= fx; forces[b].y -= fy;
        }
      }
    }

    // Edge attraction (gentle)
    edges.forEach(e => {
      if (!positions[e.source] || !positions[e.target]) return;
      const dx = positions[e.target].x - positions[e.source].x;
      const dy = positions[e.target].y - positions[e.source].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist > 200) {
        const force = (dist - 200) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[e.source].x += fx; forces[e.source].y += fy;
        forces[e.target].x -= fx; forces[e.target].y -= fy;
      }
    });

    // Apply
    nodes.forEach(n => {
      positions[n.id].x += forces[n.id].x * 0.5;
      positions[n.id].y += forces[n.id].y * 0.5;
      positions[n.id].x = Math.max(padding, Math.min(width - padding, positions[n.id].x));
      positions[n.id].y = Math.max(padding, Math.min(height - padding, positions[n.id].y));
    });
  }

  return positions;
}

// ── Curved edge path for cleaner look ──
function edgePath(from, to, index, total) {
  if (!from || !to) return '';
  if (total <= 1) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  // Curve parallel edges
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = (index - (total - 1) / 2) * 20;
  const mx = (from.x + to.x) / 2 + (-dy / dist) * offset;
  const my = (from.y + to.y) / 2 + (dx / dist) * offset;
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;
}

// ── Main Component ─────────────────────────────────────────────────────
export default function CaseMap({ analysis, onSeekVideo, onSeekPdf }) {
  const [graphData, setGraphData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [agents, setAgents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragNode, setDragNode] = useState(null);
  const [positions, setPositions] = useState({});
  const containerRef = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  const W = 1200, H = 800;

  // Filter
  const filteredNodes = useMemo(() => {
    if (!graphData?.nodes) return [];
    return typeFilter ? graphData.nodes.filter(n => n.type === typeFilter) : graphData.nodes;
  }, [graphData, typeFilter]);
  const filteredIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => {
    if (!graphData?.edges) return [];
    return graphData.edges.filter(e => filteredIds.has(e.source) && filteredIds.has(e.target));
  }, [graphData, filteredIds]);

  // Compute layout when data changes
  useEffect(() => {
    if (filteredNodes.length) {
      setPositions(computeLayout(filteredNodes, filteredEdges, W, H));
    }
  }, [filteredNodes, filteredEdges]);

  const edgeCounts = useMemo(() => {
    const c = {};
    filteredEdges.forEach(e => { c[e.source] = (c[e.source] || 0) + 1; c[e.target] = (c[e.target] || 0) + 1; });
    return c;
  }, [filteredEdges]);

  // Parallel edge index
  const edgeIndex = useMemo(() => {
    const map = {};
    filteredEdges.forEach(e => {
      const key = [e.source, e.target].sort().join('-');
      if (!map[key]) map[key] = { total: 0, edges: [] };
      map[key].total++;
      map[key].edges.push(e);
    });
    const idx = new Map();
    Object.values(map).forEach(({ edges: arr, total }) => {
      arr.forEach((e, i) => idx.set(e, { index: i, total }));
    });
    return idx;
  }, [filteredEdges]);

  const getNodeEdges = useCallback((nodeId) => {
    return graphData?.edges?.filter(e => e.source === nodeId || e.target === nodeId) || [];
  }, [graphData]);

  // Generate
  const handleGenerate = async () => {
    setLoading(true); setError(''); setGraphData(null); setQuality(null); setAgents(null);
    setProgress('Agent 1: Mining entities from evidence...');
    const t1 = setTimeout(() => setProgress('Agent 2: Building relationship map...'), 15000);
    const t2 = setTimeout(() => setProgress('Agent 3: Fact-checking all relationships...'), 30000);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/knowledge-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      setGraphData(data.graph);
      setQuality(data.quality);
      setAgents(data.agents);
    } catch (err) { setError(err.message); }
    finally { clearTimeout(t1); clearTimeout(t2); setLoading(false); setProgress(''); }
  };

  // Pan
  const handleMouseDown = (e) => {
    if (e.target.closest('.gnode') || dragNode) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const handleMouseMove = (e) => {
    if (dragNode) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const svgX = (e.clientX - rect.left - pan.x) / zoom;
      const svgY = (e.clientY - rect.top - pan.y) / zoom;
      setPositions(p => ({ ...p, [dragNode]: { x: Math.max(40, Math.min(W - 40, svgX)), y: Math.max(40, Math.min(H - 40, svgY)) } }));
      return;
    }
    if (!isPanning.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  };
  const handleMouseUp = () => { isPanning.current = false; setDragNode(null); };

  // Scroll zoom
  const handleWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  };

  // ── Generate button ──
  if (!graphData && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-10 h-10 text-violet-500" />
          </div>
          <h3 className="text-xl font-bold mb-2">Case Knowledge Graph</h3>
          <p className="text-sm text-neutral-500 max-w-md mx-autoleading-relaxed">
            Build an interactive, fact-checked knowledge graph using a 3-agent AI pipeline that analyzes your video and document evidence.
          </p>
          <div className="flex items-center justify-center gap-4 mt-6 text-xs text-neutral-400">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <span className="w-5 h-5 rounded-full bg-amber-500/10  flex items-center justify-center text-[10px] font-bold text-amber-500">1</span> Entity Miner
            </span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
              <span className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center text-[10px] font-bold text-blue-500">2</span> Graph Builder
            </span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <span className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-[10px] font-bold text-emerald-500">3</span> Fact Checker
            </span>
          </div>
        </div>
        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleGenerate}
          className="px-6 py-3 bg-gradient-to-r from-violet-500 to-blue-500 text-white font-semibold rounded-xl hover:shadow-xl hover:shadow-violet-500/20 transition-all">
          Generate Knowledge Graph
        </motion.button>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin" />
          <Shield className="w-6 h-6 text-violet-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-2">Building Knowledge Graph...</p>
        <p className="text-xs text-violet-500 font-medium animate-pulse">{progress}</p>
        <p className="text-[10px] text-neutral-400 mt-3">This takes 30-60 seconds (3 AI agents working)</p>
      </div>
    );
  }

  const nodeTypes = [...new Set(graphData.nodes.map(n => n.type))];

  return (
    <div className="space-y-4">
      {/* Quality stats */}
      {quality && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-gradient-to-r from-violet-500/5 via-blue-500/5 to-emerald-500/5 border border-violet-500/15">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">3-Agent Pipeline Complete</p>
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed">{quality.summary}</p>
            </div>
            <div className="flex items-center gap-5">
              {[
                { v: Math.round((quality.score || 0) * 100) + '%', l: 'Quality', c: 'text-violet-500' },
                { v: agents?.entities_found, l: 'Entities', c: 'text-amber-500' },
                { v: graphData.edges.length, l: 'Links', c: 'text-blue-500' },
                { v: agents?.verdicts?.verified, l: 'Verified', c: 'text-emerald-500' },
              ].filter(s => s.v != null).map((s, i) => (
                <div key={i} className="text-center">
                  <p className={`text-xl font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-[10px] text-neutral-400">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-neutral-400 mr-1" />
          <button onClick={() => setTypeFilter(null)}
            className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${!typeFilter ? 'bg-violet-500 text-white shadow-sm' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}>
            All ({graphData.nodes.length})
          </button>
          {nodeTypes.map(type => {
            const cfg = NODE_CONFIG[type] || NODE_CONFIG.event;
            const count = graphData.nodes.filter(n => n.type === type).length;
            return (
              <button key={type} onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${typeFilter === type ? 'text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400'}`}
                style={typeFilter === type ? { background: cfg.color } : { background: `${cfg.color}10` }}>
                <cfg.icon className="w-3 h-3" /> {cfg.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))} className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ZoomOut className="w-3.5 h-3.5 text-neutral-500" />
          </button>
          <span className="text-[10px] text-neutral-400 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.15))} className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ZoomIn className="w-3.5 h-3.5 text-neutral-500" />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Reset">
            <Maximize2 className="w-3.5 h-3.5 text-neutral-500" />
          </button>
          <span className="text-[10px] text-neutral-400 mx-1">|</span>
          <span className="text-[10px] text-neutral-400 flex items-center gap-1"><GripVertical className="w-3 h-3" /> Drag nodes to rearrange</span>
          <button onClick={handleGenerate} className="ml-2 text-[10px] px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 font-medium">
            Regenerate
          </button>
        </div>
      </div>

      {/* ── Graph Canvas ── */}
      <div ref={containerRef}
        className="relative rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden select-none"
        style={{ height: H, background: 'radial-gradient(circle at 50% 50%, rgba(139,92,246,0.03) 0%, transparent 70%)', cursor: dragNode ? 'grabbing' : isPanning.current ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Subtle grid */}
        <svg className="absolute inset-0 opacity-[0.04] pointer-events-none" width="100%" height="100%">
          <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#a3a3a3" opacity="0.5" /></marker>
            {/* Glow filter */}
            <filter id="glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {filteredEdges.map((edge, i) => {
              const from = positions[edge.source];
              const to = positions[edge.target];
              if (!from || !to) return null;
              const ei = edgeIndex.get(edge) || { index: 0, total: 1 };
              const d = edgePath(from, to, ei.index, ei.total);
              const vCfg = VERDICT_CONFIG[edge.verdict] || VERDICT_CONFIG.unreviewed;
              const isConn = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);
              const isHov = hoveredEdge === i;
              const isSel = selectedEdge === edge;
              const dimmed = selectedNode && !isConn;

              return (
                <g key={`e-${i}`} className="cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setSelectedEdge(isSel ? null : edge); setSelectedNode(null); }}
                  onMouseEnter={() => setHoveredEdge(i)} onMouseLeave={() => setHoveredEdge(null)}>
                  {/* Invisible fat path for easier clicking */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
                  <path d={d} fill="none"
                    stroke={isSel ? vCfg.color : isConn ? '#a78bfa' : isHov ? '#8b5cf6' : '#d4d4d8'}
                    strokeWidth={isSel ? 2.5 : isConn ? 2 : isHov ? 1.8 : 1}
                    strokeDasharray={edge.verdict === 'corrected' ? '6,4' : 'none'}
                    opacity={dimmed ? 0.08 : isSel ? 1 : 0.4}
                    markerEnd="url(#arrowhead)"
                  />
                  {/* Edge label on hover/select */}
                  {(isHov || isSel || isConn) && (() => {
                    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
                    return (
                      <g transform={`translate(${mx}, ${my})`}>
                        <rect x={-edge.relation.length * 2.8 - 6} y="-10" width={edge.relation.length * 5.6 + 12} height="18" rx="4"
                          fill="white" stroke="#e5e5e5" strokeWidth="0.5" opacity="0.95" className="dark:fill-neutral-800 dark:stroke-neutral-700" />
                        <text textAnchor="middle" y="3" style={{ fontSize: '8px', fill: isSel ? vCfg.color : '#737373', fontWeight: 600 }}>
                          {edge.relation}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* Nodes */}
            {filteredNodes.map((node) => {
              const pos = positions[node.id];
              if (!pos) return null;
              const cfg = NODE_CONFIG[node.type] || NODE_CONFIG.event;
              const Icon = cfg.icon;
              const isSel = selectedNode?.id === node.id;
              const isHov = hoveredNode === node.id;
              const isConn = selectedNode && getNodeEdges(selectedNode.id).some(e => e.source === node.id || e.target === node.id);
              const dimmed = selectedNode && !isSel && !isConn;
              const ec = edgeCounts[node.id] || 0;
              const r = Math.min(30, 20 + ec * 1.5);

              return (
                <g key={`n-${node.id}`} className="gnode cursor-pointer" transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(isSel ? null : node); setSelectedEdge(null); }}
                  onMouseEnter={() => setHoveredNode(node.id)} onMouseLeave={() => setHoveredNode(null)}
                  onMouseDown={(e) => { e.stopPropagation(); setDragNode(node.id); }}
                  style={{ opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.2s' }}>
                  {/* Outer glow on select */}
                  {(isSel || isHov) && <circle r={r + 10} fill={cfg.color} opacity="0.1" filter="url(#glow)" />}
                  {/* Shadow */}
                  <circle r={r} fill="black" opacity="0.06" transform="translate(1.5, 2)" />
                  {/* Main circle */}
                  <circle r={r} fill={cfg.bg} stroke={cfg.color} strokeWidth={isSel ? 3 : isHov ? 2.5 : 1.5}
                    className="dark:fill-neutral-800 transition-all duration-150" />
                  {/* Icon */}
                  <foreignObject x={-10} y={-10} width="20" height="20" className="pointer-events-none">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20 }}>
                      <Icon style={{ width: 16, height: 16, color: cfg.color }} />
                    </div>
                  </foreignObject>
                  {/* Label background */}
                  {(() => {
                    const lbl = node.label.length > 16 ? node.label.substring(0, 14) + '…' : node.label;
                    const lblW = lbl.length * 5.5 + 12;
                    return (
                      <g transform={`translate(0, ${r + 10})`}>
                        <rect x={-lblW / 2} y="-7" width={lblW} height="14" rx="4"
                          fill="white" stroke={isSel ? cfg.color : '#e5e7eb'} strokeWidth={isSel ? 1 : 0.5} opacity="0.92"
                          className="dark:fill-neutral-900 dark:stroke-neutral-700" />
                        <text textAnchor="middle" y="3"
                          style={{ fontSize: '9px', fill: isSel ? cfg.color : '#525252', fontWeight: isSel ? 700 : 500 }}>
                          {lbl}
                        </text>
                      </g>
                    );
                  })()}
                  {/* High importance dot */}
                  {node.importance === 'high' && (
                    <circle cx={r * 0.7} cy={-r * 0.7} r="5" fill="#ef4444" stroke="white" strokeWidth="1.5" />
                  )}
                  {/* Connection count badge */}
                  {ec > 2 && (
                    <g transform={`translate(${-r * 0.7}, ${-r * 0.7})`}>
                      <circle r="7" fill={cfg.color} opacity="0.9" />
                      <text textAnchor="middle" y="3" style={{ fontSize: '7px', fill: 'white', fontWeight: 700 }}>{ec}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Detail panels */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div key="nd" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-lg">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: (NODE_CONFIG[selectedNode.type] || NODE_CONFIG.event).bg }}>
                  {(() => { const C = (NODE_CONFIG[selectedNode.type] || NODE_CONFIG.event).icon; return <C style={{ width: 20, height: 20, color: (NODE_CONFIG[selectedNode.type] || NODE_CONFIG.event).color }} />; })()}
                </div>
                <div>
                  <p className="font-semibold text-sm">{selectedNode.label}</p>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: (NODE_CONFIG[selectedNode.type] || NODE_CONFIG.event).color }}>
                    {(NODE_CONFIG[selectedNode.type] || NODE_CONFIG.event).label}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedNode(null)} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"><X className="w-4 h-4 text-neutral-400" /></button>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed mb-3">{selectedNode.description}</p>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {selectedNode.video_timestamp != null && (
                <button onClick={() => onSeekVideo?.(selectedNode.video_timestamp)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 flex items-center gap-1 font-medium">
                  <Camera className="w-3 h-3" /> Video @ {formatTime(selectedNode.video_timestamp)}
                </button>
              )}
              {selectedNode.page && (
                <button onClick={() => onSeekPdf?.(selectedNode.page)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 flex items-center gap-1 font-medium">
                  <FileText className="w-3 h-3" /> Page {selectedNode.page}
                </button>
              )}
              <span className="text-[10px] text-neutral-400">{edgeCounts[selectedNode.id] || 0} connections</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Relationships</p>
              {getNodeEdges(selectedNode.id).map((edge, i) => {
                const isSource = edge.source === selectedNode.id;
                const other = graphData.nodes.find(n => n.id === (isSource ? edge.target : edge.source));
                const vCfg = VERDICT_CONFIG[edge.verdict] || VERDICT_CONFIG.unreviewed;
                const oCfg = NODE_CONFIG[other?.type] || NODE_CONFIG.event;
                return (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                    onClick={() => { setSelectedEdge(edge); setSelectedNode(null); }}>
                    <vCfg.icon className="w-3.5 h-3.5 shrink-0" style={{ color: vCfg.color }} />
                    <span className="font-medium text-neutral-500">{isSource ? '→' : '←'} {edge.relation} {isSource ? '→' : '←'}</span>
                    <span className="font-semibold" style={{ color: oCfg.color }}>{other?.label || '?'}</span>
                    {edge.citation && <span className="ml-auto text-[9px] text-neutral-400 font-mono bg-neutral-100 dark:bg-neutral-700 px-1.5 py-0.5 rounded">{edge.citation}</span>}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {selectedEdge && !selectedNode && (
          <motion.div key="ed" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-lg">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                  <span style={{ color: (NODE_CONFIG[graphData.nodes.find(n => n.id === selectedEdge.source)?.type]?.color || '#666') }}>
                    {graphData.nodes.find(n => n.id === selectedEdge.source)?.label}
                  </span>
                  <span className="text-neutral-300 dark:text-neutral-600">→</span>
                  <span className="text-neutral-500 italic">{selectedEdge.relation}</span>
                  <span className="text-neutral-300 dark:text-neutral-600">→</span>
                  <span style={{ color: (NODE_CONFIG[graphData.nodes.find(n => n.id === selectedEdge.target)?.type]?.color || '#666') }}>
                    {graphData.nodes.find(n => n.id === selectedEdge.target)?.label}
                  </span>
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {(() => { const vCfg = VERDICT_CONFIG[selectedEdge.verdict] || VERDICT_CONFIG.unreviewed; return (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: `${vCfg.color}15`, color: vCfg.color }}>
                      <vCfg.icon className="w-3 h-3" /> {vCfg.label}
                    </span>
                  ); })()}
                  {selectedEdge.citation && <span className="text-[10px] font-mono text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded">{selectedEdge.citation}</span>}
                </div>
              </div>
              <button onClick={() => setSelectedEdge(null)} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"><X className="w-4 h-4 text-neutral-400" /></button>
            </div>
            {selectedEdge.description && <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">{selectedEdge.description}</p>}
            {selectedEdge.review_reason && (
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10 mb-3">
                <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1"><Shield className="w-3 h-3" /> Agent 3 Fact-Check</p>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">{selectedEdge.review_reason}</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              {selectedEdge.timestamp != null && (
                <button onClick={() => onSeekVideo?.(selectedEdge.timestamp)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 flex items-center gap-1 font-medium">
                  <Camera className="w-3 h-3" /> Jump to video
                </button>
              )}
              {selectedEdge.page && (
                <button onClick={() => onSeekPdf?.(selectedEdge.page)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 flex items-center gap-1 font-medium">
                  <FileText className="w-3 h-3" /> Page {selectedEdge.page}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-neutral-400 px-1 pt-1">
        <span className="font-semibold text-neutral-500">Edges:</span>
        {Object.entries(VERDICT_CONFIG).map(([k, cfg]) => (
          <span key={k} className="flex items-center gap-1"><cfg.icon className="w-3 h-3" style={{ color: cfg.color }} /> {cfg.label}</span>
        ))}
        <span>|</span>
        <span className="font-semibold text-neutral-500">Nodes:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> High importance</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-violet-500/20 text-[7px] text-violet-500 font-bold flex items-center justify-center">N</span> Connection count</span>
      </div>
    </div>
  );
}
