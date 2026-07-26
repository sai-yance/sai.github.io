import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Add20Regular,
  ArrowClockwise20Regular,
  CalendarAgenda20Regular,
  CalendarLtr20Regular,
  CalendarMonth20Regular,
  CalendarWorkWeek20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Delete20Regular,
  Location20Regular,
  PlugConnected20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import type { CalCalendar, CalEvent } from '../lib/types';
import { calApi, hasGoogleClientId } from '../lib/google';
import { appCache } from '../lib/appCache';
import { addDays, DAYS_SHORT, fmtTimeShort, isoDate, load, MONTHS, sameDay, startOfDay, toast, usePersistent } from '../lib/store';
import { EmptyState, Modal, Spinner, Toggle, WidgetShell } from './chrome';

type View = 'month' | 'week' | 'agenda';

interface EventRequest {
  eventId?: string;
  date?: string;
  ts: number;
}

const CAL_SHADES = ['#e7edee', '#b3c0c2', '#93a1a3', '#6f7d7f', '#546062'];

const evStart = (ev: CalEvent): Date =>
  ev.start.dateTime ? new Date(ev.start.dateTime) : new Date((ev.start.date ?? '') + 'T00:00:00');
const isAllDay = (ev: CalEvent) => !ev.start.dateTime;

interface FormState {
  title: string;
  calendarId: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

export function CalendarWidget({ request }: { request: EventRequest | null }) {
  const [signedIn, setSignedIn] = usePersistent('dash.cal.signedIn', false);
  const [connecting, setConnecting] = useState(false);
  const [calendars, setCalendars] = useState<CalCalendar[]>([]);
  const [selectedIds, setSelectedIds] = usePersistent<string[]>('dash.cal.selected', []);
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; event: CalEvent } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const lastRequest = useRef(0);

  const activeCalendars = useMemo(() => {
    if (selectedIds.length === 0) return calendars;
    return calendars.filter((c) => selectedIds.includes(c.id));
  }, [calendars, selectedIds]);

  /* palette-derived shades keep multiple calendars distinguishable without extra hues */
  const calColor = useCallback(
    (id: string) => {
      const idx = calendars.findIndex((c) => c.id === id);
      return CAL_SHADES[(idx < 0 ? 0 : idx) % CAL_SHADES.length];
    },
    [calendars],
  );

