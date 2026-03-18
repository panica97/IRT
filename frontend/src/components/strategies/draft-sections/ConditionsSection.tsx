import type { Condition, DraftData } from '../../../types/draft-data';

interface Props {
  data: DraftData;
  todoFields: string[];
}

const OPERATORS = [' crosses_above ', ' crosses_below ', ' <= ', ' >= ', ' == ', ' < ', ' > '] as const;

function formatConditionWithShifts(cond: string, shift_1: number, shift_2?: number): string {
  // Find the operator in the condition string
  let op: string | null = null;
  let opIndex = -1;
  for (const candidate of OPERATORS) {
    const idx = cond.indexOf(candidate);
    if (idx !== -1) {
      op = candidate;
      opIndex = idx;
      break;
    }
  }

  if (op === null || opIndex === -1) return cond;

  const left = cond.substring(0, opIndex);
  const right = cond.substring(opIndex + op.length);

  // Check if right side looks like a numeric value (not an indicator)
  const rightIsNumeric = /^-?\d+(\.\d+)?$/.test(right.trim());

  // Always show shift on first operand
  const leftSuffix = `[${shift_1}]`;

  if (rightIsNumeric) {
    return `${left}${leftSuffix}${op}${right}`;
  }

  // Two-operand: always show shift on second operand too
  const rightSuffix = shift_2 != null ? `[${shift_2}]` : '[0]';

  return `${left}${leftSuffix}${op}${right}${rightSuffix}`;
}

function ConditionBlock({ cond }: { cond: Condition }) {
  const displayCond = cond.shift_1 != null
    ? formatConditionWithShifts(cond.cond, cond.shift_1, cond.shift_2)
    : cond.cond;

  return (
    <div className="flex items-start gap-2 p-2 bg-slate-800/40 rounded border border-slate-700/50">
      <span className="text-[10px] font-mono text-slate-500 mt-0.5 shrink-0">{cond.condCode}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 font-mono">{displayCond}</div>
        <div className="flex gap-2 mt-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 border border-slate-600/50">
            {cond.cond_type}
          </span>
          {cond.group != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
              grupo: {cond.group}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ConditionGroup({ conditions, label, bgClass }: { conditions: Condition[]; label: string; bgClass: string }) {
  if (conditions.length === 0) {
    return (
      <div className={`rounded-lg p-3 ${bgClass}`}>
        <div className="text-xs font-semibold uppercase mb-2 text-slate-400">{label}</div>
        <p className="text-xs text-slate-500 italic">Sin condiciones</p>
      </div>
    );
  }

  // Group conditions by their group field
  const groups = new Map<number | undefined, Condition[]>();
  conditions.forEach(c => {
    const g = c.group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  });

  return (
    <div className={`rounded-lg p-3 ${bgClass}`}>
      <div className="text-xs font-semibold uppercase mb-2 text-slate-400">{label}</div>
      <div className="space-y-1">
        {Array.from(groups.entries()).map(([, conds], gi) => (
          <div key={gi}>
            {gi > 0 && (
              <div className="text-[10px] text-center text-slate-500 font-bold my-1">OR</div>
            )}
            <div className="space-y-1">
              {conds.map((c, ci) => (
                <div key={ci}>
                  {ci > 0 && (
                    <div className="text-[10px] text-center text-slate-500 my-0.5">AND</div>
                  )}
                  <ConditionBlock cond={c} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConditionsSection({ data }: Props) {
  return (
    <div className="space-y-3">
      {/* Entry conditions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ConditionGroup
          conditions={data.long_conds}
          label="Long"
          bgClass="bg-green-500/5 border border-green-500/10"
        />
        <ConditionGroup
          conditions={data.short_conds}
          label="Short"
          bgClass="bg-red-500/5 border border-red-500/10"
        />
      </div>

      {/* Exit conditions */}
      <div className="rounded-lg p-3 bg-slate-700/20 border border-slate-700/30">
        <div className="text-xs font-semibold uppercase mb-2 text-slate-400">Salida</div>
        {data.exit_conds.length === 0 ? (
          <p className="text-xs text-slate-500 italic">Sin condiciones de salida</p>
        ) : (
          <div className="space-y-1">
            {data.exit_conds.map((c, i) => (
              <ConditionBlock key={i} cond={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
