import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  ArrowDownload20Regular,
  ArrowReset20Regular,
  ArrowUpload20Regular,
  Delete20Regular,
} from '@fluentui/react-icons';
import type { AppSettings, ExportBundle } from '../lib/types';
import {
  blobToDataUrl,
  dataUrlToBlob,
  downloadFile,
  idbAllImages,
  idbClearImages,
  idbPutImage,
  load,
  readFileAsText,
  removeKey,
  save,
  toast,
} from '../lib/store';
import { Modal, Spinner, Toggle } from './chrome';

const WIDGET_LABELS: { id: string; label: string }[] = [
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'notes', label: 'Notes' },
  { id: 'weather', label: 'Weather' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'drive', label: 'Drive' },
];

const ACCENTS = [
  { value: '#343d3f', label: 'Monochrome' },
  { value: '#4f6bed', label: 'Blue' },
  { value: '#038387', label: 'Teal' },
  { value: '#107c10', label: 'Green' },
  { value: '#8764b8', label: 'Purple' },
  { value: '#ca5010', label: 'Orange' },
  { value: '#c42b1c', label: 'Red' },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-[13px] font-extrabold">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[11.5px] leading-relaxed text-[var(--text2)]">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </section>
  );
}

export function SettingsModal({
  open,
  onClose,
  settings,
  setSettings,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}) {
  const [confirmErase, setConfirmErase] = useState(false);
  const [exporting, setExporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    setExporting(true);
    try {
      const images = await idbAllImages();
      const bundle: ExportBundle = {
        app: 'dashboard',
        version: 1,
        exportedAt: Date.now(),
        bookmarks: load('dash.bookmarks', []),
        notes: load('dash.notes', []),
        settings: load('dash.settings', settings),
        layout: load('dash.layout', []),
        favoriteFolders: load('dash.drive.favs', []),
        images: await Promise.all(images.map(async (img) => ({ id: img.id, dataUrl: await blobToDataUrl(img.blob) }))),
      };
      downloadFile(`dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2));
      toast('Backup exported', 'success');
    } catch {
      toast('Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const importAll = async (file: File) => {
    try {
      const bundle = JSON.parse(await readFileAsText(file)) as ExportBundle;
      if (!Array.isArray(bundle?.bookmarks)) {
        toast('That is not a dashboard backup file', 'error');
        return;
      }
      save('dash.bookmarks', bundle.bookmarks);
      save('dash.notes', bundle.notes ?? []);
      save('dash.settings', bundle.settings ?? settings);
      if (bundle.layout) save('dash.layout', bundle.layout);
      save('dash.drive.favs', bundle.favoriteFolders ?? []);
      await idbClearImages();
      for (const img of bundle.images ?? []) await idbPutImage(img.id, dataUrlToBlob(img.dataUrl));
      toast('Backup restored — reloading', 'success');
      setTimeout(() => location.reload(), 700);
    } catch {
      toast('Import failed: unreadable file', 'error');
    }
  };

  const resetLayout = () => {
    removeKey('dash.layout');
    toast('Layout reset', 'success');
    setTimeout(() => location.reload(), 450);
  };

  const eraseAll = async () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('dash.')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    await idbClearImages().catch(() => undefined);
    toast('All data erased', 'success');
    setTimeout(() => location.reload(), 600);
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" width="max-w-xl">
      <Section title="Accent" hint="Subtle touch — changes the maximise button, Mica glow and highlights. Instant.">
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold transition-all hover:-translate-y-[1px] ${
                (settings.accent ?? '#343d3f') === a.value ? 'bg-[var(--elev)]' : 'border-[var(--stroke-soft)] bg-[var(--base)]'
              }`}
              style={
                (settings.accent ?? '#343d3f') === a.value
                  ? { borderColor: a.value, color: a.value }
                  : undefined
              }
              onClick={() => setSettings((s) => ({ ...s, accent: a.value }))}
              aria-label={`Accent: ${a.label}`}
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: a.value }} />
              {a.label}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Lock dashboard"
        hint="When locked, widgets stay in place — no dragging or resizing until you unlock from here or the top bar."
      >
        <Toggle
          checked={settings.locked}
          onChange={(v) => setSettings((s) => ({ ...s, locked: v }))}
          label={settings.locked ? 'Dashboard is locked' : 'Dashboard is unlocked'}
        />
      </Section>

      <Section title="Widgets" hint="Toggle individual widgets instantly.">
        <div className="grid grid-cols-2 gap-1.5">
          {WIDGET_LABELS.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-xl border border-[var(--stroke-soft)] bg-[var(--base)] px-3 py-2"
            >
              <span className="text-[12.5px] font-semibold">{w.label}</span>
              <Toggle
                checked={settings.widgets[w.id] !== false}
                onChange={(v) => setSettings((s) => ({ ...s, widgets: { ...s.widgets, [w.id]: v } }))}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Google account"
        hint="Paste an OAuth Client ID (type “Web application”) from Google Cloud Console and add this site's origin to Authorized JavaScript origins. Drive and Calendar then connect in one click. Saved as you type."
      >
        <input
          className="input"
          placeholder="xxxxxx.apps.googleusercontent.com"
          value={settings.googleClientId}
          onChange={(e) => setSettings((s) => ({ ...s, googleClientId: e.target.value.trim() }))}
          aria-label="Google OAuth Client ID"
        />
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] font-medium text-[var(--text2)]">
          <span>· auth/drive — browse, upload, rename, delete</span>
          <span>· auth/calendar — read and manage events</span>
        </div>
      </Section>

      <Section
        title="Weather"
        hint="Optional OpenWeather key for the official feed. Without one, the keyless Open-Meteo source is used and every reading still works."
      >
        <input
          className="input"
          type="password"
          placeholder="OpenWeather API key (optional)"
          value={settings.openWeatherKey}
          onChange={(e) => setSettings((s) => ({ ...s, openWeatherKey: e.target.value.trim() }))}
          aria-label="OpenWeather API key"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            className="input"
            placeholder="Pinned city (leave empty for auto-detect)"
            value={settings.weatherLocation}
            onChange={(e) => setSettings((s) => ({ ...s, weatherLocation: e.target.value }))}
            aria-label="Weather city"
          />
          {settings.weatherLocation && (
            <button className="btn shrink-0" onClick={() => setSettings((s) => ({ ...s, weatherLocation: '' }))}>
              Auto
            </button>
          )}
        </div>
      </Section>

      <Section title="Data" hint="Everything lives in this browser: LocalStorage plus IndexedDB for note images.">
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={exportAll} disabled={exporting}>
            {exporting ? <Spinner size={13} /> : <ArrowDownload20Regular />} Export all
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            <ArrowUpload20Regular /> Import backup
          </button>
          <button className="btn" onClick={resetLayout}>
            <ArrowReset20Regular /> Reset layout
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmErase(true)}>
            <Delete20Regular /> Erase all
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importAll(f);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title="Shortcuts">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            ['Ctrl / ⌘ + K', 'Universal search'],
            ['Alt + 1…6', 'Jump to widget'],
            ['/', 'Search bookmarks'],
            ['N', 'New bookmark'],
            ['Esc', 'Close · restore · clear'],
            ['Right-click', 'Item actions'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--base)] px-2.5 py-1.5">
              <span className="kbd">{k}</span>
              <span className="text-right text-[11.5px] font-semibold text-[var(--text2)]">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <p className="text-[11px] leading-relaxed text-[var(--text2)]">
        Version 1.0 · React, TypeScript, Vite, Tailwind CSS, Framer Motion, React Grid Layout, Fuse.js, React Markdown,
        Fluent System Icons, Google Identity Services, Drive &amp; Calendar REST APIs, OpenWeather / Open-Meteo. Data
        stays on this device; API calls go straight from your browser to the provider.
      </p>

      <Modal
        open={confirmErase}
        onClose={() => setConfirmErase(false)}
        title="Erase everything?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmErase(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={eraseAll}>
              <Delete20Regular /> Erase all data
            </button>
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-[var(--text2)]">
          Permanently deletes all bookmarks, notes, images, settings and layout stored in this browser. Export a backup
          first if you might want it later.
        </p>
      </Modal>
    </Modal>
  );
}
