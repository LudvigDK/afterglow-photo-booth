export const DAY = 86_400_000;
export const MAX_PHOTO_BYTES = 4_000_000;
export const MAX_THUMB_BYTES = 150_000;
export const MAX_EVENT_PHOTOS = 1_000;
export const MAX_DAILY_UPLOADS = 2_000;

export const modes = ['latest', 'all', 'recent'] as const;
export const transitions = ['fade', 'slide', 'none'] as const;
export const fits = ['contain', 'cover'] as const;
export const defaultSettings = {
  countdown: 3,
  autoReturn: 0,
  mirror: true,
  retentionDays: 7,
  galleryVisible: true,
  mode: 'latest' as typeof modes[number],
  slideSeconds: 6,
  recentCount: 10,
  transition: 'fade' as typeof transitions[number],
  transitionMs: 500,
  background: '#141118',
  fit: 'contain' as typeof fits[number],
  showTitle: true,
  showTimestamp: false,
  showGalleryQr: true,
  showPlaceholder: true,
};

export type Settings = typeof defaultSettings;
export type EventInfo = { id: string; name: string; createdAt: number; settings: Settings };
export type EventSummary = Pick<EventInfo, 'id' | 'name' | 'createdAt'>;
export type EventAdmin = EventInfo & { count: number; bytes: number; storageUsed: number; storageLimit: number };
export type Photo = {
  id: string;
  eventId: string;
  createdAt: number;
  expiresAt: number;
  bytes: number;
  type: 'image/jpeg';
};
export type PhotoDetails = Photo & { eventName: string; galleryVisible: boolean };
export type GalleryPage = { event: EventInfo; photos: Photo[]; next: string | null };
export type LivePhoto = [id: string, createdAt: number, expiresAt: number];
export type LiveFeed = { event: EventInfo; photos: LivePhoto[] };

export const isId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
