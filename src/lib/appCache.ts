import type { CalEvent, DriveFile } from './types';

export type WidgetId = 'bookmarks' | 'notes' | 'calculator' | 'weather' | 'calendar' | 'drive';

export interface WidgetRequest {
  widget: WidgetId;
  payload?: Record<string, string>;
}

/** Cross-widget cache so the universal search can query calendar + drive without extra round trips. */
export const appCache: { events: CalEvent[]; driveFiles: DriveFile[] } = {
  events: [],
  driveFiles: [],
};
