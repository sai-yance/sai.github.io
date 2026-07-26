import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownload20Regular,
  ArrowSync20Regular,
  ChevronRight20Regular,
  Cloud20Regular,
  CloudArrowUp20Regular,
  Delete20Regular,
  Document20Regular,
  Edit20Regular,
  Folder20Regular,
  FolderAdd20Regular,
  Home20Regular,
  Image20Regular,
  MoreHorizontal20Regular,
  Open20Regular,
  PlugConnected20Regular,
  Search20Regular,
  SignOut20Regular,
  Star20Regular,
  StarOff20Regular,
  Video20Regular,
} from '@fluentui/react-icons';
import type { DriveFile, DriveQuota, FavoriteFolder } from '../lib/types';
import { driveApi, hasGoogleClientId, signOutGoogle } from '../lib/google';
import { appCache } from '../lib/appCache';
import { fmtAgo, fmtBytes, toast, usePersistent } from '../lib/store';
import { ContextMenu, EmptyState, Modal, Spinner, WidgetShell, type MenuItem } from './chrome';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function fileIcon(f: DriveFile) {
  if (f.mimeType === FOLDER_MIME) return <Folder20Regular primaryFill="var(--ac-text)" />;
  if (f.mimeType.startsWith('image/')) return <Image20Regular primaryFill="#57a85c" />;
  if (f.mimeType.startsWith('video/')) return <Video20Regular primaryFill="#c2540a" />;
  if (f.mimeType === 'application/pdf') return <Document20Regular primaryFill="#c42b1c" />;
  return <Document20Regular primaryFill="var(--text2)" />;
}

interface PreviewTarget {
  file: DriveFile;
  url: string | null;
  loading: boolean;
}

