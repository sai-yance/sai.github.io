export interface Bookmark {
  id: string;
  title: string;
  url: string;
  pinned?: boolean;
  addedAt: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  color: string;
  tags: string[];
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  accent: string;
  locked: boolean;
  openWeatherKey: string;
  googleClientId: string;
  weatherLocation: string;
  widgets: Record<string, boolean>;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  starred?: boolean;
}

export interface DriveQuota {
  usage: number;
  limit: number;
  email?: string;
}

export interface CalTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface CalEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: CalTime;
  end: CalTime;
  htmlLink?: string;
  colorId?: string;
}

export interface CalCalendar {
  id: string;
  summary: string;
  backgroundColor: string;
  primary?: boolean;
  selected: boolean;
}

export interface FavoriteFolder {
  id: string;
  name: string;
}

export interface ExportBundle {
  app: 'dashboard';
  version: number;
  exportedAt: number;
  bookmarks: Bookmark[];
  notes: Note[];
  settings: AppSettings;
  layout: unknown;
  favoriteFolders: FavoriteFolder[];
  images: { id: string; dataUrl: string }[];
}
