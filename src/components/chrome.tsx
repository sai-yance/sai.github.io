import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowMinimize20Regular,
  ArrowMaximize20Regular,
  CheckmarkCircle20Filled,
  Dismiss20Regular,
  ErrorCircle20Filled,
  Info20Filled,
} from '@fluentui/react-icons';
import { onToast, type ToastMsg } from '../lib/store';

/* ---------- Widget frame (maximize wiring, provided by App) ---------- */

export interface WidgetFrame {
  maximized: boolean;
  onToggle: (() => void) | null;
}

export const WidgetFrameContext = createContext<WidgetFrame>({ maximized: false, onToggle: null });

/* ---------- Widget shell (drag via header) ---------- */

export function WidgetShell({
  title,
  icon,
  actions,
  children,
}: {
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const frame = useContext(WidgetFrameContext);
  return (
    <div className="widget-shell acrylic">
      <header className={`widget-header ${frame.maximized ? '' : 'drag-handle'}`}>
        <span className="wicon">{icon}</span>
        <span className="wtitle font-display">{title}</span>
        <div className="ml-auto flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {actions}
          {frame.onToggle && (
            <button
              className="btn-icon"
              onClick={frame.onToggle}
              title={frame.maximized ? 'Restore (Esc)' : 'Maximize'}
              aria-label={frame.maximized ? 'Restore widget' : 'Maximize widget'}
            >
              {frame.maximized ? <ArrowMinimize20Regular /> : <ArrowMaximize20Regular />}
            </button>
          )}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/* ---------- Modal (portal so widget transforms don't trap it) ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          style={{ background: 'var(--overlay)', backdropFilter: 'blur(6px)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className={`acrylic-solid w-full ${width} rounded-2xl`}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-1">
              <h2 className="font-display text-[15px] font-bold">{title}</h2>
              <button className="btn-icon" onClick={onClose} aria-label="Close dialog">
                <Dismiss20Regular />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto scroll-thin px-5 py-3">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-[var(--stroke-soft)] px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- Context menu ---------- */

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  danger?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const estH = items.reduce((h, it) => h + (it.divider ? 9 : 34), 10);
  const left = Math.min(x, window.innerWidth - 224);
  const top = Math.min(y, window.innerHeight - estH - 8);

  return createPortal(
    <div
      className="acrylic-solid fixed z-[90] w-[216px] rounded-xl p-1.5 fade-in"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="mx-2 my-1 h-px bg-[var(--stroke-soft)]" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] font-medium transition-colors hover:bg-[var(--card-hover)]"
            style={it.danger ? { color: 'var(--bad)' } : undefined}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            <span className="grid w-5 place-items-center opacity-80">{it.icon}</span>
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/* ---------- Toggle ---------- */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex items-center gap-2.5 disabled:opacity-40"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className="relative inline-block h-[18px] w-[38px] rounded-full border transition-colors duration-200"
        style={{
          background: checked ? 'var(--ac)' : 'var(--card-hover)',
          borderColor: checked ? 'var(--ac)' : 'var(--stroke)',
        }}
      >
        <span
          className="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all duration-200"
          style={{
            left: checked ? 22 : 3,
            background: checked ? '#fff' : 'var(--text2)',
          }}
        />
      </span>
      {label && <span className="text-[13px] font-medium">{label}</span>}
    </button>
  );
}

/* ---------- Small bits ---------- */

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-label="Loading">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--stroke)" strokeWidth="2.6" />
      <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" fill="none" stroke="var(--ac)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center fade-in">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--ac-soft)] text-[var(--ac-text)] [&>svg]:h-6 [&>svg]:w-6">
        {icon}
      </div>
      <div className="mt-1 text-[13.5px] font-bold">{title}</div>
      {hint && <div className="max-w-[300px] text-xs leading-relaxed text-[var(--text2)]">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ---------- Toasts ---------- */

export function Toasts() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  useEffect(() => {
    return onToast((t) => {
      setToasts((cur) => [...cur.slice(-3), t]);
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 3800);
    });
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[320px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="acrylic-solid pointer-events-auto flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] font-medium"
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ duration: 0.18 }}
          >
            <span style={{ color: t.kind === 'success' ? 'var(--good)' : t.kind === 'error' ? 'var(--bad)' : 'var(--ac-text)' }}>
              {t.kind === 'success' ? <CheckmarkCircle20Filled /> : t.kind === 'error' ? <ErrorCircle20Filled /> : <Info20Filled />}
            </span>
            <span className="flex-1">{t.text}</span>
            <button
              className="btn-icon !h-6 !w-6"
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
              aria-label="Dismiss notification"
            >
              <Dismiss20Regular fontSize={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
