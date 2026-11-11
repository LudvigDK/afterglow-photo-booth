import { useEffect, useRef, useState } from 'react';
import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES } from '../shared/model';

export function useCamera(enabled: boolean, facing: 'user' | 'environment', device: string, restart: number) {
  const video = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [front, setFront] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) { setReady(false); return; }
    const media = navigator.mediaDevices;
    if (!window.isSecureContext || !media?.getUserMedia) {
      setError('Camera access requires HTTPS and a browser with camera support.');
      return;
    }
    let stream: MediaStream | undefined;
    let active = true;
    let generation = 0;
    const stop = () => {
      generation++;
      stream?.getTracks().forEach((track) => track.stop());
      stream = undefined;
      if (video.current) video.current.srcObject = null;
    };
    const list = () => void media.enumerateDevices()
      .then((all) => { if (active) setDevices(all.filter(({ kind }) => kind === 'videoinput')); }).catch(() => {});
    const start = async () => {
      stop();
      const current = generation;
      setReady(false);
      setError('');
      if (document.hidden) return;
      try {
        const constraints = device ? { deviceId: { exact: device } } : { facingMode: { ideal: facing } };
        const next = await media.getUserMedia({
          audio: false, video: { ...constraints, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!active || generation !== current || !video.current) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        const track = stream.getVideoTracks()[0];
        const actual = track.getSettings().facingMode;
        setFront(actual ? actual === 'user' : /front|user|facetime/i.test(track.label) || (!device && facing === 'user' && !/back|rear/i.test(track.label)));
        track.addEventListener('ended', () => {
          if (active && generation === current) {
            setReady(false);
            setError('The camera disconnected. Restart it to continue.');
          }
        });
        video.current.srcObject = stream;
        await video.current.play();
        if (active && generation === current) list();
      } catch (issue) {
        if (!active || generation !== current) return;
        stop();
        const name = issue instanceof Error ? issue.name : '';
        setError(name === 'NotAllowedError' ? 'Allow camera access in your browser settings, then try again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'This camera is unavailable. Choose a different camera.'
          : 'The camera could not start. Close other apps using it and try again.');
      }
    };
    const wake = () => {
      if (document.hidden) { stop(); setReady(false); }
      else void start();
    };
    void start();
    media.addEventListener('devicechange', list);
    document.addEventListener('visibilitychange', wake);
    return () => {
      active = false;
      stop();
      media.removeEventListener('devicechange', list);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [enabled, facing, device, restart]);
  return { video, devices, front, ready: enabled && ready, error, setReady };
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob?.type === 'image/jpeg' ? resolve(blob)
      : reject(new Error('This browser could not encode the photo.')), 'image/jpeg', quality);
  });
}

export async function captureFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('Wait for the camera preview to load.');
  let canvas = document.createElement('canvas');
  const scale = Math.min(1, 3840 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not capture the camera frame.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  let original = await canvasJpeg(canvas, .94);
  for (const quality of [.86, .75, .6]) {
    if (original.size <= MAX_PHOTO_BYTES) break;
    original = await canvasJpeg(canvas, quality);
  }
  if (original.size > MAX_PHOTO_BYTES) {
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(canvas.width * .7));
    smaller.height = Math.max(1, Math.round(canvas.height * .7));
    const smallerContext = smaller.getContext('2d', { alpha: false });
    if (!smallerContext) throw new Error('This browser could not resize the photo.');
    smallerContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
    original = await canvasJpeg(canvas, .72);
  }
  if (original.size > MAX_PHOTO_BYTES) throw new Error('This photo is too large to upload. Try another shot.');
  const thumbCanvas = document.createElement('canvas');
  const ratio = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  thumbCanvas.width = Math.max(1, Math.round(canvas.width * ratio));
  thumbCanvas.height = Math.max(1, Math.round(canvas.height * ratio));
  const thumbContext = thumbCanvas.getContext('2d', { alpha: false });
  if (!thumbContext) throw new Error('This browser could not create a thumbnail.');
  thumbContext.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  let thumb = await canvasJpeg(thumbCanvas, .76);
  if (thumb.size > MAX_THUMB_BYTES) thumb = await canvasJpeg(thumbCanvas, .55);
  return { original, thumb, requestId: crypto.randomUUID() };
}
