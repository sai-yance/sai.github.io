import { useEffect, useState, type ReactNode } from 'react';
import { LockClosed20Regular, Search20Regular, Settings20Regular } from '@fluentui/react-icons';
import { DAYS_SHORT, MONTHS } from '../lib/store';
import type { WidgetId } from '../lib/appCache';
import { Kbd } from './chrome';

function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="13" height="13" rx="4" fill="#e7edee" />
      <rect x="17" y="2" width="13" height="13" rx="4" fill="#93a1a3" />
      <rect x="2" y="17" width="13" height="13" rx="4" fill="#93a1a3" />
      <rect x="17" y="17" width="13" height="13" rx="4" fill="#343d3f" />
    </svg>
  );
}

export function TopBar({
  onSettings,
  onPalette,
  widgets,
  activeId,
  onPick,
  compact,
  locked,
  onToggleLock,
}: {
  onSettings: () => void;
  onPalette: () => void;
  widgets: { id: WidgetId; label: string; icon: ReactNode }[];
  activeId: WidgetId | null;
  onPick: (id: WidgetId) => void;
  compact: boolean;
  locked: boolean;
  onToggleLock: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
  const p = (n: number) => String(n).padStart(2, '0');

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-2.5 px-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface)]">
        <Mark />
      </span>

      <div className="shrink-0 leading-none" aria-live="off">
        <div className="font-display text-[17px] font-extrabold tabular-nums">
          {p(now.getHours())}:{p(now.getMinutes())}
          <span className="text-[11px] font-bold text-[var(--text2)]">:{p(now.getSeconds())}</span>
        </div>
        <div className="mt-[3px] text-[10.5px] font-semibold text-[var(--text2)]">
          {DAYS_SHORT[now.getDay()]} · {MONTHS[now.getMonth()].slice(0, 3)} {now.getDate()}
        </div>
      </div>

      <nav className="ml-1 hidden min-w-0 items-center gap-1 overflow-x-auto scroll-thin sm:flex" aria-label="Widgets">
        {widgets.map((w, i) => {
          const on = activeId === w.id;
          return (
            <button
              key={w.id}
              className={`chip !h-8 !rounded-lg !px-2.5 ${on ? 'on' : ''}`}
              onClick={() => onPick(w.id)}
              title={`${w.label} — Alt+${i + 1}`}
              aria-pressed={on}
            >
              {w.icon}
              <span className="hidden lg:inline">{w.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <button
        className="btn !h-9 w-full max-w-[380px] !justify-start !bg-[var(--surface)] !text-[var(--text2)] hover:!text-[var(--text)]"
        onClick={onPalette}
        aria-label="Open universal search"
      >
        <Search20Regular />
        <span className="flex-1 truncate text-left">Search or calculate…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <button
        className={`btn-icon !h-9 !w-9 shrink-0 ${locked ? 'bg-[var(--elev)]' : ''}`}
        onClick={onToggleLock}
        title={locked ? 'Dashboard locked — click to unlock' : 'Lock dashboard in place'}
        aria-label={locked ? 'Unlock dashboard' : 'Lock dashboard'}
        aria-pressed={locked}
      >
        <LockClosed20Regular />
      </button>

      {compact && widgets.length > 0 && (
        <div className="seg sm:hidden">
          {widgets.map((w) => (
            <button
              key={w.id}
              className={`seg-item !w-8 !px-0 ${activeId === w.id ? 'on' : ''}`}
              onClick={() => onPick(w.id)}
              title={w.label}
              aria-label={w.label}
            >
              {w.icon}
            </button>
          ))}
        </div>
      )}

      <button className="btn-icon !h-9 !w-9 shrink-0" onClick={onSettings} aria-label="Settings">
        <Settings20Regular />
      </button>
    </header>
  );
}
