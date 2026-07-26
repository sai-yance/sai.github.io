import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { GridLayout, useContainerWidth, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import {
  Bookmark20Regular,
  Calculator20Regular,
  CalendarLtr20Regular,
  Cloud20Regular,
  Note20Regular,
  WeatherSunny20Regular,
} from '@fluentui/react-icons';
import type { AppSettings, Bookmark, Note } from './lib/types';
import { uid, usePersistent } from './lib/store';
import { setGoogleClientId } from './lib/google';
import type { WidgetId } from './lib/appCache';
import { Toasts, WidgetFrameContext } from './components/chrome';
import { TopBar } from './components/TopBar';
import { CommandPalette } from './components/CommandPalette';
import { BookmarksWidget } from './components/BookmarksWidget';
import { NotesWidget } from './components/NotesWidget';
import { CalculatorWidget } from './components/CalculatorWidget';
import { WeatherWidget } from './components/WeatherWidget';
import { CalendarWidget } from './components/CalendarWidget';
import { DriveWidget } from './components/DriveWidget';
import { SettingsModal } from './components/SettingsModal';

/* ---------------- constants ---------------- */

const ROWS = 12;
const COLS = 12;
const MARGIN = 10;
const TOPBAR_H = 54;
const PAGE_PAD = 10;
const COMPACT_BREAKPOINT = 1080;

const WIDGET_ORDER: WidgetId[] = ['bookmarks', 'notes', 'weather', 'calculator', 'calendar', 'drive'];

const WIDGET_INFO: Record<WidgetId, { label: string; icon: ReactNode; minW: number; minH: number }> = {
  bookmarks: { label: 'Bookmarks', icon: <Bookmark20Regular />, minW: 3, minH: 4 },
  notes: { label: 'Notes', icon: <Note20Regular />, minW: 3, minH: 4 },
  weather: { label: 'Weather', icon: <WeatherSunny20Regular />, minW: 2, minH: 4 },
  calculator: { label: 'Calculator', icon: <Calculator20Regular />, minW: 2, minH: 5 },
  calendar: { label: 'Calendar', icon: <CalendarLtr20Regular />, minW: 3, minH: 4 },
  drive: { label: 'Drive', icon: <Cloud20Regular />, minW: 3, minH: 4 },
};

/** Two rows of three — exactly ROWS tall so the dashboard never scrolls. */
function defaultLayout(): LayoutItem[] {
  return [
    { i: 'bookmarks', x: 0, y: 0, w: 5, h: 6 },
    { i: 'notes', x: 5, y: 0, w: 4, h: 6 },
    { i: 'weather', x: 9, y: 0, w: 3, h: 6 },
    { i: 'calculator', x: 0, y: 6, w: 3, h: 6 },
    { i: 'calendar', x: 3, y: 6, w: 5, h: 6 },
    { i: 'drive', x: 8, y: 6, w: 4, h: 6 },
  ].map((it) => ({ ...it, minW: WIDGET_INFO[it.i as WidgetId].minW, minH: WIDGET_INFO[it.i as WidgetId].minH }));
}

const DEFAULT_SETTINGS: AppSettings = {
  accent: '#343d3f',
  locked: false,
  openWeatherKey: '',
  googleClientId: '',
  weatherLocation: '',
  widgets: { bookmarks: true, notes: true, calculator: true, weather: true, calendar: true, drive: true },
};

/* ---------------- seed content ---------------- */

function seedBookmarks(): Bookmark[] {
  const sites: [string, string][] = [
    ['Google', 'https://www.google.com'],
    ['Gmail', 'https://mail.google.com'],
    ['YouTube', 'https://www.youtube.com'],
    ['GitHub', 'https://github.com'],
    ['ChatGPT', 'https://chatgpt.com'],
    ['Wikipedia', 'https://www.wikipedia.org'],
    ['Stack Overflow', 'https://stackoverflow.com'],
    ['Hacker News', 'https://news.ycombinator.com'],
    ['Figma', 'https://www.figma.com'],
    ['Notion', 'https://www.notion.so'],
    ['Reddit', 'https://www.reddit.com'],
    ['X', 'https://x.com'],
  ];
  return sites.map(([title, url], i) => ({ id: uid(), title, url, addedAt: Date.now() - i, pinned: i < 2 }));
}

function seedNotes(): Note[] {
  const now = Date.now();
  return [
    {
      id: uid(),
      title: 'Start here',
      color: '#343d3f',
      tags: ['guide'],
      pinned: true,
      createdAt: now,
      updatedAt: now,
      body: [
        '# Your dashboard',
        '',
        'Everything is saved automatically in this browser.',
        '',
        '- Drag a widget by its **title bar**, resize from the corner',
        '- **Ctrl + K** — universal search and instant math',
        '- **/** search bookmarks · **N** new bookmark · right-click for actions',
        '- Paste or drop images straight into a note',
        '',
        '## Connect services',
        '1. Settings → paste your Google OAuth Client ID',
        '2. Press *Connect Google* in Drive or Calendar',
        '3. Optional: add an OpenWeather key for the official weather feed',
      ].join('\n'),
    },
    {
      id: uid(),
      title: 'Markdown cheatsheet',
      color: '#4a5658',
      tags: ['reference'],
      createdAt: now - 1000,
      updatedAt: now - 1000,
      body: [
        '**bold** · *italic* · `code` · ~~strike~~',
        '',
        '- list item',
        '- [ ] task item',
        '',
        '```ts',
        'const greet = (n: string) => `Hello, ${n}`;',
        '```',
        '',
        '> Quote block',
      ].join('\n'),
    },
  ];
}

/* ---------------- app ---------------- */

export default function App() {
  const [settings, setSettings] = usePersistent<AppSettings>('dash.settings', DEFAULT_SETTINGS);
  const [bookmarks, setBookmarks] = usePersistent<Bookmark[]>('dash.bookmarks', seedBookmarks);
  const [notes, setNotes] = usePersistent<Note[]>('dash.notes', seedNotes);
  const [layout, setLayout] = usePersistent<LayoutItem[]>('dash.layout', defaultLayout);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [maximized, setMaximized] = useState<WidgetId | null>(null);
  const [focusId, setFocusId] = useState<WidgetId>('bookmarks');

  const [noteRequest, setNoteRequest] = useState<{ id: string; ts: number } | null>(null);
  const [calRequest, setCalRequest] = useState<{ eventId?: string; date?: string; ts: number } | null>(null);
  const [driveRequest, setDriveRequest] = useState<{ fileId?: string; name?: string; mime?: string; ts: number } | null>(null);

  /* viewport metrics — the dashboard is sized to fit exactly, never scrolls */
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useLayoutEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const compact = vp.w < COMPACT_BREAKPOINT;
  const stageHeight = Math.max(240, vp.h - TOPBAR_H - PAGE_PAD * 2);
  const rowHeight = Math.max(18, Math.floor((stageHeight - MARGIN * (ROWS - 1)) / ROWS));

  useEffect(() => {
    document.documentElement.style.setProperty('--ac', settings.accent ?? '#343d3f');
  }, [settings.accent]);

  useEffect(() => {
    setGoogleClientId(settings.googleClientId);
  }, [settings.googleClientId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && maximized) setMaximized(null);
      /* Alt+1..6 jumps straight to a widget — one keystroke, zero clicks */
      if (e.altKey && /^[1-6]$/.test(e.key)) {
        const id = WIDGET_ORDER[Number(e.key) - 1];
        if (id && settings.widgets[id] !== false) {
          e.preventDefault();
          if (compact) setFocusId(id);
          else setMaximized((cur) => (cur === id ? null : id));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized, compact, settings.widgets]);

  const visibleWidgets = useMemo(() => WIDGET_ORDER.filter((id) => settings.widgets[id] !== false), [settings.widgets]);

  useEffect(() => {
    if (visibleWidgets.length && !visibleWidgets.includes(focusId)) setFocusId(visibleWidgets[0]);
    if (maximized && !visibleWidgets.includes(maximized)) setMaximized(null);
  }, [visibleWidgets, focusId, maximized]);

  /* merge stored layout with defaults so newly enabled widgets always have a slot */
  const activeLayout = useMemo<LayoutItem[]>(() => {
    const defaults = defaultLayout();
    return visibleWidgets.map((id) => {
      const stored = layout.find((l) => l.i === id);
      const base = stored ?? defaults.find((d) => d.i === id)!;
      return { ...base, minW: WIDGET_INFO[id].minW, minH: WIDGET_INFO[id].minH };
    });
  }, [layout, visibleWidgets]);

  const { width, containerRef, mounted } = useContainerWidth();

  const focusWidget = useCallback(
    (w: WidgetId, payload?: Record<string, string>) => {
      setSettings((s) => (s.widgets[w] === false ? { ...s, widgets: { ...s.widgets, [w]: true } } : s));
      if (w === 'notes' && payload?.id) setNoteRequest({ id: payload.id, ts: Date.now() });
      if (w === 'calendar') setCalRequest({ eventId: payload?.eventId, date: payload?.date, ts: Date.now() });
      if (w === 'drive') setDriveRequest({ fileId: payload?.fileId, name: payload?.name, mime: payload?.mime, ts: Date.now() });
      if (compact) setFocusId(w);
    },
    [compact, setSettings],
  );

  const widgetElements: Record<WidgetId, ReactNode> = {
    bookmarks: <BookmarksWidget bookmarks={bookmarks} setBookmarks={setBookmarks} />,
    notes: <NotesWidget notes={notes} setNotes={setNotes} request={noteRequest} />,
    calculator: <CalculatorWidget />,
    weather: <WeatherWidget settings={settings} setSettings={setSettings} />,
    calendar: <CalendarWidget request={calRequest} />,
    drive: <DriveWidget request={driveRequest} />,
  };

  const renderWidget = (id: WidgetId, frame: { maximized: boolean; onToggle: (() => void) | null }) => (
    <WidgetFrameContext.Provider value={frame}>{widgetElements[id]}</WidgetFrameContext.Provider>
  );

  const emptyState = (
    <div className="acrylic mx-auto mt-10 max-w-sm rounded-2xl p-7 text-center">
      <div className="font-display text-[15px] font-extrabold">All widgets are hidden</div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text2)]">
        Turn widgets back on in settings to rebuild the dashboard.
      </p>
      <button className="btn btn-accent mt-4" onClick={() => setSettingsOpen(true)}>
        Open settings
      </button>
    </div>
  );

  return (
    <div className={`flex h-full flex-col overflow-hidden ${settings.locked ? 'locked' : ''}`}>
      <div className="grid-overlay" aria-hidden="true" />

      <TopBar
        onSettings={() => setSettingsOpen(true)}
        onPalette={() => setPaletteOpen(true)}
        locked={settings.locked}
        onToggleLock={() => setSettings((s) => ({ ...s, locked: !s.locked }))}
        widgets={visibleWidgets.map((id) => ({ id, label: WIDGET_INFO[id].label, icon: WIDGET_INFO[id].icon }))}
        activeId={compact ? focusId : maximized}
        onPick={(id) => {
          if (compact) setFocusId(id);
          else setMaximized((cur) => (cur === id ? null : id));
        }}
        compact={compact}
      />

      <main className="min-h-0 flex-1" style={{ padding: PAGE_PAD }}>
        {visibleWidgets.length === 0 ? (
          emptyState
        ) : compact ? (
          <div className="h-full" style={{ height: stageHeight }}>
            {renderWidget(focusId, { maximized: true, onToggle: null })}
          </div>
        ) : maximized ? (
          <div style={{ height: stageHeight }} className="fade-in">
            {renderWidget(maximized, { maximized: true, onToggle: () => setMaximized(null) })}
          </div>
        ) : (
          <div ref={containerRef} style={{ height: stageHeight }}>
            {mounted && (
              <GridLayout
                className="layout"
                width={width}
                layout={activeLayout}
                gridConfig={{ cols: COLS, rowHeight, margin: [MARGIN, MARGIN], containerPadding: [0, 0], maxRows: ROWS }}
                dragConfig={{ enabled: !settings.locked, handle: '.drag-handle', bounded: true }}
                resizeConfig={{ enabled: !settings.locked }}
                onLayoutChange={(next) => setLayout(next.map((it) => ({ ...it })))}
              >
                {visibleWidgets.map((id) => (
                  <div key={id} aria-label={`${WIDGET_INFO[id].label} widget`}>
                    {renderWidget(id, { maximized: false, onToggle: () => setMaximized(id) })}
                  </div>
                ))}
              </GridLayout>
            )}
          </div>
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        bookmarks={bookmarks}
        notes={notes}
        onOpenNote={(id) => focusWidget('notes', { id })}
        onFocusWidget={focusWidget}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />

      <Toasts />
    </div>
  );
}
