import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calculator20Regular, Delete20Regular, History20Regular } from '@fluentui/react-icons';
import { convertUnits, evaluate, formatNumber, UNIT_CATEGORIES } from '../lib/calc';
import { toast, usePersistent } from '../lib/store';
import { WidgetShell } from './chrome';

type Mode = 'standard' | 'scientific' | 'converter';

interface HistEntry {
  expr: string;
  result: string;
  raw: string;
  ts: number;
}

interface CalcButton {
  label: ReactNode;
  run: () => void;
  kind?: 'num' | 'op' | 'fn' | 'eq';
  span?: number;
  title?: string;
}

const NUM_RE = /(\d+\.?\d*|\.\d+)/;

function lastNumber(expr: string): RegExpExecArray | null {
  const re = new RegExp(NUM_RE.source, 'g');
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) last = m;
  return last;
}

export function CalculatorWidget() {
  const [mode, setMode] = useState<Mode>('standard');
  const [expr, setExpr] = useState('');
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [angle, setAngle] = usePersistent<'deg' | 'rad'>('dash.calc.angle', 'deg');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = usePersistent<HistEntry[]>('dash.calc.history', []);
  const [memory, setMemory] = usePersistent<number>('dash.calc.memory', 0);

  /* converter state */
  const [catId, setCatId] = useState('length');
  const [fromId, setFromId] = useState('m');
  const [toId, setToId] = useState('ft');
  const [convInput, setConvInput] = useState('1');

  const preview = useMemo(() => {
    if (!expr || /[+\-*/%^(.,]$/.test(expr)) return null;
    try {
      return evaluate(expr, { degrees: angle === 'deg' });
    } catch {
      return null;
    }
  }, [expr, angle]);

  const press = (key: string) => {
    let e = expr;
    if (justEvaluated) {
      if (/^[0-9.(]$/.test(key) || key.length > 1) e = '';
      setJustEvaluated(false);
    }
    setError(null);
    if (key.length > 1) {
      setExpr(e + key);
      return;
    }
    const last = e.slice(-1);
    if ('+-*/%'.includes(key) && '+-*/%'.includes(last)) {
      setExpr(e.slice(0, -1) + key);
      return;
    }
    if (key === '.') {
      const m = /([0-9]*\.?[0-9]*)$/.exec(e);
      if (m && m[0].includes('.')) return;
      setExpr(!m || m[0] === '' ? e + '0.' : e + '.');
      return;
    }
    setExpr(e + key);
  };

  const backspace = () => {
    setError(null);
    if (justEvaluated) {
      setExpr('');
      setJustEvaluated(false);
      return;
    }
    setExpr(expr.slice(0, -1));
  };

  const clearAll = () => {
    setExpr('');
    setError(null);
    setJustEvaluated(false);
  };

  const clearEntry = () => {
    setError(null);
    setJustEvaluated(false);
    setExpr(expr.replace(/(\d+\.?\d*|\.\d+)$/, ''));
  };

  const equals = () => {
    if (!expr.trim()) return;
    try {
      const v = evaluate(expr, { degrees: angle === 'deg' });
      setHistory((h) => [{ expr: expr + ' =', result: formatNumber(v), raw: String(v), ts: Date.now() }, ...h].slice(0, 50));
      setExpr(String(v));
      setJustEvaluated(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid expression');
    }
  };

  const wrapLast = (fn: (n: string) => string) => {
    const last = lastNumber(expr);
    if (!last) return;
    setJustEvaluated(false);
    setError(null);
    setExpr(expr.slice(0, last.index) + fn(last[0]) + expr.slice(last.index + last[0].length));
  };

  const toggleSign = () => {
    const last = lastNumber(expr);
    if (!last) return;
    const before = expr.slice(0, last.index);
    const after = expr.slice(last.index + last[0].length);
    if (before.endsWith('(-') && after.startsWith(')')) setExpr(before.slice(0, -2) + last[0] + after.slice(1));
    else setExpr(before + '(-' + last[0] + ')' + after);
    setJustEvaluated(false);
  };

  const currentValue = preview ?? (expr !== '' && !isNaN(Number(expr)) ? Number(expr) : null);
  const memEnabled = currentValue != null && mode !== 'converter';

  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || mode === 'converter') return;
    const k = e.key;
    if (/^[0-9]$/.test(k) || '+-*/%^!().'.includes(k)) {
      e.preventDefault();
      press(k);
    } else if (k === 'Enter' || k === '=') {
      e.preventDefault();
      equals();
    } else if (k === 'Backspace') {
      e.preventDefault();
      backspace();
    } else if (k === 'Escape') {
      e.preventDefault();
      clearAll();
    }
  };

  const std: CalcButton[] = [
    { label: '%', run: () => press('%'), kind: 'fn', title: 'Modulo' },
    { label: 'CE', run: clearEntry, kind: 'fn', title: 'Clear entry' },
    { label: 'C', run: clearAll, kind: 'fn', title: 'Clear (Esc)' },
    { label: '⌫', run: backspace, kind: 'fn', title: 'Backspace' },
    { label: '¹⁄ₓ', run: () => wrapLast((n) => `1/(${n})`), kind: 'fn', title: 'Reciprocal' },
    { label: 'x²', run: () => wrapLast((n) => `sq(${n})`), kind: 'fn', title: 'Square' },
    { label: '√x', run: () => wrapLast((n) => `sqrt(${n})`), kind: 'fn', title: 'Square root' },
    { label: '÷', run: () => press('/'), kind: 'op', title: 'Divide' },
    { label: '7', run: () => press('7'), kind: 'num' },
    { label: '8', run: () => press('8'), kind: 'num' },
    { label: '9', run: () => press('9'), kind: 'num' },
    { label: '×', run: () => press('*'), kind: 'op', title: 'Multiply' },
    { label: '4', run: () => press('4'), kind: 'num' },
    { label: '5', run: () => press('5'), kind: 'num' },
    { label: '6', run: () => press('6'), kind: 'num' },
    { label: '−', run: () => press('-'), kind: 'op', title: 'Subtract' },
    { label: '1', run: () => press('1'), kind: 'num' },
    { label: '2', run: () => press('2'), kind: 'num' },
    { label: '3', run: () => press('3'), kind: 'num' },
    { label: '+', run: () => press('+'), kind: 'op', title: 'Add' },
    { label: '±', run: toggleSign, kind: 'fn', title: 'Negate' },
    { label: '0', run: () => press('0'), kind: 'num' },
    { label: '.', run: () => press('.'), kind: 'num' },
    { label: '=', run: equals, kind: 'eq', title: 'Equals (Enter)' },
  ];

  const sci: CalcButton[] = [
    { label: 'sin', run: () => press('sin('), kind: 'fn' },
    { label: 'cos', run: () => press('cos('), kind: 'fn' },
    { label: 'tan', run: () => press('tan('), kind: 'fn' },
    { label: 'π', run: () => press('pi'), kind: 'fn' },
    { label: 'e', run: () => press('e'), kind: 'fn' },
    { label: 'ln', run: () => press('ln('), kind: 'fn' },
    { label: 'log', run: () => press('log('), kind: 'fn' },
    { label: 'xʸ', run: () => press('^'), kind: 'fn', title: 'Power' },
    { label: 'x!', run: () => press('!'), kind: 'fn', title: 'Factorial' },
    { label: '|x|', run: () => wrapLast((n) => `abs(${n})`), kind: 'fn', title: 'Absolute value' },
    { label: '%', run: () => press('%'), kind: 'fn' },
    { label: 'CE', run: clearEntry, kind: 'fn' },
    { label: 'C', run: clearAll, kind: 'fn' },
    { label: '⌫', run: backspace, kind: 'fn' },
    { label: '¹⁄ₓ', run: () => wrapLast((n) => `1/(${n})`), kind: 'fn' },
    { label: 'x²', run: () => wrapLast((n) => `sq(${n})`), kind: 'fn' },
    { label: '√x', run: () => wrapLast((n) => `sqrt(${n})`), kind: 'fn' },
    { label: 'eˣ', run: () => wrapLast((n) => `exp(${n})`), kind: 'fn' },
    { label: '10ˣ', run: () => wrapLast((n) => `(10^${n})`), kind: 'fn' },
    { label: '÷', run: () => press('/'), kind: 'op' },
    { label: '7', run: () => press('7'), kind: 'num' },
    { label: '8', run: () => press('8'), kind: 'num' },
    { label: '9', run: () => press('9'), kind: 'num' },
    { label: '(', run: () => press('('), kind: 'fn' },
    { label: '×', run: () => press('*'), kind: 'op' },
    { label: '4', run: () => press('4'), kind: 'num' },
    { label: '5', run: () => press('5'), kind: 'num' },
    { label: '6', run: () => press('6'), kind: 'num' },
    { label: ')', run: () => press(')'), kind: 'fn' },
    { label: '−', run: () => press('-'), kind: 'op' },
    { label: '1', run: () => press('1'), kind: 'num' },
    { label: '2', run: () => press('2'), kind: 'num' },
    { label: '3', run: () => press('3'), kind: 'num' },
    { label: angle === 'deg' ? 'DEG' : 'RAD', run: () => setAngle(angle === 'deg' ? 'rad' : 'deg'), kind: 'fn', title: 'Toggle angle unit' },
    { label: '+', run: () => press('+'), kind: 'op' },
    { label: '±', run: toggleSign, kind: 'fn' },
    { label: '0', run: () => press('0'), kind: 'num' },
    { label: '.', run: () => press('.'), kind: 'num' },
    { label: '=', run: equals, kind: 'eq', span: 2 },
  ];

  const renderPad = (buttons: CalcButton[], cols: number) => (
    <div className="grid h-full gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(26px, 1fr)' }}>
      {buttons.map((b, i) => (
        <button
          key={i}
          className="btn !h-full !min-h-[26px] !rounded-lg !px-0 !text-[12.5px]"
          style={{
            gridColumn: b.span ? `span ${b.span}` : undefined,
            background: b.kind === 'num' ? 'var(--surface)' : b.kind === 'eq' ? 'var(--elev)' : 'transparent',
            borderColor: b.kind === 'eq' ? 'var(--text2)' : b.kind === 'num' ? 'var(--stroke)' : 'transparent',
            fontWeight: b.kind === 'num' || b.kind === 'eq' ? 700 : 500,
          }}
          onClick={b.run}
          title={b.title}
          aria-label={b.title ?? String(b.label)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  /* ---------- converter ---------- */

  const category = UNIT_CATEGORIES.find((c) => c.id === catId) ?? UNIT_CATEGORIES[0];
  const fromUnit = category.units.find((u) => u.id === fromId) ?? category.units[0];
  const toUnit = category.units.find((u) => u.id === toId) ?? category.units[1] ?? category.units[0];
  const convValue = parseFloat(convInput);
  const convResult =
    convInput.trim() !== '' && !isNaN(convValue) ? formatNumber(convertUnits(convValue, fromUnit, toUnit, category)) : '—';

  const onCatChange = (id: string) => {
    const cat = UNIT_CATEGORIES.find((c) => c.id === id)!;
    setCatId(id);
    setFromId(cat.units[0].id);
    setToId(cat.units[1]?.id ?? cat.units[0].id);
  };

  return (
    <WidgetShell
      title="Calculator"
      icon={<Calculator20Regular />}
      actions={
        <>
          {memory !== 0 && mode !== 'converter' && (
            <button className="chip !h-6" title="Clear memory" onClick={() => setMemory(0)}>
              M {formatNumber(memory)}
            </button>
          )}
          <button className="btn-icon" title="History" aria-label="Toggle history" onClick={() => setShowHistory((v) => !v)}>
            <History20Regular />
          </button>
        </>
      }
    >
      <div className="flex h-full flex-col gap-2 p-2.5" tabIndex={0} onKeyDown={onKey} aria-label="Calculator">
        <div className="flex items-center justify-between gap-2">
          <div className="seg">
            {(
              [
                ['standard', 'Std'],
                ['scientific', 'Sci'],
                ['converter', 'Conv'],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button key={m} className={`seg-item !h-6 !px-2.5 !text-[11px] ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); setError(null); }}>
                {label}
              </button>
            ))}
          </div>
          {mode !== 'converter' && (
            <div className="flex gap-0.5">
              {(
                [
                  ['MS', () => currentValue != null && setMemory(currentValue), !memEnabled, 'Memory store'],
                  ['M+', () => currentValue != null && setMemory((m) => m + currentValue), !memEnabled, 'Memory add'],
                  ['M−', () => currentValue != null && setMemory((m) => m - currentValue), !memEnabled, 'Memory subtract'],
                  ['MR', () => { setJustEvaluated(false); setExpr((e) => (e && !/[+\-*/%^(]$/.test(e) ? e + '+' : e) + String(memory)); }, memory === 0, 'Memory recall'],
                ] as [string, () => void, boolean, string][]
              ).map(([label, run, disabled, title]) => (
                <button key={label} className="btn !h-6 !rounded-md !px-1.5 !text-[10px]" onClick={run} disabled={disabled} title={title}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode !== 'converter' ? (
          <>
            <div className="shrink-0 rounded-xl bg-[var(--base)] px-3 py-2">
              <div className="flex min-h-[16px] items-center justify-between gap-2">
                <div className="truncate text-[11px] text-[var(--text2)]">{expr || '\u00A0'}</div>
                {preview != null && !justEvaluated && (
                  <div className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--text2)]">= {formatNumber(preview)}</div>
                )}
              </div>
              <div
                className="font-display overflow-x-auto whitespace-nowrap text-right text-[26px] font-bold leading-tight tabular-nums scroll-thin"
                style={error ? { fontSize: 14, lineHeight: '30px', color: 'var(--bad)' } : undefined}
                aria-live="polite"
              >
                {error ?? (expr || '0')}
              </div>
            </div>

            <div className="min-h-0 flex-1">{mode === 'standard' ? renderPad(std, 4) : renderPad(sci, 5)}</div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-thin">
            <select className="input !h-8 !text-xs" value={catId} onChange={(e) => onCatChange(e.target.value)} aria-label="Category">
              {UNIT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <div className="rounded-xl bg-[var(--base)] p-2.5">
              <input
                className="font-display w-full bg-transparent text-right text-[22px] font-bold outline-none"
                value={convInput}
                onChange={(e) => setConvInput(e.target.value.replace(/[^\d.\-]/g, ''))}
                inputMode="decimal"
                aria-label="Value to convert"
              />
              <select className="input !mt-1 !h-7 !text-[11px]" value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="From unit">
                {category.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
            </div>
            <button
              className="btn !h-6 self-center !rounded-full !px-3 !text-[11px]"
              onClick={() => {
                setFromId(toUnit.id);
                setToId(fromUnit.id);
              }}
            >
              ⇅ Swap
            </button>
            <div className="rounded-xl border border-[var(--stroke)] bg-[var(--elev)] p-2.5">
              <div className="font-display text-right text-[22px] font-bold tabular-nums" aria-live="polite">
                {convResult}
              </div>
              <select className="input !mt-1 !h-7 !text-[11px]" value={toId} onChange={(e) => setToId(e.target.value)} aria-label="To unit">
                {category.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
            </div>
            <div className="text-center text-[11px] font-medium text-[var(--text2)]">
              1 {fromUnit.id} = {formatNumber(convertUnits(1, fromUnit, toUnit, category))} {toUnit.id}
            </div>
          </div>
        )}

        <AnimatePresence>
          {showHistory && mode !== 'converter' && (
            <motion.div
              className="acrylic-solid absolute bottom-1.5 right-1.5 top-1.5 z-20 flex w-[176px] flex-col rounded-xl"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex items-center justify-between border-b border-[var(--stroke-soft)] px-2.5 py-1.5">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text2)]">History</span>
                {history.length > 0 && (
                  <button className="btn-icon !h-5 !w-5" title="Clear history" onClick={() => setHistory([])}>
                    <Delete20Regular fontSize={13} />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-1.5">
                {history.length === 0 && <div className="px-2 py-4 text-center text-[11px] text-[var(--text2)]">Nothing yet</div>}
                {history.map((h) => (
                  <button
                    key={h.ts}
                    className="mb-1 w-full rounded-lg px-2 py-1 text-right hover:bg-[var(--card-hover)]"
                    onClick={() => {
                      setExpr(h.raw);
                      setJustEvaluated(true);
                      setShowHistory(false);
                      toast('Value restored');
                    }}
                  >
                    <span className="block truncate text-[10px] text-[var(--text2)]">{h.expr}</span>
                    <span className="block truncate text-[12.5px] font-bold tabular-nums">{h.result}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </WidgetShell>
  );
}
