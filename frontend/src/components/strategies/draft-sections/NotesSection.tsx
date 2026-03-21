interface Props {
  notes: Record<string, string> | string;
}

export default function NotesSection({ notes }: Props) {
  // Handle string notes (legacy format)
  if (typeof notes === 'string') {
    if (!notes) return <p className="text-sm text-slate-500 italic">Sin notas</p>;
    return (
      <div className="bg-slate-800/40 rounded p-2.5 border border-slate-700/50">
        <div className="text-sm text-slate-300 leading-relaxed">{notes}</div>
      </div>
    );
  }

  const entries = Object.entries(notes);

  if (entries.length === 0) {
    return <p className="text-sm text-slate-500 italic">Sin notas</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="bg-slate-800/40 rounded p-2.5 border border-slate-700/50">
          <div className="text-xs font-mono text-slate-400 mb-1">{key}</div>
          <div className="text-sm text-slate-300 leading-relaxed">{value}</div>
        </div>
      ))}
    </div>
  );
}