  const loadAll = useCallback(async () => {
    if (!hasGoogleClientId()) return;
    setLoading(true);
    setError(null);
    try {
      const cals = await calApi.calendars();
      setCalendars(cals);
      const sel = load<string[]>('dash.cal.selected', []);
      const usable = sel.length ? cals.filter((c) => sel.includes(c.id)) : cals.filter((c) => c.selected);
      const ids = usable.map((c) => c.id);

      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const timeMin = addDays(monthStart, -10).toISOString();
      const timeMax = addDays(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), 10).toISOString();

      const results = await Promise.allSettled(
        (ids.length ? ids : cals.map((c) => c.id)).map((id) => calApi.events(id, timeMin, timeMax)),
      );
      const all: CalEvent[] = [];
      results.forEach((r) => {
        if (r.status === 'fulfilled') all.push(...r.value);
      });
      all.sort((a, b) => evStart(a).getTime() - evStart(b).getTime());
      setEvents(all);
      appCache.events = all;
      setSignedIn(true);
    } catch (e) {
      setSignedIn(false);
      setError(e instanceof Error ? e.message : 'Could not reach Google Calendar');
    } finally {
      setLoading(false);
    }
  }, [cursor, setSignedIn]);

  useEffect(() => {
    if (signedIn && hasGoogleClientId()) loadAll();
  }, [signedIn, loadAll]);

  useEffect(() => {
    const id = setInterval(() => {
      if (hasGoogleClientId() && load('dash.cal.signedIn', false)) loadAll();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadAll]);

  useEffect(() => {
    if (request && request.ts !== lastRequest.current) {
      lastRequest.current = request.ts;
      if (request.date) {
        const d = new Date(request.date);
        if (!isNaN(d.getTime())) setCursor(d);
      }
      if (request.eventId) {
        setHighlight(request.eventId);
        setTimeout(() => setHighlight(null), 4000);
      }
    }
  }, [request]);

  const connect = async () => {
    if (!hasGoogleClientId()) {
      toast('Add your Google OAuth Client ID in Settings → Google first', 'error');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await loadAll();
      toast('Google Calendar connected', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setConnecting(false);
    }
  };

  /* ---------- month grid ---------- */

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = addDays(startOfDay(cursor), -cursor.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = activeCalendars.length ? events.filter((e) => activeCalendars.some((c) => c.id === e.calendarId)) : [];
    if (!q) return base;
    return base.filter(
      (e) =>
        e.summary.toLowerCase().includes(q) ||
        (e.location ?? '').toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q),
    );
  }, [events, activeCalendars, query]);

  const eventsOn = (day: Date) => visible.filter((e) => sameDay(evStart(e), day));

  const shift = (dir: -1 | 1) => {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else if (view === 'week') setCursor(addDays(cursor, dir * 7));
    else setCursor(addDays(cursor, dir * 30));
  };

  /* ---------- event form ---------- */

  const openCreate = (date?: Date, event?: CalEvent) => {
    if (event) {
      const s = evStart(event);
      const e = event.end.dateTime ? new Date(event.end.dateTime) : null;
      setForm({
        title: event.summary,
        calendarId: event.calendarId,
        date: isoDate(s),
        allDay: isAllDay(event),
        startTime: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
        endTime: e ? `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}` : '',
        location: event.location ?? '',
        description: event.description ?? '',
      });
      setModal({ mode: 'edit', event });
    } else {
      const d = date ?? new Date();
      setForm({
        title: '',
        calendarId: activeCalendars[0]?.id ?? calendars[0]?.id ?? '',
        date: isoDate(d),
        allDay: false,
        startTime: `${String(d.getHours() + 1).padStart(2, '0')}:00`,
        endTime: `${String(d.getHours() + 2).padStart(2, '0')}:00`,
        location: '',
        description: '',
      });
      setModal({ mode: 'create' });
    }
  };

  const buildBody = () => {
    if (!form) return null;
    const body: Record<string, unknown> = {
      summary: form.title.trim() || '(No title)',
      description: form.description || undefined,
      location: form.location || undefined,
    };
    if (form.allDay) {
      body.start = { date: form.date };
      const end = addDays(new Date(form.date + 'T12:00:00'), 1);
      body.end = { date: isoDate(end) };
    } else {
      body.start = { dateTime: new Date(`${form.date}T${form.startTime || '09:00'}`).toISOString() };
      body.end = { dateTime: new Date(`${form.date}T${form.endTime || form.startTime || '10:00'}`).toISOString() };
    }
    return body;
  };

  const saveEvent = async () => {
    if (!form || !modal) return;
    const body = buildBody();
    if (!body) return;
    setSaving(true);
    try {
      if (modal.mode === 'create') await calApi.create(form.calendarId, body);
      else await calApi.update(modal.event.calendarId, modal.event.id, body);
      toast(modal.mode === 'create' ? 'Event created' : 'Event updated', 'success');
      setModal(null);
      await loadAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save event', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!modal || modal.mode !== 'edit') return;
    setSaving(true);
    try {
      await calApi.remove(modal.event.calendarId, modal.event.id);
      toast('Event deleted');
      setModal(null);
      await loadAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete event', 'error');
    } finally {
      setSaving(false);
    }
  };

  const agendaGroups = useMemo(() => {
    const today = startOfDay(new Date());
    const upcoming = visible.filter((e) => evStart(e) >= today || sameDay(evStart(e), today));
    const map = new Map<string, CalEvent[]>();
    upcoming.forEach((e) => {
      const key = isoDate(evStart(e));
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    });
    return [...map.entries()].slice(0, 21);
  }, [visible]);

  const today = new Date();

  const eventChip = (e: CalEvent, compact = false) => (
    <button
      key={e.id}
      className="flex w-full items-center gap-1.5 truncate rounded-[6px] px-1.5 py-[3px] text-left text-[10.5px] font-semibold leading-tight transition-all"
      style={{
        background: `color-mix(in srgb, ${calColor(e.calendarId)} 16%, transparent)`,
        color: calColor(e.calendarId),
        outline: highlight === e.id ? `2px solid ${calColor(e.calendarId)}` : 'none',
      }}
      onClick={(ev) => {
        ev.stopPropagation();
        openCreate(undefined, e);
      }}
      title={`${e.summary}${e.location ? ` — ${e.location}` : ''}`}
    >
      {!isAllDay(e) && <span className="shrink-0 tabular-nums opacity-75">{fmtTimeShort(evStart(e))}</span>}
      <span className={compact ? 'truncate' : 'truncate'}>{e.summary}</span>
    </button>
  );

  return (
    <WidgetShell
      title="Calendar"
      icon={<CalendarLtr20Regular />}
      actions={
        <>
          {signedIn && (
            <span className="chip pointer-events-none hidden !cursor-default sm:inline-flex">
              {activeCalendars.length}/{calendars.length} calendars
            </span>
          )}
          <button className="btn-icon" title="Sync now" aria-label="Sync calendar" onClick={loadAll} disabled={loading || !signedIn}>
            {loading ? <Spinner size={15} /> : <ArrowClockwise20Regular />}
          </button>
          <button className="btn-icon" title="New event" aria-label="New event" onClick={() => openCreate()} disabled={!signedIn}>
            <Add20Regular />
          </button>
        </>
      }
    >
      {!signedIn ? (
        <EmptyState
          icon={<PlugConnected20Regular />}
          title="Connect Google Calendar"
          hint={
            hasGoogleClientId()
              ? 'Sign in with Google to see your calendars, create and edit events.'
              : 'Add your Google OAuth Client ID in Settings → Google, then connect.'
          }
          action={
            <button className="btn btn-accent" onClick={connect} disabled={connecting}>
              {connecting ? <Spinner size={14} /> : <PlugConnected20Regular />} {connecting ? 'Connecting…' : 'Connect Google'}
            </button>
          }
        />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
            <span className="font-display mr-1 text-[13.5px] font-extrabold">
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <button className="btn-icon !h-7 !w-7" onClick={() => shift(-1)} aria-label="Previous">
              <ChevronLeft20Regular fontSize={15} />
            </button>
            <button className="btn-icon !h-7 !w-7" onClick={() => shift(1)} aria-label="Next">
              <ChevronRight20Regular fontSize={15} />
            </button>
            <button className="chip !h-6" onClick={() => setCursor(new Date())}>
              Today
            </button>
            <div className="seg !ml-1 !p-[2px]">
              {(
                [
                  ['month', <CalendarMonth20Regular key="m" fontSize={13} />, 'Month view'],
                  ['week', <CalendarWorkWeek20Regular key="w" fontSize={13} />, 'Week view'],
                  ['agenda', <CalendarAgenda20Regular key="a" fontSize={13} />, 'Agenda view'],
                ] as [View, React.ReactNode, string][]
              ).map(([v, icon, label]) => (
                <button key={v} className={`seg-item !h-6 !w-7 !px-0 ${view === v ? 'on' : ''}`} title={label} aria-label={label} onClick={() => setView(v)}>
                  {icon}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-[130px]">
              <Search20Regular className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text2)]" fontSize={13} />
              <input
                className="input !h-7 !pl-7 !text-[11.5px]"
                placeholder="Search events…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search events"
              />
            </div>
          </div>

          {calendars.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {calendars.map((c) => {
                const on = activeCalendars.some((a) => a.id === c.id);
                return (
                  <button
                    key={c.id}
                    className="chip !h-6"
                    style={on ? { borderColor: c.backgroundColor, color: c.backgroundColor, background: `color-mix(in srgb, ${c.backgroundColor} 12%, transparent)` } : undefined}
                    onClick={() => {
                      const current = selectedIds.length ? selectedIds : calendars.map((x) => x.id);
                      const next = current.includes(c.id) ? current.filter((i) => i !== c.id) : [...current, c.id];
                      setSelectedIds(next.length === calendars.length ? [] : next);
                    }}
                    title={`${c.summary}${c.primary ? ' (primary)' : ''}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: calColor(c.id), opacity: on ? 1 : 0.35 }} />
                    {c.summary}
                  </button>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-3 pb-3">
            {error && (
              <div className="mb-2 rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }}>
                {error}
              </div>
            )}

            {view === 'month' && (
              <div>
                <div className="grid grid-cols-7 gap-1 pb-1">
                  {DAYS_SHORT.map((d) => (
                    <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-[var(--text2)]">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {monthCells.map((day) => {
                    const inMonth = day.getMonth() === cursor.getMonth();
                    const isToday = sameDay(day, today);
                    const dayEvents = eventsOn(day);
                    return (
                      <div
                        key={day.toISOString()}
                        className="min-h-[64px] cursor-pointer rounded-lg border border-transparent p-1 transition-colors hover:border-[var(--stroke-soft)] hover:bg-[var(--card-hover)]"
                        style={isToday ? { background: 'var(--ac-soft)', borderColor: 'color-mix(in srgb, var(--ac) 30%, transparent)' } : undefined}
                        onClick={() => openCreate(day)}
                        title="Click to add an event"
                      >
                        <div className="mb-0.5 flex items-center justify-between px-0.5">
                          <span
                            className="grid h-[18px] w-[18px] place-items-center rounded-full text-[10.5px] font-bold tabular-nums"
                            style={{
                              color: isToday ? '#fff' : inMonth ? 'var(--text)' : 'var(--text2)',
                              background: isToday ? 'var(--ac)' : 'transparent',
                              opacity: inMonth || isToday ? 1 : 0.55,
                            }}
                          >
                            {day.getDate()}
                          </span>
                          {dayEvents.length > 2 && <span className="text-[9px] font-bold text-[var(--text2)]">+{dayEvents.length - 2}</span>}
                        </div>
                        <div className="flex flex-col gap-[2.5px]">
                          {dayEvents.slice(0, 2).map((e) => eventChip(e, true))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {view === 'week' && (
              <div className="grid grid-cols-7 gap-1.5">
                {weekDays.map((day) => {
                  const dayEvents = eventsOn(day);
                  const isToday = sameDay(day, today);
                  return (
                    <div key={day.toISOString()} className="flex min-h-[180px] flex-col rounded-lg border border-[var(--stroke-soft)] bg-[var(--card-hover)]">
                      <button
                        className="flex flex-col items-center rounded-t-lg px-1 py-1.5 hover:bg-[var(--card-solid)]"
                        style={isToday ? { background: 'var(--ac-soft)' } : undefined}
                        onClick={() => openCreate(day)}
                        title="Add event on this day"
                      >
                        <span className="text-[9.5px] font-bold uppercase text-[var(--text2)]">{DAYS_SHORT[day.getDay()]}</span>
                        <span className="font-display text-[15px] font-extrabold" style={isToday ? { color: 'var(--ac-text)' } : undefined}>
                          {day.getDate()}
                        </span>
                      </button>
                      <div className="flex flex-1 flex-col gap-1 p-1">
                        {dayEvents.length === 0 && <span className="px-1 pt-2 text-center text-[9.5px] text-[var(--text2)]">—</span>}
                        {dayEvents.map((e) => eventChip(e))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'agenda' && (
              <div className="flex flex-col gap-2.5">
                {agendaGroups.length === 0 && (
                  <div className="py-8 text-center text-[12.5px] text-[var(--text2)]">No upcoming events in this window.</div>
                )}
                {agendaGroups.map(([date, evs]) => {
                  const d = new Date(date + 'T12:00:00');
                  return (
                    <div key={date}>
                      <div className="mb-1 flex items-baseline gap-2">
                        <span className="font-display text-[13px] font-extrabold">
                          {sameDay(d, today) ? 'Today' : d.toLocaleDateString([], { weekday: 'long' })}
                        </span>
                        <span className="text-[11px] font-semibold text-[var(--text2)]">
                          {MONTHS[d.getMonth()]} {d.getDate()}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {evs.map((e) => (
                          <button
                            key={e.id}
                            className="flex items-center gap-2.5 rounded-lg border border-[var(--stroke-soft)] bg-[var(--card-solid)] px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--card-hover)]"
                            style={highlight === e.id ? { outline: `2px solid ${calColor(e.calendarId)}` } : undefined}
                            onClick={() => openCreate(undefined, e)}
                          >
                            <span className="h-7 w-[3.5px] shrink-0 rounded-full" style={{ background: calColor(e.calendarId) }} />
                            <span className="w-[86px] shrink-0 text-[11px] font-bold tabular-nums text-[var(--text2)]">
                              {isAllDay(e) ? 'All day' : `${fmtTimeShort(evStart(e))}–${e.end.dateTime ? fmtTimeShort(new Date(e.end.dateTime)) : ''}`}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-bold">{e.summary}</span>
                              {e.location && (
                                <span className="flex items-center gap-1 truncate text-[10.5px] text-[var(--text2)]">
                                  <Location20Regular fontSize={11} /> {e.location}
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={!!modal && !!form}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit event' : 'New event'}
        footer={
          <>
            {modal?.mode === 'edit' && (
              <button className="btn btn-danger mr-auto" onClick={deleteEvent} disabled={saving}>
                <Delete20Regular /> Delete
              </button>
            )}
            <button className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn btn-accent" onClick={saveEvent} disabled={saving || !form?.calendarId}>
              {saving ? <Spinner size={14} /> : null} {modal?.mode === 'edit' ? 'Save changes' : 'Create event'}
            </button>
          </>
        }
      >
        {form && (
          <div className="flex flex-col gap-3 pt-1">
            <input
              className="input font-display !text-[15px] !font-bold"
              placeholder="Event title"
              value={form.title}
              autoFocus
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[var(--text2)]">Date</span>
                <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[var(--text2)]">Calendar</span>
                <select className="input" value={form.calendarId} onChange={(e) => setForm({ ...form, calendarId: e.target.value })}>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-4">
              <Toggle checked={form.allDay} onChange={(v) => setForm({ ...form, allDay: v })} label="All day" />
              {!form.allDay && (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text2)]">
                  <input type="time" className="input !h-8 !w-[98px]" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} aria-label="Start time" />
                  –
                  <input type="time" className="input !h-8 !w-[98px]" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} aria-label="End time" />
                </div>
              )}
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-[var(--text2)]">Location</span>
              <input className="input" placeholder="Optional" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-[var(--text2)]">Description</span>
              <textarea className="input" rows={3} placeholder="Optional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>
    </WidgetShell>
  );
}
