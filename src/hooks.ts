import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';

export function usePolling<T>(path: string, interval: number, token = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let current: AbortController | null = null;
    let tag: string | undefined;
    let failures = 0;
    let requested = false;
    setData(null);
    setError(null);

    const poll = async () => {
      if (stopped || document.hidden || current) return;
      clearTimeout(timer);
      requested = false;
      current = new AbortController();
      try {
        const result = await api<T>(path, { token, tag, signal: current.signal });
        if (stopped) return;
        if (!requested) tag = result.tag;
        if (result.data) setData(result.data);
        setError(null);
        failures = 0;
      } catch (issue) {
        if (stopped) return;
        setError(issue instanceof Error ? issue : new Error('Connection interrupted.'));
        if (issue instanceof ApiError && [401, 403, 404].includes(issue.status)) {
          setData(null);
          tag = undefined;
        }
        failures++;
      } finally {
        current = null;
        if (!stopped) {
          setCheckedAt(Date.now());
          timer = window.setTimeout(poll, requested ? 0 : failures ? Math.min(60_000, interval * 2 ** Math.min(failures - 1, 5)) : interval);
        }
      }
    };
    refresh.current = () => { requested = true; tag = undefined; void poll(); };
    const wake = () => { if (!document.hidden) void poll(); };
    void poll();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      requested = false;
      current?.abort();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
    };
  }, [path, interval, token]);
  return { data, error, checkedAt, refresh: () => refresh.current() };
}

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
export function useFullscreen() {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [native, setNative] = useState(false);
  useEffect(() => {
    const doc = document as FullscreenDocument;
    const sync = () => setNative((doc.fullscreenElement ?? doc.webkitFullscreenElement) === root.current);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  const toggle = async () => {
    const element = root.current as FullscreenElement | null;
    const doc = document as FullscreenDocument;
    if (!element) return;
    if (expanded) { setExpanded(false); return; }
    if (native) {
      if (doc.exitFullscreen) await doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else setExpanded(true);
    } catch { setExpanded(true); }
  };
  return { root, expanded, fullscreen: native || expanded, toggle };
}

export function useExpiry(expiresAt?: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expiresAt || expiresAt <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, expiresAt - Date.now() + 20));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  return expiresAt !== undefined && expiresAt <= Math.max(now, Date.now());
}
