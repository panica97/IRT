import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DraftDetail } from '../../types/draft';
import { parseDraftData, getTodoFieldsForSection, humanizeFieldPath } from './draft-utils';
import { updateDraftData } from '../../services/strategies';
import SectionPanel from './draft-sections/SectionPanel';
import InstrumentSection from './draft-sections/InstrumentSection';
import IndicatorsSection from './draft-sections/IndicatorsSection';
import ConditionsSection from './draft-sections/ConditionsSection';
import NotesSection from './draft-sections/NotesSection';

interface DraftViewerProps {
  draft: DraftDetail;
}

export default function DraftViewer({ draft }: DraftViewerProps) {
  const [showJson, setShowJson] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      updateDraftData(draft.strat_code, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draft', draft.strat_code] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      setEditMode(false);
      setJsonError(null);
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail;
      if (typeof detail === 'object' && detail?.errors) {
        setJsonError(detail.errors.join('\n'));
      } else if (typeof detail === 'string') {
        setJsonError(detail);
      } else {
        setJsonError('Error al guardar los cambios');
      }
    },
  });

  const handleEditJson = () => {
    setJsonText(JSON.stringify(draft.data, null, 2));
    setJsonError(null);
    setEditMode(true);
  };

  const handleSaveJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonError(null);
      mutation.mutate(parsed);
    } catch (e) {
      setJsonError(`JSON invalido: ${(e as Error).message}`);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setJsonError(null);
  };

  const parsed = parseDraftData(draft.data);
  const todoFields = draft.todo_fields ?? [];

  const scrollToFieldInJson = useCallback((field: string) => {
    // Open JSON if not visible
    if (!showJson) setShowJson(true);

    // Wait for the <pre> to render, then find and highlight the field
    setTimeout(() => {
      const pre = preRef.current;
      if (!pre) return;

      const lastKey = field.split('.').pop() ?? field;
      // Match both exact "_TODO" and embedded "_TODO" within strings
      const regex = new RegExp(`"${lastKey}"\\s*:\\s*"[^"]*_TODO[^"]*"`);
      const text = pre.textContent ?? '';
      const match = regex.exec(text);
      if (!match) return;

      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const nodeLen = node.length;
        if (charCount + nodeLen > match.index) {
          const range = document.createRange();
          range.setStart(node, match.index - charCount);
          range.setEnd(node, Math.min(match.index - charCount + match[0].length, nodeLen));
          const rect = range.getBoundingClientRect();
          const preRect = pre.getBoundingClientRect();
          pre.scrollTop = pre.scrollTop + rect.top - preRect.top - preRect.height / 3;

          const mark = document.createElement('mark');
          mark.className = 'bg-warn/30 text-warn rounded px-0.5';
          range.surroundContents(mark);
          setTimeout(() => {
            const parent = mark.parentNode;
            if (parent) {
              parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
              parent.normalize();
            }
          }, 1500);
          break;
        }
        charCount += nodeLen;
      }
    }, 50);
  }, [showJson]);

  // If parsing fails, show JSON fallback directly
  if (!parsed) {
    return (
      <div>
        <p className="text-xs text-text-muted italic mb-2">No se pudo interpretar la estructura del draft</p>
        <pre className="text-xs text-text-secondary bg-surface-0/50 rounded p-3 overflow-x-auto max-h-80 overflow-y-auto">
          {JSON.stringify(draft.data, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Visual sections */}
      <div className="space-y-2">
        <SectionPanel id="instrument" title="Instrumento" icon={'\uD83D\uDCCA'} defaultOpen>
          <InstrumentSection data={parsed} todoFields={getTodoFieldsForSection(todoFields, 'instrument')} />
        </SectionPanel>

        <SectionPanel id="indicators" title="Indicadores" icon={'\uD83D\uDCC8'} defaultOpen>
          <IndicatorsSection data={parsed} todoFields={getTodoFieldsForSection(todoFields, 'indicators')} />
        </SectionPanel>

        <SectionPanel id="conditions" title="Entradas" icon={'\u2699\uFE0F'}>
          <ConditionsSection data={parsed} todoFields={getTodoFieldsForSection(todoFields, 'conditions')} sectionType="entry" />
        </SectionPanel>

        {parsed.exit_conds.length > 0 && (
          <SectionPanel id="exit" title="Salida" icon={'\uD83D\uDEAA'}>
            <ConditionsSection data={parsed} todoFields={getTodoFieldsForSection(todoFields, 'conditions')} sectionType="exit" />
          </SectionPanel>
        )}

        {parsed._notes && Object.keys(parsed._notes).length > 0 && (
          <SectionPanel id="notes" title="Notas" icon={'\uD83D\uDCDD'}>
            <NotesSection notes={parsed._notes} />
          </SectionPanel>
        )}
      </div>

      {/* TODO fields — at the bottom, click opens JSON and highlights */}
      {todoFields.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-warn uppercase mb-1">Campos pendientes</h5>
          <ul className="space-y-0.5">
            {todoFields.map((field, i) => (
              <li
                key={i}
                onClick={() => scrollToFieldInJson(field)}
                className="text-xs text-warn font-mono bg-warn/10 border border-warn/20 rounded px-2 py-1 cursor-pointer hover:bg-warn/20 hover:border-warn/30 transition-colors"
              >
                {humanizeFieldPath(field, parsed)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* JSON view / edit toggle */}
      <div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJson(!showJson)}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors underline"
          >
            {showJson ? 'Ocultar JSON' : 'Ver JSON'}
          </button>
          {!editMode && (
            <button
              onClick={handleEditJson}
              className="text-xs text-accent hover:text-accent/80 transition-colors underline"
            >
              Editar JSON
            </button>
          )}
        </div>

        {editMode ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full font-mono text-xs bg-surface-2 text-text-primary border border-border rounded p-3 resize-y focus:outline-none focus:ring-1 focus:ring-accent"
              style={{ minHeight: '400px' }}
              spellCheck={false}
            />
            {jsonError && (
              <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded px-2 py-1 whitespace-pre-wrap">
                {jsonError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSaveJson}
                disabled={mutation.isPending}
                className="text-xs px-3 py-1 bg-accent text-surface-0 rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {mutation.isPending ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={mutation.isPending}
                className="text-xs px-3 py-1 bg-surface-2 text-text-secondary border border-border rounded hover:bg-surface-3 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          showJson && (
            <pre ref={preRef} className="mt-2 text-xs text-text-secondary bg-surface-0/50 rounded p-3 overflow-x-auto max-h-80 overflow-y-auto">
              {JSON.stringify(draft.data, null, 2)}
            </pre>
          )
        )}
      </div>
    </div>
  );
}
