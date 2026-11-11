import { useEffect, useRef, useState } from 'react';
import { Camera, WifiOff } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { LiveFeed, LivePhoto } from '../shared/model';
import { appUrl, imageUrl, readToken } from './api';
import { useExpiry, useFullscreen, usePolling } from './hooks';
import { FullscreenButton, Loading, Notice, Qr, timeLabel } from './ui';

export default function LiveRoute() {
  const { eventId = '' } = useParams();
  return <Live key={eventId} id={eventId} />;
}

function Live({ id }: { id: string }) {
  const token = readToken('/live/' + id);
  const poll = usePolling<LiveFeed>(`/events/${id}/live`, 4_000, token);
  const full = useFullscreen();
  const [selected, setSelected] = useState('');
  const [frame, setFrame] = useState<LivePhoto>();
  const [previous, setPrevious] = useState<LivePhoto>();
  const [controls, setControls] = useState(true);
  const [imageFailure, setImageFailure] = useState(false);
  const [retry, setRetry] = useState(0);
  const wakeTimer = useRef<number | undefined>(undefined);
  const settings = poll.data?.event.settings;
  const photos = poll.data?.photos;
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const mode = settings?.mode;
  const duration = settings?.slideSeconds;
  const wanted = mode === 'latest' ? photos?.[0] : photos?.find(([photoId]) => photoId === selected) ?? photos?.[0];
  const expired = useExpiry(frame?.[2]);

  useEffect(() => {
    if (!duration || mode === 'latest') return;
    const timer = window.setInterval(() => {
      const available = photosRef.current?.filter((photo) => photo[2] > Date.now());
      if (document.hidden || !available?.length) return;
      setSelected((current) => {
        const index = available.findIndex(([photoId]) => photoId === current);
        return available[index < 0 ? (available.length > 1 ? 1 : 0) : (index + 1) % available.length][0];
      });
    }, duration * 1000);
    return () => clearInterval(timer);
  }, [mode, duration]);

  useEffect(() => {
    if (!wanted) {
      setFrame(undefined);
      setPrevious(undefined);
      setImageFailure(false);
      return;
    }
    if (frameRef.current?.[0] === wanted[0]) { setImageFailure(false); return; }
    const img = new Image();
    img.onload = () => {
      setImageFailure(false);
      setPrevious(frameRef.current);
      setFrame(wanted);
    };
    img.onerror = () => setImageFailure(true);
    img.src = imageUrl(wanted[0]);
    return () => { img.onload = null; img.onerror = null; };
  }, [wanted, retry]);

  useEffect(() => {
    if (!imageFailure) return;
    const refresh = () => setRetry((n) => n + 1);
    const timer = window.setInterval(refresh, 8_000);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); };
  }, [imageFailure]);

  const transitionMs = settings?.transition === 'none' ? 0 : settings?.transitionMs ?? 0;
  useEffect(() => {
    if (!previous) return;
    const timer = window.setTimeout(() => setPrevious(undefined), transitionMs);
    return () => clearTimeout(timer);
  }, [frame, previous, transitionMs]);

  const wakeControls = () => {
    setControls(true);
    clearTimeout(wakeTimer.current);
    wakeTimer.current = window.setTimeout(() => setControls(false), 3500);
  };
  const showingPhoto = Boolean(frame && !expired && photos?.length);
  useEffect(() => {
    if (!showingPhoto) return;
    wakeControls();
    return () => clearTimeout(wakeTimer.current);
  }, [showingPhoto]);

  const chrome = !showingPhoto || controls;
  return <div className={`live ${full.expanded ? 'expanded' : ''} ${chrome ? '' : 'hide-cursor'}`} ref={full.root}
    onPointerMove={wakeControls} onPointerDown={wakeControls} onFocus={wakeControls}
    style={{ background: settings?.background }}>
    {showingPhoto && frame && <div className="live-images" data-photo-id={frame[0]}>
      {previous && previous[2] > Date.now() && <img className="live-previous" src={imageUrl(previous[0])} alt="" style={{ objectFit: settings?.fit }} />}
      <img key={frame[0]} className={`live-frame ${previous && transitionMs ? 'enter-' + settings?.transition : ''}`}
        src={imageUrl(frame[0])} alt="Event photo on the live display"
        style={{ objectFit: settings?.fit, animationDuration: `${transitionMs}ms` }} />
    </div>}
    {!showingPhoto && !poll.error && (!poll.data || photos?.length ? <Loading>Loading live display…</Loading> :
      settings?.showPlaceholder && <div className="live-placeholder"><Camera size={49} /><h1>The photos are on their way.</h1><p>Take a photo at the booth to see it here.</p></div>)}
    {poll.error && !poll.data && <div className="live-placeholder"><Notice retry={poll.refresh}>{poll.error.message}</Notice></div>}
    <div className={`live-controls ${chrome ? 'visible' : ''}`}><FullscreenButton active={full.fullscreen} onClick={full.toggle} /></div>
    {settings && (settings.showTitle || (frame && !expired && settings.showTimestamp)) && <div className="live-caption">
      {settings.showTitle && <h1>{poll.data?.event.name}</h1>}
      {frame && !expired && settings.showTimestamp && <time dateTime={new Date(frame[1]).toISOString()}>{timeLabel(frame[1])}</time>}
    </div>}
    {settings?.showGalleryQr && settings.galleryVisible && <div className="live-qr"><Qr url={appUrl('/gallery/' + id)} label="Open event gallery" size={116} /><span>Event gallery</span></div>}
    {((poll.error && poll.data) || imageFailure) && <div className="live-reconnecting" role="status"><WifiOff size={17} /> Reconnecting…</div>}
  </div>;
}