export function DriveWidget({ request }: { request: { fileId?: string; name?: string; mime?: string; ts: number } | null }) {
  const [signedIn, setSignedIn] = usePersistent('dash.drive.signedIn', false);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<'files' | 'recent'>('files');
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'My Drive' }]);
  const [items, setItems] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DriveFile[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; file: DriveFile } | null>(null);
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [quota, setQuota] = useState<DriveQuota | null>(null);
  const [favorites, setFavorites] = usePersistent<FavoriteFolder[]>('dash.drive.favs', []);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const lastRequest = useRef(0);

  const currentFolder = path[path.length - 1];
  const shownItems = searchResults ?? items;

  const refresh = useCallback(
    async (folderId?: string | null, targetTab?: 'files' | 'recent') => {
      if (!hasGoogleClientId()) return;
      const t = targetTab ?? tab;
      setLoading(true);
      setError(null);
      try {
        if (t === 'recent') {
          const list = await driveApi.recentFiles();
          setItems(list);
          appCache.driveFiles = list;
        } else {
          const list = await driveApi.listChildren(folderId !== undefined ? folderId : currentFolder.id);
          setItems(list);
          appCache.driveFiles = list;
        }
        setSignedIn(true);
        driveApi
          .about()
          .then((q) => setQuota({ usage: q.usage, limit: q.limit, email: q.email }))
          .catch(() => undefined);
      } catch (e) {
        setSignedIn(false);
        setError(e instanceof Error ? e.message : 'Could not reach Google Drive');
      } finally {
        setLoading(false);
      }
    },
    [tab, currentFolder.id, setSignedIn],
  );

  useEffect(() => {
    if (signedIn && hasGoogleClientId()) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const connect = async () => {
    if (!hasGoogleClientId()) {
      toast('Add your Google OAuth Client ID in Settings → Google first', 'error');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await refresh(null, tab);
      toast('Google Drive connected', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    signOutGoogle();
    setSignedIn(false);
    setItems([]);
    setQuota(null);
    toast('Signed out of Google');
  };

  const navigate = (folder: DriveFile) => {
    setTab('files');
    setSearchResults(null);
    setQuery('');
    setPath((p) => [...p, { id: folder.id, name: folder.name }]);
    refresh(folder.id, 'files');
  };

  const navigateToIndex = (idx: number) => {
    const next = path.slice(0, idx + 1);
    setPath(next);
    setSearchResults(null);
    refresh(next[next.length - 1].id, 'files');
  };

  const openItem = (f: DriveFile) => {
    if (f.mimeType === FOLDER_MIME) navigate(f);
    else openPreview(f);
  };

  const openPreview = async (f: DriveFile) => {
    setPreview({ file: f, url: null, loading: true });
    try {
      const blob = await driveApi.blob(f.id);
      setPreview((p) => (p && p.file.id === f.id ? { ...p, url: URL.createObjectURL(blob), loading: false } : p));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Preview failed', 'error');
      setPreview(null);
    }
  };

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await driveApi.searchFiles(q);
      setSearchResults(res);
      appCache.driveFiles = res;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;
    setUploading(true);
    const parent = tab === 'files' && !searchResults ? currentFolder.id : null;
    let ok = 0;
    for (const file of list) {
      try {
        await driveApi.upload(file, parent);
        ok++;
      } catch (e) {
        toast(e instanceof Error ? e.message : `Upload of ${file.name} failed`, 'error');
      }
    }
    setUploading(false);
    if (ok > 0) {
      toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`, 'success');
      refresh(parent, tab);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      await driveApi.rename(renaming.id, name);
      toast('Renamed', 'success');
      setRenaming(null);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Rename failed', 'error');
    }
  };

  const remove = async (f: DriveFile) => {
    try {
      await driveApi.remove(f.id);
      toast(`“${f.name}” moved to trash`);
      if (favorites.some((x) => x.id === f.id)) setFavorites((cur) => cur.filter((x) => x.id !== f.id));
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    try {
      await driveApi.createFolder(name, currentFolder.id);
      toast('Folder created', 'success');
      setNewFolderOpen(false);
      setFolderName('');
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create folder', 'error');
    }
  };

  const toggleFavorite = (f: DriveFile) => {
    setFavorites((cur) =>
      cur.some((x) => x.id === f.id) ? cur.filter((x) => x.id !== f.id) : [...cur, { id: f.id, name: f.name }],
    );
  };

  useEffect(() => {
    if (request && request.ts !== lastRequest.current && request.fileId) {
      lastRequest.current = request.ts;
      openPreview({ id: request.fileId, name: request.name ?? 'File', mimeType: request.mime ?? 'application/octet-stream' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const menuItems = (f: DriveFile): MenuItem[] => {
    const isFolder = f.mimeType === FOLDER_MIME;
    const fav = favorites.some((x) => x.id === f.id);
    return [
      ...(isFolder
        ? [{ label: 'Open folder', icon: <Folder20Regular />, onClick: () => navigate(f) }]
        : [{ label: 'Preview', icon: <Document20Regular />, onClick: () => openPreview(f) },
           { label: 'Download', icon: <ArrowDownload20Regular />, onClick: () => driveApi.download(f.id, f.name).catch((e) => toast(e.message, 'error')) }]),
      ...(f.webViewLink ? [{ label: 'Open in Google Drive', icon: <Open20Regular />, onClick: () => window.open(f.webViewLink, '_blank', 'noopener') }] : []),
      { label: 'Rename', icon: <Edit20Regular />, onClick: () => { setRenaming(f); setRenameValue(f.name); } },
      ...(isFolder
        ? [{ label: fav ? 'Remove from favourites' : 'Favourite folder', icon: fav ? <StarOff20Regular /> : <Star20Regular />, onClick: () => toggleFavorite(f) }]
        : []),
      { divider: true },
      { label: 'Delete', icon: <Delete20Regular />, danger: true, onClick: () => remove(f) },
    ];
  };

  const quotaPct = quota && quota.limit > 0 ? Math.min(100, (quota.usage / quota.limit) * 100) : 0;

  const fileList = useMemo(() => shownItems, [shownItems]);

  return (
    <WidgetShell
      title="Google Drive"
      icon={<Cloud20Regular />}
      actions={
        signedIn ? (
          <>
            {uploading && <Spinner size={14} />}
            <button className="btn-icon" title="Refresh" aria-label="Refresh Drive" onClick={() => refresh()}>
              <ArrowSync20Regular />
            </button>
            <button className="btn-icon" title="Upload files" aria-label="Upload files" onClick={() => uploadRef.current?.click()}>
              <CloudArrowUp20Regular />
            </button>
            <button className="btn-icon" title="New folder" aria-label="New folder" onClick={() => setNewFolderOpen(true)}>
              <FolderAdd20Regular />
            </button>
            <button className="btn-icon" title="Sign out" aria-label="Sign out of Google" onClick={disconnect}>
              <SignOut20Regular />
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {!signedIn ? (
        <EmptyState
          icon={<PlugConnected20Regular />}
          title="Connect Google Drive"
          hint={
            hasGoogleClientId()
              ? 'Sign in with Google to browse, upload and manage your files.'
              : 'Add your Google OAuth Client ID in Settings → Google, then connect.'
          }
          action={
            <button className="btn btn-accent" onClick={connect} disabled={connecting}>
              {connecting ? <Spinner size={14} /> : <PlugConnected20Regular />} {connecting ? 'Connecting…' : 'Connect Google'}
            </button>
          }
        />
      ) : (
        <div
          className="flex h-full flex-col"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
          }}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-1.5 z-20 grid place-items-center rounded-xl border-2 border-dashed" style={{ borderColor: 'var(--ac)', background: 'var(--ac-soft)' }}>
              <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--ac-text)' }}>
                <CloudArrowUp20Regular /> Drop files to upload
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 px-3 pb-2">
            <div className="relative flex-1">
              <Search20Regular className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text2)]" fontSize={14} />
              <input
                className="input !h-8 !pl-8 !text-xs"
                placeholder="Search Drive… (Enter)"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value.trim()) setSearchResults(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                aria-label="Search Drive files"
              />
            </div>
            <div className="seg !p-[2px]">
              <button className={`seg-item !h-6 !px-2 !text-[11px] ${tab === 'files' && !searchResults ? 'on' : ''}`} onClick={() => { setTab('files'); setSearchResults(null); setQuery(''); refresh(currentFolder.id, 'files'); }}>
                Files
              </button>
              <button className={`seg-item !h-6 !px-2 !text-[11px] ${tab === 'recent' && !searchResults ? 'on' : ''}`} onClick={() => { setTab('recent'); setSearchResults(null); setQuery(''); refresh(undefined, 'recent'); }}>
                Recent
              </button>
            </div>
          </div>

          {searchResults ? (
            <div className="flex items-center gap-2 px-3 pb-2 text-[11.5px] font-semibold text-[var(--text2)]">
              {searching ? <Spinner size={12} /> : null}
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'} for “{query}”
              <button className="chip !h-5 ml-auto" onClick={() => { setSearchResults(null); setQuery(''); }}>
                Clear
              </button>
            </div>
          ) : tab === 'files' ? (
            <div className="flex items-center gap-0.5 overflow-x-auto scroll-thin px-3 pb-2 text-[11.5px] font-bold">
              {path.map((p, i) => (
                <span key={i} className="flex shrink-0 items-center gap-0.5">
                  {i > 0 && <ChevronRight20Regular fontSize={12} className="text-[var(--text2)]" />}
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--card-hover)]"
                    style={i === path.length - 1 ? { color: 'var(--ac-text)' } : { color: 'var(--text2)' }}
                    onClick={() => i < path.length - 1 && navigateToIndex(i)}
                  >
                    {i === 0 && <Home20Regular fontSize={13} />}
                    {p.name}
                  </button>
                </span>
              ))}
              {favorites.length > 0 && (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {favorites.map((f) => (
                    <button key={f.id} className="chip !h-5 !text-[10px]" title={`Open favourite folder ${f.name}`} onClick={() => { setPath([{ id: null, name: 'My Drive' }, { id: f.id, name: f.name }]); setTab('files'); refresh(f.id, 'files'); }}>
                      <Star20Regular fontSize={11} primaryFill="var(--warn)" /> {f.name}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ) : (
            <div className="px-3 pb-2 text-[11.5px] font-semibold text-[var(--text2)]">Files you recently modified</div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-3 pb-2">
            {error && (
              <div className="mb-2 rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }}>
                {error}
              </div>
            )}
            {loading && fileList.length === 0 ? (
              <div className="flex flex-col gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="shimmer h-9 rounded-lg" />
                ))}
              </div>
            ) : fileList.length === 0 ? (
              <EmptyState
                icon={<Cloud20Regular />}
                title={searchResults ? 'No files match' : 'This folder is empty'}
                hint={searchResults ? 'Try a different search term.' : 'Upload files with the button above, or drag and drop them here.'}
              />
            ) : (
              <div className={`grid gap-1.5 ${loading ? 'opacity-60' : ''}`} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {fileList.map((f) => {
                  const isFolder = f.mimeType === FOLDER_MIME;
                  const fav = favorites.some((x) => x.id === f.id);
                  return (
                    <div
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      className="group flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--stroke-soft)] bg-[var(--card-solid)] px-2 py-1.5 transition-all hover:-translate-y-[1px] hover:shadow-md"
                      onClick={() => openItem(f)}
                      onKeyDown={(e) => e.key === 'Enter' && openItem(f)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, file: f });
                      }}
                      title={f.name}
                    >
                      <span className="shrink-0">{fileIcon(f)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-bold leading-tight">{f.name}</span>
                        <span className="block truncate text-[10px] text-[var(--text2)]">
                          {isFolder ? 'Folder' : f.size ? fmtBytes(Number(f.size)) : ''}
                          {f.modifiedTime ? ` · ${fmtAgo(f.modifiedTime)}` : ''}
                        </span>
                      </span>
                      {fav && <Star20Regular fontSize={13} primaryFill="var(--warn)" className="shrink-0" />}
                      <button
                        className="btn-icon !h-6 !w-6 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Actions for ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setMenu({ x: r.left - 180, y: r.bottom + 4, file: f });
                        }}
                      >
                        <MoreHorizontal20Regular fontSize={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {quota && quota.limit > 0 && (
            <div className="border-t border-[var(--stroke-soft)] px-3.5 py-2">
              <div className="mb-1 flex items-center justify-between text-[10.5px] font-semibold text-[var(--text2)]">
                <span className="truncate">{quota.email ?? 'Storage'}</span>
                <span className="tabular-nums">
                  {fmtBytes(quota.usage)} of {fmtBytes(quota.limit)} · {quotaPct.toFixed(1)}%
                </span>
              </div>
              <div className="h-[5px] overflow-hidden rounded-full bg-[var(--card-hover)]">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${quotaPct}%`, background: quotaPct > 90 ? 'var(--bad)' : 'var(--ac)' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.file)} onClose={() => setMenu(null)} />}

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename"
        footer={
          <>
            <button className="btn" onClick={() => setRenaming(null)}>Cancel</button>
            <button className="btn btn-accent" onClick={rename}>Rename</button>
          </>
        }
      >
        <input
          className="input mt-1"
          value={renameValue}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && rename()}
          aria-label="New name"
        />
      </Modal>

      <Modal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        title="New folder"
        footer={
          <>
            <button className="btn" onClick={() => setNewFolderOpen(false)}>Cancel</button>
            <button className="btn btn-accent" onClick={createFolder} disabled={!folderName.trim()}>Create</button>
          </>
        }
      >
        <input
          className="input mt-1"
          placeholder="Folder name"
          value={folderName}
          autoFocus
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          aria-label="Folder name"
        />
      </Modal>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.file.name ?? 'Preview'}
        width="max-w-3xl"
        footer={
          preview && (
            <>
              <button className="btn mr-auto" onClick={() => preview.file.webViewLink && window.open(preview.file.webViewLink, '_blank', 'noopener')}>
                <Open20Regular /> Open in Drive
              </button>
              <button
                className="btn btn-accent"
                onClick={() => driveApi.download(preview.file.id, preview.file.name).catch((e) => toast(e.message, 'error'))}
              >
                <ArrowDownload20Regular /> Download
              </button>
            </>
          )
        }
      >
        {preview?.loading && (
          <div className="grid h-[300px] place-items-center">
            <div className="flex items-center gap-2 text-[13px] text-[var(--text2)]">
              <Spinner /> Loading preview…
            </div>
          </div>
        )}
        {preview && !preview.loading && preview.url && (
          <div className="grid place-items-center">
            {preview.file.mimeType.startsWith('image/') && (
              <img src={preview.url} alt={preview.file.name} className="max-h-[60vh] max-w-full rounded-lg object-contain" />
            )}
            {preview.file.mimeType.startsWith('video/') && (
              <video src={preview.url} controls className="max-h-[60vh] w-full rounded-lg" />
            )}
            {preview.file.mimeType.startsWith('audio/') && <audio src={preview.url} controls className="w-full" />}
            {preview.file.mimeType === 'application/pdf' && <iframe src={preview.url} title={preview.file.name} className="h-[60vh] w-full rounded-lg border-0" />}
            {!preview.file.mimeType.startsWith('image/') &&
              !preview.file.mimeType.startsWith('video/') &&
              !preview.file.mimeType.startsWith('audio/') &&
              preview.file.mimeType !== 'application/pdf' && (
                <div className="py-10 text-center text-[13px] text-[var(--text2)]">No inline preview for this file type — download it instead.</div>
              )}
          </div>
        )}
      </Modal>
    </WidgetShell>
  );
}
