/* Google Identity Services + Drive v3 + Calendar v3 wrappers. */

import type { CalCalendar, CalEvent, DriveFile } from './types';

declare global {
  interface Window {
    google?: any;
  }
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

let clientId = '';

export function setGoogleClientId(id: string) {
  clientId = id.trim();
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-gis="1"]') as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.oauth2) resolve();
      else {
        existing.addEventListener('load', () => resolve());
        setTimeout(() => reject(new Error('Google Identity Services timed out')), 10000);
      }
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.setAttribute('data-gis', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}

interface TokenInfo {
  token: string;
  expiry: number;
  scopes: string;
}

let cached: TokenInfo | null = null;

export async function getGoogleToken(scopes: string[]): Promise<string> {
  if (!clientId) throw new Error('Add your Google OAuth Client ID in Settings → Google first');
  const scopeStr = scopes.join(' ');
  if (cached && cached.scopes === scopeStr && Date.now() < cached.expiry - 60_000) {
    return cached.token;
  }
  await loadGis();
  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: scopeStr,
        callback: (resp: any) => {
          if (resp?.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          cached = {
            token: resp.access_token,
            expiry: Date.now() + (resp.expires_in ?? 3500) * 1000,
            scopes: scopeStr,
          };
          resolve(resp.access_token);
        },
      });
      client.requestAccessToken({ prompt: cached ? '' : 'consent' });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Google sign-in failed'));
    }
  });
}

export function hasGoogleClientId(): boolean {
  return !!clientId;
}

export function hasGoogleSession(): boolean {
  return !!cached && Date.now() < cached.expiry;
}

export function signOutGoogle() {
  const token = cached?.token;
  cached = null;
  if (token) {
    try {
      window.google?.accounts?.oauth2?.revoke?.(token, () => undefined);
    } catch {
      /* ignore */
    }
  }
}

async function api(path: string, scopes: string[], init: RequestInit = {}): Promise<any> {
  const token = await getGoogleToken(scopes);
  const url = path.startsWith('http') ? path : `https://www.googleapis.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Google API error (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg = j.error.message;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---------------- Drive ---------------- */

const DRIVE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,parents,starred';

function escQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export const driveApi = {
  async listChildren(folderId: string | null): Promise<DriveFile[]> {
    const parent = folderId ?? 'root';
    const q = encodeURIComponent(`trashed=false and '${escQ(parent)}' in parents`);
    const j = await api(
      `/drive/v3/files?q=${q}&orderBy=folder,name&pageSize=300&fields=files(${DRIVE_FIELDS})`,
      [DRIVE_SCOPE],
    );
    return j?.files ?? [];
  },

  async searchFiles(query: string): Promise<DriveFile[]> {
    const q = encodeURIComponent(`trashed=false and name contains '${escQ(query)}'`);
    const j = await api(
      `/drive/v3/files?q=${q}&orderBy=folder,name&pageSize=100&fields=files(${DRIVE_FIELDS})`,
      [DRIVE_SCOPE],
    );
    return j?.files ?? [];
  },

  async recentFiles(): Promise<DriveFile[]> {
    const q = encodeURIComponent('trashed=false');
    const j = await api(
      `/drive/v3/files?q=${q}&orderBy=modifiedByMeTime desc&pageSize=30&fields=files(${DRIVE_FIELDS})`,
      [DRIVE_SCOPE],
    );
    return j?.files ?? [];
  },

  async about(): Promise<{ usage: number; limit: number; email?: string }> {
    const j = await api('/drive/v3/about?fields=storageQuota,user', [DRIVE_SCOPE]);
    return {
      usage: Number(j?.storageQuota?.usage ?? 0),
      limit: Number(j?.storageQuota?.limit ?? 0),
      email: j?.user?.emailAddress,
    };
  },

  async rename(id: string, name: string): Promise<DriveFile> {
    return api(`/drive/v3/files/${encodeURIComponent(id)}?fields=${DRIVE_FIELDS}`, [DRIVE_SCOPE], {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  async remove(id: string): Promise<void> {
    await api(`/drive/v3/files/${encodeURIComponent(id)}`, [DRIVE_SCOPE], { method: 'DELETE' });
  },

  async createFolder(name: string, parentId: string | null): Promise<DriveFile> {
    const meta: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) meta.parents = [parentId];
    return api(`/drive/v3/files?fields=${DRIVE_FIELDS}`, [DRIVE_SCOPE], {
      method: 'POST',
      body: JSON.stringify(meta),
    });
  },

  async blob(id: string): Promise<Blob> {
    const token = await getGoogleToken([DRIVE_SCOPE]);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return res.blob();
  },

  async download(id: string, name: string): Promise<void> {
    const blob = await driveApi.blob(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  },

  upload(file: File, parentId: string | null): Promise<DriveFile> {
    return getGoogleToken([DRIVE_SCOPE]).then(
      (token) =>
        new Promise<DriveFile>((resolve, reject) => {
          const meta = {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            ...(parentId ? { parents: [parentId] } : {}),
          };
          const boundary = 'saios' + Math.random().toString(16).slice(2);
          const head =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`;
          const tail = `\r\n--${boundary}--`;
          const body = new Blob([head, file, tail], { type: `multipart/related; boundary=${boundary}` });
          const xhr = new XMLHttpRequest();
          xhr.open(
            'POST',
            `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${DRIVE_FIELDS}`,
          );
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error('Unexpected upload response'));
              }
            } else {
              let msg = `Upload failed (${xhr.status})`;
              try {
                msg = JSON.parse(xhr.responseText)?.error?.message ?? msg;
              } catch {
                /* keep default */
              }
              reject(new Error(msg));
            }
          };
          xhr.onerror = () => reject(new Error('Upload failed: network error'));
          xhr.send(body);
        }),
    );
  },
};

/* ---------------- Calendar ---------------- */

export const calApi = {
  async calendars(): Promise<CalCalendar[]> {
    const j = await api('/calendar/v3/users/me/calendarList?maxResults=100', [CALENDAR_SCOPE]);
    return (j?.items ?? []).map((it: any) => ({
      id: it.id,
      summary: it.summary ?? it.id,
      backgroundColor: it.backgroundColor ?? '#0f6cbd',
      primary: !!it.primary,
      selected: it.selected !== false,
    }));
  },

  async events(calendarId: string, timeMin: string, timeMax: string, query?: string): Promise<CalEvent[]> {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (query) params.set('q', query);
    const j = await api(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      [CALENDAR_SCOPE],
    );
    return (j?.items ?? [])
      .filter((it: any) => it.status !== 'cancelled')
      .map((it: any) => ({
        id: it.id,
        calendarId,
        summary: it.summary ?? '(No title)',
        description: it.description,
        location: it.location,
        start: it.start,
        end: it.end,
        htmlLink: it.htmlLink,
        colorId: it.colorId,
      }));
  },

  async create(calendarId: string, body: Record<string, unknown>): Promise<CalEvent> {
    const j = await api(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, [CALENDAR_SCOPE], {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { ...j, calendarId };
  },

  async update(calendarId: string, eventId: string, body: Record<string, unknown>): Promise<CalEvent> {
    const j = await api(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      [CALENDAR_SCOPE],
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    return { ...j, calendarId };
  },

  async remove(calendarId: string, eventId: string): Promise<void> {
    await api(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      [CALENDAR_SCOPE],
      { method: 'DELETE' },
    );
  },
};
