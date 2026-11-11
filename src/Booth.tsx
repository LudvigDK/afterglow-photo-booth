import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Images, RotateCcw, ScanLine, SwitchCamera } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { EventInfo, Photo } from '../shared/model';
import { api, ApiError, appUrl, messageOf, readToken } from './api';
import { captureFrame, useCamera } from './camera';
import { clearDraft, getDraft, saveDraft, type Draft } from './drafts';
import { useFullscreen, usePolling } from './hooks';
import { Brand, FullscreenButton, Loading, Modal, Notice, Qr } from './ui';

export default function BoothRoute() {
  const { eventId = '' } = useParams();
  return <Booth key={eventId} id={eventId} />;
}

function Booth({ id }: { id: string }) {
  const token = readToken('/booth/' + id);
  const state = usePolling<EventInfo>('/events/' + id, 15_000);
  const full = useFullscreen();
  const [enabled, setEnabled] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [device, setDevice] = useState('');
  const [restart, setRestart] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>();
  const [preview, setPreview] = useState('');
  const [restoring, setRestoring] = useState(Boolean(token));
  const persisted = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [photo, setPhoto] = useState<Photo>();
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const captureBusy = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const countTimer = useRef<number | undefined>(undefined);
  const active = useRef(true);
  const camera = useCamera(enabled && Boolean(token) && Boolean(state.data) && !draft, facing, device, restart);

  useEffect(() => {
    active.current = true;
    if (token) void getDraft(id).then((saved) => {
      if (active.current && saved) {
        persisted.current = true;
        setDraft(saved);
        setError('Your previous capture is ready to upload.');
      }
    }).catch(() => {}).finally(() => { if (active.current) setRestoring(false); });
    const visibility = () => {
      if (!document.hidden) return;
      clearInterval(countTimer.current);
      countTimer.current = undefined;
      setCountdown(null);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      clearInterval(countTimer.current);
      uploadController.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [id, token]);

  useEffect(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.original);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  useEffect(() => {
    if (!draft || photo) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [draft, photo]);

  const autoReturn = state.data?.settings.autoReturn ?? 0;
  useEffect(() => {
    if (!photo || !autoReturn) return;
    const timer = window.setTimeout(() => {
      setPhoto(undefined);
      setDraft(undefined);
      setError('');
      setEnabled(true);
    }, autoReturn * 1000);
    return () => clearTimeout(timer);
  }, [photo, autoReturn]);

  async function send(d: Draft) {
    if (uploadController.current) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    setError('');
    try {
      const payload = new Blob([d.original, d.thumb], { type: 'application/octet-stream' });
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await api<Photo>(`/events/${id}/photos`, {
            method: 'POST', token, signal: controller.signal, timeout: 45_000,
            headers: { 'Content-Type': payload.type, 'X-Photo-Bytes': String(d.original.size), 'X-Capture-Id': d.requestId },
            body: payload,
          });
          if (!result.data) throw new Error('The upload could not be confirmed.');
          await clearDraft(id, d.requestId).catch(() => {});
          if (active.current) setPhoto(result.data);
          break;
        } catch (issue) {
          const retryable = issue instanceof ApiError && (issue.status === 0 || issue.status === 409 || issue.status >= 500 && issue.status !== 507);
          if (attempt >= 2 || controller.signal.aborted || !retryable) throw issue;
          await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(issue.retryAfter, 2 ** attempt) * 1000));
          if (controller.signal.aborted) return;
        }
      }
    } catch (issue) {
      if (active.current && !controller.signal.aborted) setError(messageOf(issue));
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      if (active.current) setUploading(false);
    }
  }

  async function take() {
    if (!camera.video.current || captureBusy.current || document.hidden) return;
    captureBusy.current = true;
    setError('');
    try {
      const shot = await captureFrame(camera.video.current);
      persisted.current = await saveDraft(id, shot).then(() => true, () => false);
      if (!active.current) return;
      setDraft(shot);
      void send(shot);
    } catch (issue) {
      if (active.current) setError(messageOf(issue));
    } finally {
      captureBusy.current = false;
    }
  }

  function startCountdown() {
    if (countdown !== null || countTimer.current !== undefined || captureBusy.current || !camera.ready || draft) return;
    const seconds = state.data?.settings.countdown ?? 3;
    if (!seconds) { void take(); return; }
    setCountdown(seconds);
    const ends = performance.now() + seconds * 1000;
    countTimer.current = window.setInterval(() => {
      const remaining = Math.ceil((ends - performance.now()) / 1000);
      if (remaining > 0) { setCountdown(remaining); return; }
      clearInterval(countTimer.current);
      countTimer.current = undefined;
      setCountdown(null);
      void take();
    }, 80);
  }

  const event = state.data;
  return <div className={`kiosk ${full.expanded ? 'expanded' : ''}`} ref={full.root}>
    <header className="kiosk-header"><Brand /><span className="kiosk-name">{event?.name}</span>
      <div className="header-actions">{event?.settings.galleryVisible && <Link className="icon-button" to={`/gallery/${id}`} title="Event gallery" aria-label="Event gallery"><Images size={20} /></Link>}
        <FullscreenButton active={full.fullscreen} onClick={full.toggle} /></div>
    </header>
    {!token ? <main className="kiosk-message"><ScanLine size={40} /><h1>Connect this booth</h1><p>Open the booth link from your event dashboard on this device.</p><Link className="button button-primary" to="/admin">Event dashboard</Link></main>
      : !event && !draft ? state.error ? <main className="kiosk-message"><Notice retry={state.refresh}>{state.error.message}</Notice></main> : <Loading>Connecting to the event…</Loading>
      : <main className="booth-main">
        <section className="camera-view" hidden={Boolean(draft)} aria-label="Camera view">
          <video ref={camera.video} playsInline muted autoPlay className={camera.front && event?.settings.mirror ? 'mirror' : ''}
            onPlaying={() => camera.setReady(true)} onEmptied={() => camera.setReady(false)} />
          {!enabled && !restoring && <div className="camera-message"><Camera size={42} /><h1>Ready for your close-up?</h1><button className="button button-primary" onClick={() => setEnabled(true)}>Enable camera</button></div>}
          {enabled && !camera.ready && !camera.error && <div className="camera-message"><Loading>Starting the camera…</Loading></div>}
          {camera.error && enabled && <div className="camera-message"><CameraOff size={34} /><p>{camera.error}</p><button className="button button-secondary" onClick={() => setRestart((n) => n + 1)}>Restart camera</button></div>}
          {countdown !== null && <div className="countdown" aria-live="assertive"><span key={countdown}>{countdown}</span></div>}
        </section>
        {!draft && <div className="booth-controls">
          <div className="camera-options">
            <button className="icon-button" aria-label="Switch camera" title="Switch camera" disabled={!enabled || countdown !== null} onClick={() => {
              setDevice(''); setFacing((side) => side === 'user' ? 'environment' : 'user');
            }}><SwitchCamera size={22} /></button>
            {camera.devices.length > 1 && <select aria-label="Camera" value={device} disabled={countdown !== null} onChange={(e) => setDevice(e.target.value)}>
              <option value="">Automatic camera</option>{camera.devices.map((entry, index) => <option key={entry.deviceId} value={entry.deviceId}>{entry.label || `Camera ${index + 1}`}</option>)}
            </select>}
          </div>
          <button className="shutter" disabled={!camera.ready || countdown !== null || restoring} onClick={startCountdown}><Camera size={26} /> Take photo</button>
          {error && <Notice>{error}</Notice>}
        </div>}
        {draft && <section className="booth-result">
          <div className="result-image">{preview && <img src={preview} alt="Your captured photo" />}</div>
          <div className="result-panel">
            {photo ? <><span className="section-icon"><ScanLine size={23} /></span><h1>Scan to save</h1><p>Open your phone’s camera and point it at the QR code.</p>
              <Qr url={appUrl('/photo/' + photo.id)} label="Download your photo" />
              <a className="text-link" href={appUrl('/photo/' + photo.id)} target="_blank" rel="noopener noreferrer">Open photo link</a>
              <button className="button button-primary" onClick={() => {
                setPhoto(undefined); setDraft(undefined); setError(''); setEnabled(true);
              }}><Camera size={21} /> Take another photo</button></>
              : <><h1>Your photo</h1>{uploading ? <Loading>Uploading your photo…</Loading> : <>
                {error && <Notice>{error}</Notice>}
                <button className="button button-primary" onClick={() => void send(draft)}><RotateCcw size={20} /> Retry upload</button>
                <button className="button button-quiet" onClick={() => setDiscard(true)}>Discard photo</button>
              </>}</>}
          </div>
        </section>}
      </main>}
    {discard && <Modal title="Discard this capture?" onClose={() => setDiscard(false)}>
      <p>This capture will be removed from this device.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setDiscard(false)}>Keep photo</button>
        <button className="button button-danger" onClick={async () => {
          try {
            if (draft && persisted.current) await clearDraft(id, draft.requestId);
            setDiscard(false); setDraft(undefined); setError(''); setEnabled(true);
          } catch (issue) { setDiscard(false); setError(messageOf(issue)); }
        }}>Discard photo</button></div>
    </Modal>}
  </div>;
}
