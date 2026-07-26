import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Fuse from 'fuse.js';
import {
  Bookmark20Regular,
  Calculator20Regular,
  CalendarLtr20Regular,
  Document20Regular,
  Note20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import type { Bookmark, Note } from '../lib/types';
import { appCache, type WidgetId } from '../lib/appCache';
import { formatNumber, tryMathQuery } from '../lib/calc';
import { hostOf, toast } from '../lib/store';

interface Result {
  key: string;
  group: string;
  title: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  bookmarks,
  notes,
  onOpenNote,
  onFocusWidget,
}: {
  open: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  notes: Note[];
  onOpenNote: (id: string) => void;
  onFocusWidget: (w: WidgetId, payload?: Record<string, string>) => void;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const mathResult = useMemo(() => (query.trim() ? tryMathQuery(query) : null), [query]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim();
    const out: Result[] = [];
    if (!q) return out;

    if (mathResult != null) {
      const text = formatNumber(mathResult);
      out.push({
        key: 'math',
        group: 'Calculator',
        title: `= ${text}`,
        sub: 'Press Enter to copy the result',
        icon: <Calculator20Regular />,
        run: () => {
          navigator.clipboard?.writeText(text.replace(/,/g, '')).then(
            () => toast('Result copied to clipboard', 'success'),
            () => toast('Could not copy result', 'error'),
          );
          onClose();
        },
      });
    }

    if (q.length >= 1) {
      const fuseB = new Fuse(bookmarks, {
        keys: [{ name: 'title', weight: 2 }, { name: 'url', weight: 1 }],
        threshold: 0.35,
        ignoreLocation: true,
      });
      fuseB.search(q, { limit: 5 }).forEach((r, i) => {
        const b = r.item;
        out.push({
          key: `b-${b.id}`,
          group: 'Bookmarks',
          title: b.title || hostOf(b.url),
          sub: hostOf(b.url),
          icon: <Bookmark20Regular />,
          run: () => {
            window.open(b.url, '_blank', 'noopener');
            onClose();
          },
        });
        if (i === 0 && b.pinned) out[out.length - 1].sub = 'Pinned · ' + hostOf(b.url);
      });

      const fuseN = new Fuse(notes, {
        keys: [{ name: 'title', weight: 2 }, { name: 'tags', weight: 1.4 }, { name: 'body', weight: 1 }],
        threshold: 0.35,
        ignoreLocation: true,
      });
      fuseN.search(q, { limit: 4 }).forEach((r) => {
        const n = r.item;
        out.push({
          key: `n-${n.id}`,
          group: 'Notes',
          title: n.title || 'Untitled note',
          sub: n.body.replace(/[#>*`\-!\[\]]/g, '').slice(0, 70) || 'Empty note',
          icon: <Note20Regular />,
          run: () => {
            onOpenNote(n.id);
            onClose();
          },
        });
      });

      const fuseE = new Fuse(appCache.events, { keys: ['summary', 'location', 'description'], threshold: 0.35, ignoreLocation: true });
      fuseE.search(q, { limit: 4 }).forEach((r) => {
        const ev = r.item;
        const start = ev.start.dateTime ?? ev.start.date ?? '';
        out.push({
          key: `e-${ev.id}`,
          group: 'Calendar',
          title: ev.summary,
          sub: start ? new Date(start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : undefined,
          icon: <CalendarLtr20Regular />,
          run: () => {
            onFocusWidget('calendar', { eventId: ev.id, date: start });
            onClose();
          },
        });
      });

      const fuseD = new Fuse(appCache.driveFiles, { keys: ['name'], threshold: 0.35, ignoreLocation: true });
      fuseD.search(q, { limit: 4 }).forEach((r) => {
        const f = r.item;
        out.push({
          key: `d-${f.id}`,
          group: 'Google Drive',
          title: f.name,
          sub: f.mimeType.includes('folder') ? 'Folder' : f.mimeType.split('.').pop(),
          icon: <Document20Regular />,
          run: () => {
            onFocusWidget('drive', { fileId: f.id, name: f.name, mime: f.mimeType });
            onClose();
          },
        });
      });
    }
    return out;
  }, [query, mathResult, bookmarks, notes, onOpenNote, onFocusWidget, onClose]);

  useEffect(() => setSel(0), [results.length, query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const groups = useMemo(() => {
    const map = new Map<string, { item: Result; idx: number }[]>();
    results.forEach((item, idx) => {
      const arr = map.get(item.group) ?? [];
      arr.push({ item, idx });
      map.set(item.group, arr);
    });
    return [...map.entries()];
  }, [results]);

  const onKeyNav = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && results[sel]) {
      e.preventDefault();
      results[sel].run();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[11vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{ background: 'var(--overlay)', backdropFilter: 'blur(8px)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="acrylic-solid w-full max-w-[620px] overflow-hidden rounded-2xl"
            initial={{ opacity: 0, scale: 0.96, y: -14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ duration: 0.17, ease: [0.2, 0.9, 0.3, 1] }}
            role="dialog"
            aria-label="Universal search"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--stroke-soft)] px-4">
              <Search20Regular className="text-[var(--text2)]" />
              <input
                ref={inputRef}
                className="h-12 flex-1 bg-transparent text-[14.5px] font-medium outline-none placeholder:text-[var(--text2)]"
                placeholder="Type a math expression or search everything…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyNav}
                aria-label="Search query"
              />
              <button className="btn-icon !h-7 !w-7" onClick={onClose} aria-label="Close search">
                <span className="kbd">Esc</span>
              </button>
            </div>

            <div ref={listRef} className="max-h-[46vh] overflow-y-auto scroll-thin p-2">
              {results.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 py-9 text-center">
                  <div className="text-[13px] font-bold">
                    {query.trim() ? 'No matches found' : 'Start typing to search'}
                  </div>
                  <div className="text-xs text-[var(--text2)]">
                    {query.trim()
                      ? 'Try a bookmark name, note keyword, or a math expression like 128*4+16'
                      : 'Bookmarks, notes, calendar events, Drive files and instant math'}
                  </div>
                </div>
              )}
              {groups.map(([group, items]) => (
                <div key={group} className="mb-1">
                  <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--text2)]">
                    {group}
                  </div>
                  {items.map(({ item, idx }) => (
                    <button
                      key={item.key}
                      data-idx={idx}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors"
                      style={idx === sel ? { background: 'var(--card-hover)' } : undefined}
                      onMouseEnter={() => setSel(idx)}
                      onClick={item.run}
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                        style={{ background: 'var(--ac-soft)', color: 'var(--ac-text)' }}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold">{item.title}</span>
                        {item.sub && <span className="block truncate text-[11.5px] text-[var(--text2)]">{item.sub}</span>}
                      </span>
                      {idx === sel && <span className="kbd shrink-0">Enter</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
