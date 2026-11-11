import { useEffect, useState } from 'react';
import { Download, Images, Share2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { PhotoDetails } from '../shared/model';
import { api, appUrl, copyText, imageUrl, messageOf } from './api';
import { useExpiry } from './hooks';
import { Empty, Loading, SiteHeader, dateLabel } from './ui';

export default function PhotoRoute() {
  const { photoId = '' } = useParams();
  return <PhotoPage key={photoId} id={photoId} />;
}

function PhotoPage({ id }: { id: string }) {
  const [photo, setPhoto] = useState<PhotoDetails>();
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const expired = useExpiry(photo?.expiresAt);
  useEffect(() => {
    const controller = new AbortController();
    let localUrl = '';
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        const { data } = await api<PhotoDetails>(`/photos/${id}`, { signal: controller.signal });
        if (!data || controller.signal.aborted) return;
        setPhoto(data);
        const response = await fetch(imageUrl(id), { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? 'This photo has expired or was removed.' : 'The image could not be loaded.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        setFile(new File([blob], `afterglow-${id}.jpg`, { type: data.type }));
        localUrl = URL.createObjectURL(blob);
        setUrl(localUrl);
      } catch (issue) {
        if (!controller.signal.aborted) setError(messageOf(issue));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => { controller.abort(); if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [id, attempt]);

  const share = async () => {
    const link = appUrl('/photo/' + id);
    try {
      if (navigator.share) {
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Your Afterglow photo' });
        } else await navigator.share({ url: link, title: 'Your Afterglow photo' });
      } else { await copyText(link); setNotice('Photo link copied.'); }
    } catch (issue) {
      if (issue instanceof Error && issue.name === 'AbortError') return;
      setNotice(messageOf(issue));
    }
  };

  return <><SiteHeader>{photo?.galleryVisible && <Link className="button button-secondary button-small" to={`/gallery/${photo.eventId}`}><Images size={17} /> Event gallery</Link>}</SiteHeader>
    <main className="page-shell photo-page">
      {loading ? <Loading>Opening your photo…</Loading> : expired || !photo || error ? <>
        <Empty title={expired || /expired|removed|not found/i.test(error) ? 'This photo is no longer available' : 'We couldn’t open this photo'}>
          {expired ? 'This photo’s retention period has ended.' : error}
        </Empty>
        {!expired && !/expired|removed|not found/i.test(error) && <div className="center-action"><button className="button button-secondary" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>}
      </> : <div className="download-layout">
        <div className="download-image"><img src={url} alt={`Photo from ${photo.eventName}`} /></div>
        <div className="download-copy"><span className="eyebrow">{photo.eventName}</span><h1>Your photo.</h1><p>Taken {dateLabel(photo.createdAt)}. Available until {dateLabel(photo.expiresAt)}.</p>
          <a className="button button-primary" href={imageUrl(id, 'download')}><Download size={21} /> Download photo</a>
          <button className="button button-secondary" onClick={() => void share()}><Share2 size={20} />{typeof navigator.share === 'function' ? 'Share photo' : 'Copy photo link'}</button>
          {notice && <p role="status">{notice}</p>}
        </div>
      </div>}
    </main></>;
}
