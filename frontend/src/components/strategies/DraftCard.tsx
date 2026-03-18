import { useState } from 'react';
import type { DraftDetail } from '../../types/draft';
import DraftViewer from './DraftViewer';

interface DraftCardProps {
  draft: DraftDetail;
}

function StatusTag({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        active
          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : 'bg-slate-700/50 text-slate-500 border border-slate-600'
      }`}
    >
      {label}
    </span>
  );
}

export default function DraftCard({ draft }: DraftCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-white truncate">{draft.strat_name}</span>
          <span className="text-xs font-mono text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded shrink-0">
            {draft.strat_code}
          </span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
              draft.todo_count > 0
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-green-500/20 text-green-400 border border-green-500/30'
            }`}
          >
            {draft.todo_count > 0 ? `${draft.todo_count} TODOs` : 'Completo'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <StatusTag label="active" active={draft.active} />
          <StatusTag label="tested" active={draft.tested} />
          <StatusTag label="prod" active={draft.prod} />
          <span className="text-slate-500 text-xs ml-1">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-700 p-3">
          <DraftViewer draft={draft} />
        </div>
      )}
    </div>
  );
}
