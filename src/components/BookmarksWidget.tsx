import { useMemo, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import {
  Add20Regular,
  ArrowDownload20Regular,
  ArrowUpload20Regular,
  Bookmark20Regular,
  ChevronDown20Regular,
  Copy20Regular,
  Delete20Regular,
  Edit20Regular,
  Link20Regular,
  Open20Regular,
  Pin20Regular,
  PinOff20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import type { Bookmark } from '../lib/types';
import {
  downloadFile,
  faviconUrl,
  hostOf,
  normalizeUrl,
  readFileAsText,
  tileColor,
  toast,
  uid,
} from '../lib/store';
import { ContextMenu, EmptyState, Modal, WidgetShell, type MenuItem } from './chrome';

function Favicon({ url, title, size = 34 }: { url: string; title: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  if (failed || !host) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-[9px] font-display font-extrabold text-white"
        style={{ width: size, height: size, background: tileColor(host || title), fontSize: size * 0.46 }}
      >
        {(title || host || '?').trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={faviconUrl(url)}
      alt=""
      draggable={false}
      className="shrink-0 rounded-[9px] border border-[var(--stroke-soft)] bg-white object-contain p-[3px]"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

export function BookmarksWidget({
  bookmarks,
  setBookmarks,
}: {
  bookmarks: Bookmark[];
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
}) {
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [form, setForm] = useState({ title: '', url: '' });
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? bookmarks.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
      : bookmarks;
    return [...filtered].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }, [bookmarks, query]);

  const openAdd = () => {
    setForm({ title: '', url: '' });
    setDialog({ mode: 'add' });
  };
  const openEdit = (b: Bookmark) => {
    setForm({ title: b.title, url: b.url });
    setDialog({ mode: 'edit', id: b.id });
  };

  const submit = () => {
    const url = normalizeUrl(form.url);
    if (!url || !/^https?:\/\/.+\..+/.test(url)) {
      toast('Enter a valid URL (e.g. example.com)', 'error');
      return;
    }
    if (dialog?.mode === 'add') {
      const b: Bookmark = { id: uid(), title: form.title.trim() || hostOf(url), url, addedAt: Date.now() };
      setBookmarks((cur) => [b, ...cur]);
      toast('Bookmark added', 'success');
    } else if (dialog?.mode === 'edit') {
      setBookmarks((cur) =>
        cur.map((b) => (b.id === dialog.id ? { ...b, title: form.title.trim() || hostOf(url), url } : b)),
      );
      toast('Bookmark updated', 'success');
    }
    setDialog(null);
  };

  const patch = (id: string, p: Partial<Bookmark>) => setBookmarks((cur) => cur.map((b) => (b.id === id ? { ...b, ...p } : b)));

  const remove = (id: string) => {
    setBookmarks((cur) => cur.filter((b) => b.id !== id));
    toast('Bookmark deleted');
  };

  const duplicate = (id: string) => {
    setBookmarks((cur) => {
      const idx = cur.findIndex((b) => b.id === id);
      if (idx < 0) return cur;
      const copy = { ...cur[idx], id: uid(), pinned: false, addedAt: Date.now() };
      const next = [...cur];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    toast('Bookmark duplicated', 'success');
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setBookmarks((cur) => {
      const next = [...cur];
      const fi = next.findIndex((b) => b.id === fromId);
      const ti = next.findIndex((b) => b.id === toId);
      if (fi < 0 || ti < 0) return cur;
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  };

  const exportJson = () => {
    downloadFile('bookmarks.json', JSON.stringify({ app: 'dashboard-bookmarks', version: 1, bookmarks }, null, 2));
    toast('Bookmarks exported', 'success');
  };

  /** One import button for everything: detects a browser HTML export or a JSON file. */
  const importFile = async (file: File) => {
    const text = await readFileAsText(file);
    const looksJson = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text);
    if (looksJson) importJson(text);
    else importHtml(text);
  };

  const importHtml = (text: string) => {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const anchors = [...doc.querySelectorAll('a[href]')];
    const seen = new Set(bookmarks.map((b) => b.url));
    const added: Bookmark[] = [];
    anchors.forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      const url = /^https?:\/\//i.test(href) ? href : '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      added.push({ id: uid(), title: a.textContent?.trim() || hostOf(url), url, addedAt: Date.now() });
    });
    if (added.length === 0) {
      toast('No new bookmarks found in that file', 'error');
      return;
    }
    setBookmarks((cur) => [...added, ...cur]);
    toast(`Imported ${added.length} bookmark${added.length === 1 ? '' : 's'}`, 'success');
  };

  const importJson = (text: string) => {
    try {
      const data = JSON.parse(text);
      const list: Bookmark[] = Array.isArray(data) ? data : data.bookmarks;
      if (!Array.isArray(list)) throw new Error('bad file');
      const valid = list.filter((b) => b && typeof b.url === 'string');
      const seen = new Set(bookmarks.map((b) => b.url));
      const added = valid
        .filter((b) => !seen.has(b.url))
        .map((b) => ({ id: uid(), title: String(b.title || hostOf(b.url)), url: b.url, pinned: !!b.pinned, addedAt: Date.now() }));
      if (added.length === 0) {
        toast('No new bookmarks in that file', 'error');
        return;
      }
      setBookmarks((cur) => [...added, ...cur]);
      toast(`Imported ${added.length} bookmark${added.length === 1 ? '' : 's'}`, 'success');
    } catch {
      toast('That JSON file could not be read', 'error');
    }
  };

  const onWidgetKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openAdd();
    } else if (e.key === 'Enter' && display[0]) {
      e.preventDefault();
      window.open(display[0].url, '_blank', 'noopener');
    }
  };

  const menuItems = (b: Bookmark): MenuItem[] => [
    { label: 'Open in new tab', icon: <Open20Regular />, onClick: () => window.open(b.url, '_blank', 'noopener') },
    { label: 'Edit', icon: <Edit20Regular />, onClick: () => openEdit(b) },
    { label: 'Duplicate', icon: <Copy20Regular />, onClick: () => duplicate(b.id) },
    {
      label: 'Copy URL',
      icon: <Link20Regular />,
      onClick: () => {
        navigator.clipboard?.writeText(b.url).then(
          () => toast('URL copied', 'success'),
          () => toast('Could not copy URL', 'error'),
        );
      },
    },
    {
      label: b.pinned ? 'Unpin' : 'Pin to top',
      icon: b.pinned ? <PinOff20Regular /> : <Pin20Regular />,
      onClick: () => patch(b.id, { pinned: !b.pinned }),
    },
    { divider: true },
    { label: 'Delete', icon: <Delete20Regular />, danger: true, onClick: () => remove(b.id) },
  ];

  return (
    <WidgetShell
      title="Bookmarks"
      icon={<Bookmark20Regular />}
      actions={
        <>
          <span className="chip pointer-events-none !cursor-default">{bookmarks.length}</span>
          <button
            className="btn-icon"
            title="Import bookmarks (browser HTML or JSON)"
            aria-label="Import bookmarks"
            onClick={() => fileRef.current?.click()}
          >
            <ArrowUpload20Regular />
          </button>
          <button className="btn-icon" title="Export bookmarks as JSON" aria-label="Export bookmarks" onClick={exportJson}>
            <ArrowDownload20Regular />
          </button>
          <button className="btn-icon" title="Add bookmark (N)" aria-label="Add bookmark" onClick={openAdd}>
            <Add20Regular />
          </button>
        </>
      }
    >
      <div className="flex h-full flex-col" tabIndex={0} onKeyDown={onWidgetKey}>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search20Regular className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text2)]" />
            <input
              ref={searchRef}
              className="input !pl-9"
              placeholder="Search bookmarks…  ( / )"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search bookmarks"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-3 pb-3">
          {display.length === 0 ? (
            <EmptyState
              icon={<Bookmark20Regular />}
              title={query ? 'No bookmarks match' : 'No bookmarks yet'}
              hint={query ? 'Try a different search term.' : 'Add your first bookmark, or import them from a browser HTML export.'}
              action={
                !query && (
                  <div className="flex gap-2">
                    <button className="btn btn-accent" onClick={openAdd}>
                      <Add20Regular /> Add bookmark
                    </button>
                    <button className="btn" onClick={() => fileRef.current?.click()}>
                      <ArrowUpload20Regular /> Import
                    </button>
                  </div>
                )
              }
            />
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))' }}>
              {display.map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e: DragEvent) => {
                    setDragId(b.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', b.id);
                  }}
                  onDragOver={(e: DragEvent) => {
                    e.preventDefault();
                    if (overId !== b.id) setOverId(b.id);
                  }}
                  onDragLeave={() => setOverId((o) => (o === b.id ? null : o))}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    if (dragId) reorder(dragId, b.id);
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onClick={() => window.open(b.url, '_blank', 'noopener')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') window.open(b.url, '_blank', 'noopener');
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, id: b.id });
                  }}
                  className="group relative flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-[var(--card-solid)] p-3 text-left transition-all duration-150 hover:-translate-y-[1.5px] hover:shadow-lg"
                  style={{
                    borderColor: overId === b.id && dragId !== b.id ? 'var(--ac)' : 'var(--stroke-soft)',
                    opacity: dragId === b.id ? 0.45 : 1,
                    boxShadow: overId === b.id && dragId !== b.id ? '0 0 0 3px var(--ac-soft)' : undefined,
                  }}
                  title={`${b.title}\n${b.url}\nRight-click for more actions`}
                >
                  {b.pinned && (
                    <span className="absolute right-2 top-2 text-[var(--ac-text)]" title="Pinned">
                      <Pin20Regular fontSize={14} />
                    </span>
                  )}
                  <Favicon url={b.url} title={b.title} />
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-bold leading-tight">{b.title || hostOf(b.url)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--text2)]">{hostOf(b.url)}</div>
                  </div>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2.5px] rounded-b-xl opacity-0 transition-opacity group-hover:opacity-100" style={{ background: 'var(--ac)' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".html,.htm,.json,text/html,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = '';
        }}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(display.find((b) => b.id === menu.id) ?? bookmarks.find((b) => b.id === menu.id)!)}
          onClose={() => setMenu(null)}
        />
      )}

      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'edit' ? 'Edit bookmark' : 'New bookmark'}
        footer={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button className="btn btn-accent" onClick={submit}>
              {dialog?.mode === 'edit' ? 'Save changes' : 'Add bookmark'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 pt-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-[var(--text2)]">URL — paste and press Enter</span>
            <input
              className="input"
              value={form.url}
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="github.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-[var(--text2)]">Title — optional, taken from the site by default</span>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={form.url ? hostOf(normalizeUrl(form.url)) : 'e.g. GitHub'}
            />
          </label>
          {form.url.trim() && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--stroke-soft)] bg-[var(--card-hover)] p-2.5">
              <Favicon url={normalizeUrl(form.url)} title={form.title || form.url} size={28} />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-bold">{form.title.trim() || hostOf(normalizeUrl(form.url))}</div>
                <div className="truncate text-[11px] text-[var(--text2)]">{hostOf(normalizeUrl(form.url))}</div>
              </div>
              <ChevronDown20Regular className="ml-auto hidden" />
            </div>
          )}
        </div>
      </Modal>
    </WidgetShell>
  );
}
