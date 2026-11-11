import { defaultSettings, fits, modes, transitions, type Settings } from '../shared/model';
import { HttpError } from './http';

export function eventName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new HttpError(400, 'Use an event name from 1 to 80 characters.');
  }
  return value.trim();
}

export function eventSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Invalid event settings.');
  }
  const settings = { ...defaultSettings, ...input } as Settings;
  const integer = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  if (!integer(settings.countdown, 0, 15) || !integer(settings.autoReturn, 0, 180)
      || !integer(settings.retentionDays, 1, 30) || !integer(settings.slideSeconds, 2, 60)
      || !integer(settings.recentCount, 1, 1000) || !integer(settings.transitionMs, 0, 1500)
      || !modes.includes(settings.mode) || !transitions.includes(settings.transition)
      || !fits.includes(settings.fit) || typeof settings.background !== 'string'
      || !/^#[a-f0-9]{6}$/i.test(settings.background)) {
    throw new HttpError(400, 'One or more settings are outside the supported range.');
  }
  const flags = ['mirror', 'galleryVisible', 'showTitle', 'showTimestamp', 'showGalleryQr', 'showPlaceholder'] as const;
  if (flags.some((key) => typeof settings[key] !== 'boolean')) {
    throw new HttpError(400, 'Invalid display toggle.');
  }
  // Persist only the fields the application understands.
  return Object.fromEntries(Object.keys(defaultSettings).map((key) => [key, settings[key as keyof Settings]])) as Settings;
}
