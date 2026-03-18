import { useState, useRef, useEffect } from 'react';

interface SectionPanelProps {
  id: string;
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}

export default function SectionPanel({ id, title, icon, children, defaultOpen = false, forceOpen }: SectionPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen && !open) {
      setOpen(true);
      // Scroll into view after opening
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [forceOpen, open]);

  return (
    <div ref={ref} id={`section-${id}`} className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
      >
        <span className="text-sm">{icon}</span>
        <span className="text-sm font-medium text-slate-200 flex-1">{title}</span>
        <span className="text-xs text-slate-500">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="p-3 bg-slate-800/20">
          {children}
        </div>
      )}
    </div>
  );
}
