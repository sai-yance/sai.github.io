import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Add20Regular,
  ArrowDownload20Regular,
  ArrowUpload20Regular,
  Delete20Regular,
  Image20Regular,
  Note20Regular,
  Pin20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import type { Note } from '../lib/types';
import {
  blobToDataUrl,
  downloadFile,
  fmtAgo,
  idbGetImage,
  idbPutImage,
  readFileAsText,
  toast,
  uid,
} from '../lib/store';
import { EmptyState, Modal, WidgetShell } from './chrome';

export const NOTE_COLORS = ['#343d3f', '#c42b1c', '#ca5010', '#9d5d00', '#598526', '#107c10', '#038387', '#0f6cbd', '#4f6bed', '#8764b8', '#c239b3', '#e7489b'];

interface NoteRequest {
  id: string;
  ts: number;
}

function makeNote(): Note {
  return {
    id: uid(),
    title: '',
    body: '',
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function NotesWidget({
  notes,
  setNotes,
  request,
}: {
  notes: Note[];
  setNotes: Dispatch<SetStateAction<Note[]>>;
  request: NoteRequest | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(notes[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'edit' | 'split' | 'preview'>('split');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [dropOver, setDropOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastRequest = useRef(0);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : notes;
    return [...filtered].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  }, [notes, query]);

  const active = useMemo(() => notes.find((n) => n.id === activeId) ?? sorted[0] ?? null, [notes, activeId, sorted]);

  useEffect(() => {
    if (request && request.ts !== lastRequest.current) {
      lastRequest.current = request.ts;
      if (notes.some((n) => n.id === request.id)) setActiveId(request.id);
    }
  }, [request, notes]);

  /* resolve idb: image references to object URLs */
  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set((active?.body ?? '').match(/idb:([a-f0-9-]+)/gi)?.map((m) => m.slice(4)) ?? [])];
    const missing = ids.filter((id) => !resolved[id]);
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => idbGetImage(id).then((blob) => ({ id, blob })))).then((entries) => {
      if (cancelled) return;
      const add: Record<string, string> = {};
      entries.forEach(({ id, blob }) => {
        if (blob) add[id] = URL.createObjectURL(blob);
      });
      if (Object.keys(add).length) setResolved((r) => ({ ...r, ...add }));
    });
    return () => {
      cancelled = true;
    };
  }, [active?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchActive = (p: Partial<Note>) => {
    if (!active) return;
    setNotes((cur) => cur.map((n) => (n.id === active.id ? { ...n, ...p, updatedAt: Date.now() } : n)));
  };

  const addNote = () => {
    const n = makeNote();
    setNotes((cur) => [n, ...cur]);
    setActiveId(n.id);
    setQuery('');
  };

  const deleteActive = () => {
    if (!active) return;
    setNotes((cur) => cur.filter((n) => n.id !== active.id));
    setConfirmDelete(false);
    toast('Note deleted');
  };

  const insertImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Only image files can be attached', 'error');
      return;
    }
    if (!active) return;
    const id = uid();
    await idbPutImage(id, file);
    const ta = taRef.current;
    const snippet = `\n![${file.name.replace(/\)/g, '')}](idb:${id})\n`;
    if (ta) {
      const start = ta.selectionStart ?? active.body.length;
      const end = ta.selectionEnd ?? start;
      const body = active.body.slice(0, start) + snippet + active.body.slice(end);
      patchActive({ body });
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + snippet.length;
      });
    } else {
      patchActive({ body: active.body + snippet });
    }
    toast('Image attached', 'success');
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach(insertImage);
    }
  };

  const wrapSelection = (before: string, after = before, placeholder = 'text') => {
    const ta = taRef.current;
    if (!ta || !active) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = active.body.slice(start, end) || placeholder;
    const body = active.body.slice(0, start) + before + selected + after + active.body.slice(end);
    patchActive({ body });
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + selected.length;
    });
  };

  const exportAll = () => {
    downloadFile('notes.json', JSON.stringify({ app: 'dashboard-notes', version: 1, notes }, null, 2));
    toast('Notes exported', 'success');
  };

  const exportMd = () => {
    if (!active) return;
    const name = (active.title || 'untitled').replace(/[^\w-]+/g, '-').toLowerCase();
    downloadFile(`${name}.md`, active.body, 'text/markdown');
    toast('Markdown exported', 'success');
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await readFileAsText(file));
      const list: Note[] = Array.isArray(data) ? data : data.notes;
      if (!Array.isArray(list)) throw new Error('bad');
      const existing = new Set(notes.map((n) => n.id));
      const merged = list
        .filter((n) => n && typeof n.body === 'string')
        .map((n) => ({ ...makeNote(), ...n, id: existing.has(n.id) ? uid() : n.id }));
      if (merged.length === 0) {
        toast('No notes found in that file', 'error');
        return;
      }
      setNotes((cur) => [...merged, ...cur]);
      toast(`Imported ${merged.length} note${merged.length === 1 ? '' : 's'}`, 'success');
    } catch {
      toast('That JSON file could not be read', 'error');
    }
  };

  const words = active ? active.body.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars = active?.body.length ?? 0;

  const urlTransform = (url: string) => {
    if (url.startsWith('idb:')) return resolved[url.slice(4)] ?? '';
    if (/^(https?:|data:image\/|blob:)/i.test(url)) return url;
    return '';
  };

  const fileRef = useRef<HTMLInputElement>(null);

  const mdToolbar: { label: string; title: string; run: () => void }[] = [
    { label: 'B', title: 'Bold', run: () => wrapSelection('**') },
    { label: 'I', title: 'Italic', run: () => wrapSelection('*') },
    { label: 'H', title: 'Heading', run: () => wrapSelection('\n## ', '\n', 'Heading') },
    { label: '</>', title: 'Code', run: () => wrapSelection('`') },
    { label: '•', title: 'List', run: () => wrapSelection('\n- ', '\n', 'item') },
    { label: '[ ]', title: 'Task', run: () => wrapSelection('\n- [ ] ', '\n', 'task') },
    { label: '🔗', title: 'Link', run: () => wrapSelection('[', '](https://)', 'link text') },
  ];

  return (
    <WidgetShell
      title="Notes"
      icon={<Note20Regular />}
      actions={
        <>
          <button className="btn-icon" title="Import notes (JSON)" aria-label="Import notes" onClick={() => fileRef.current?.click()}>
            <ArrowUpload20Regular />
          </button>
          <button className="btn-icon" title="Export notes (JSON)" aria-label="Export notes" onClick={exportAll}>
            <ArrowDownload20Regular />
          </button>
          <button className="btn-icon" title="New note" aria-label="New note" onClick={addNote}>
            <Add20Regular />
          </button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJson(f);
          e.target.value = '';
        }}
      />
      <div className="flex h-full min-h-0">
        {/* note list rail */}
        <div className="flex w-[176px] shrink-0 flex-col border-r border-[var(--stroke-soft)]">
          <div className="px-2.5 pb-2 pt-0.5">
            <div className="relative">
              <Search20Regular className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text2)]" fontSize={14} />
              <input
                className="input !h-8 !pl-8 !text-xs"
                placeholder="Search notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search notes"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-2 pb-2">
            {sorted.length === 0 && (
              <div className="px-2 py-6 text-center text-[11.5px] text-[var(--text2)]">
                {query ? 'No notes match.' : 'No notes yet.'}
              </div>
            )}
            {sorted.map((n) => (
              <button
                key={n.id}
                className="mb-1 flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-[7px] text-left transition-colors hover:bg-[var(--card-hover)]"
                style={
                  active?.id === n.id
                    ? { background: 'var(--card-solid)', borderColor: 'var(--stroke-soft)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
                    : undefined
                }
                onClick={() => setActiveId(n.id)}
              >
                <span
                  className="mt-[3px] h-8 w-[3.5px] shrink-0 rounded-full"
                  style={{
                    background: n.color,
                    boxShadow: `0 0 5px color-mix(in srgb, ${n.color} 45%, transparent)`,
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-[12px] font-bold leading-tight">
                    {n.pinned && <Pin20Regular fontSize={11} className="shrink-0 text-[var(--ac-text)]" />}
                    {n.title || 'Untitled'}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-[var(--text2)]">
                    {n.body.replace(/[#>*`\-![\]()]/g, '').slice(0, 40) || 'Empty note'} · {fmtAgo(n.updatedAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!active ? (
            <EmptyState
              icon={<Note20Regular />}
              title="No note selected"
              hint="Create a note to start capturing ideas in Markdown."
              action={
                <button className="btn btn-accent" onClick={addNote}>
                  <Add20Regular /> New note
                </button>
              }
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--stroke-soft)] px-3 py-2">
                <input
                  className="font-display min-w-0 flex-1 bg-transparent text-[15px] font-extrabold outline-none placeholder:text-[var(--text2)]"
                  placeholder="Note title…"
                  value={active.title}
                  onChange={(e) => patchActive({ title: e.target.value })}
                  aria-label="Note title"
                />
                <div className="seg !p-[2px]">
                  {(['edit', 'split', 'preview'] as const).map((v) => (
                    <button key={v} className={`seg-item !h-6 !px-2 !text-[11px] ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
                      {v === 'edit' ? 'Write' : v === 'split' ? 'Split' : 'Read'}
                    </button>
                  ))}
                </div>
                <button className="btn-icon !h-7 !w-7" title="Export as Markdown" aria-label="Export as Markdown" onClick={exportMd}>
                  <ArrowDownload20Regular fontSize={15} />
                </button>
                <button className="btn-icon !h-7 !w-7" title="Delete note" aria-label="Delete note" onClick={() => setConfirmDelete(true)}>
                  <Delete20Regular fontSize={15} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--stroke-soft)] px-3 py-1.5">
                <div className="flex items-center gap-1">
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      className="h-[15px] w-[15px] rounded-full border transition-transform hover:scale-110"
                      style={{ background: c, borderColor: active.color === c ? 'var(--text)' : 'transparent', outline: active.color === c ? '2px solid var(--ac-soft)' : 'none' }}
                      onClick={() => patchActive({ color: c })}
                      aria-label={`Set color ${c}`}
                      title="Color label"
                    />
                  ))}
                </div>
                <div className="mx-1 h-4 w-px bg-[var(--stroke-soft)]" />
                <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text2)]">
                  <span className="font-bold">Tags</span>
                  <input
                    className="input !h-6 w-[130px] !text-[11px]"
                    placeholder="comma, separated"
                    value={active.tags.join(', ')}
                    onChange={(e) =>
                      patchActive({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
                    }
                    aria-label="Note tags"
                  />
                </div>
                <div className="mx-1 h-4 w-px bg-[var(--stroke-soft)]" />
                <button
                  className={`chip !h-6 ${active.pinned ? 'on' : ''}`}
                  onClick={() => patchActive({ pinned: !active.pinned })}
                  title="Pin note"
                >
                  <Pin20Regular fontSize={12} /> {active.pinned ? 'Pinned' : 'Pin'}
                </button>
                <span className="ml-auto text-[10.5px] font-semibold tabular-nums text-[var(--text2)]">
                  {words} words · {chars} chars · saved {fmtAgo(active.updatedAt)}
                </span>
              </div>

              {view !== 'preview' && (
                <div className="flex items-center gap-0.5 border-b border-[var(--stroke-soft)] px-3 py-1">
                  {mdToolbar.map((t) => (
                    <button key={t.title} className="btn-icon !h-7 !w-8 !rounded-md !text-[11.5px] !font-bold" title={t.title} onClick={t.run}>
                      {t.label}
                    </button>
                  ))}
                  <span className="ml-auto flex items-center gap-1 text-[10.5px] text-[var(--text2)]">
                    <Image20Regular fontSize={13} /> paste or drop images
                  </span>
                </div>
              )}

              <div
                className={`relative min-h-0 flex-1 ${view === 'split' ? 'grid grid-cols-2 divide-x divide-[var(--stroke-soft)]' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropOver(true);
                }}
                onDragLeave={() => setDropOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropOver(false);
                  [...(e.dataTransfer?.files ?? [])].forEach(insertImage);
                }}
              >
                {dropOver && (
                  <div className="pointer-events-none absolute inset-1.5 z-10 grid place-items-center rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--ac)', background: 'var(--ac-soft)' }}>
                    <span className="text-[13px] font-bold" style={{ color: 'var(--ac-text)' }}>
                      Drop image to attach
                    </span>
                  </div>
                )}
                {view !== 'preview' && (
                  <textarea
                    ref={taRef}
                    className="h-full w-full resize-none bg-transparent p-3.5 text-[13px] leading-relaxed outline-none placeholder:text-[var(--text2)]"
                    placeholder={'Write in Markdown…\n\n# Heading\n- list item\n**bold** · `code`\n\nPaste or drop images straight in.'}
                    value={active.body}
                    onChange={(e) => patchActive({ body: e.target.value })}
                    onPaste={onPaste}
                    spellCheck={false}
                    aria-label="Note body (Markdown)"
                  />
                )}
                {view !== 'edit' && (
                  <div className="md h-full overflow-y-auto scroll-thin p-3.5">
                    {active.body.trim() ? (
                      <ReactMarkdown urlTransform={urlTransform}>{active.body}</ReactMarkdown>
                    ) : (
                      <span className="text-[12.5px] text-[var(--text2)]">Live preview appears here…</span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete note?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Keep note
            </button>
            <button className="btn btn-danger" onClick={deleteActive}>
              <Delete20Regular /> Delete
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--text2)]">
          “{active?.title || 'Untitled'}” will be permanently removed. Attached images stored with the note will no
          longer be referenced.
        </p>
      </Modal>
    </WidgetShell>
  );
}

/* used by the export-all flow in Settings to inline images */
export async function notesWithImages(): Promise<{ id: string; dataUrl: string }[]> {
  const { idbAllImages } = await import('../lib/store');
  const all = await idbAllImages();
  return Promise.all(all.map(async (img) => ({ id: img.id, dataUrl: await blobToDataUrl(img.blob) })));
}
