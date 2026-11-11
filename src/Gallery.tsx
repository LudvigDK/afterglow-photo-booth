import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUpRight, Download, Images, Trash2, Tv } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { GalleryPage, Photo } from '../shared/model';
import { api, imageUrl, messageOf } from './api';
import { usePolling } from './hooks';
import { Empty, Loading, Modal, Notice, SiteHeader, dateLabel, timeLabel } from './ui';

export default function GalleryRoute() {
  const { eventId = '' } = useParams();
  return <div><SiteHeader /><main className="page-shell"><EventPhotos key={eventId} id={eventId} /></main></div>;
}

export function EventPhotos({ id, token, onRemove }: { id: string; token?: string; onRemove?: (photo: Photo) => void }) {
  const path = `${token ? '/admin' : ''}/events/${id}/gallery`;
  const poll = usePolling<GalleryPage>(path, 10_000, token);
  const [pageCount, setPageCount] = useState(1);
  const [shown, setShown] = useState<GalleryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!poll.data) { setShown(null); return; }
    const first = poll.data;
    if (pageCount === 1 || !first.next) {
      setShown(first); setLoading(false); setProblem('');
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setProblem('');
      const photos = [...first.photos];
      let next = first.next;
      try {
        for (let index = 1; index < pageCount && next; index++) {
          const response: { data: GalleryPage | null } = await api<GalleryPage>(`${path}?before=${encodeURIComponent(next)}`, { token, signal: controller.signal });
          if (!response.data) break;
          photos.push(...response.data.photos);
          next = response.data.next;
        }
        if (!controller.signal.aborted) setShown({ ...first, photos, next });
      } catch (issue) {
        if (!controller.signal.aborted) setProblem(messageOf(issue));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [poll.data, pageCount, path, token, retry]);

  const event = poll.data?.event;
  const photos = shown?.photos.filter((photo) => photo.expiresAt > Date.now()) ?? [];
  const viewed = photos.find((photo) => photo.id === selected);

  return <>
    {!token && event && <div className="page-heading"><div><span className="eyebrow"><Images size={17} /> EVENT GALLERY</span><h1>{event.name}</h1></div>
      <Link className="button button-secondary" to={`/live/${id}`}><Tv size={19} />{event.settings.mode === 'latest' ? 'Live display' : 'Watch slideshow'}</Link>
    </div>}
    {poll.error && <Notice retry={poll.refresh}>{poll.error.message}</Notice>}
    {!event && !poll.error && <Loading>Loading event photos…</Loading>}
    {event && shown && !photos.length && <Empty title="No photos yet">Photos will appear here as guests use the booth.</Empty>}
    {photos.length > 0 && <div className="photo-grid">{photos.map((photo) => <article className="photo-card" key={photo.id}>
      <button className="photo-tile" onClick={() => setSelected(photo.id)} aria-label={`View photo at ${timeLabel(photo.createdAt)}`}>
        <img src={imageUrl(photo.id, 'thumb')} alt="Event photo" loading="lazy" decoding="async" />
      </button>
      <div className="photo-card-actions"><time dateTime={new Date(photo.createdAt).toISOString()}>{timeLabel(photo.createdAt)}</time>
        <a className="icon-button" href={imageUrl(photo.id, 'download')} aria-label="Download photo"><Download size={18} /></a>
        {onRemove && <button className="icon-button delete-icon" onClick={() => onRemove(photo)} aria-label="Delete photo"><Trash2 size={18} /></button>}
      </div>
    </article>)}</div>}
    {problem && <Notice retry={() => setRetry((n) => n + 1)}>{problem}</Notice>}
    {loading && <Loading>Loading more photos…</Loading>}
    {shown?.next && !loading && !problem && <div className="center-action">
      <button className="button button-secondary" onClick={() => setPageCount((n) => n + 1)}>Load more photos <ArrowDown size={18} /></button>
    </div>}
    {viewed && <Modal title={`Photo from ${dateLabel(viewed.createdAt)}`} onClose={() => setSelected(null)} className="photo-modal">
      <img src={imageUrl(viewed.id)} alt="Selected event photo" />
      <div className="modal-actions"><Link className="button button-secondary" to={`/photo/${viewed.id}`}>Open photo <ArrowUpRight size={17} /></Link>
        <a className="button button-primary" href={imageUrl(viewed.id, 'download')}><Download size={18} /> Download</a></div>
    </Modal>}
  </>;
}
