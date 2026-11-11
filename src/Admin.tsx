import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, Camera, Database, Images, KeyRound, LogOut, Plus, QrCode, Save, Settings2, ShieldCheck, Trash2, Tv } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fits, modes, transitions, type EventAdmin, type EventInfo, type EventSummary, type Photo, type Settings } from '../shared/model';
import { api, apiBase, ApiError, appUrl, messageOf, readToken, saveToken } from './api';
import { EventPhotos } from './Gallery';
import { usePolling } from './hooks';
import { Back, CopyButton, Empty, ExternalLink, Loading, Modal, Notice, Qr, SiteHeader, dateLabel, sizeLabel } from './ui';

const jsonHeaders = { 'Content-Type': 'application/json' };
type Access = { kiosk: string; live: string };
type Confirm = 'event' | 'photos' | 'rotate' | Photo;

export default function AdminRoute() {
  const { eventId } = useParams();
  const [token, setToken] = useState(() => readToken('admin'));
  const signOut = () => { saveToken('admin', ''); setToken(''); };
  return <>
    <SiteHeader>{token && <button className="button button-secondary button-small" onClick={signOut}><LogOut size={17} /> Sign out</button>}</SiteHeader>
    {!token ? <main className="auth-shell"><span className="empty-icon"><ShieldCheck size={28} /></span><h1>Manage your events.</h1>
      <p>Sign in to create events, connect devices and manage photos.</p>
      {apiBase ? <a className="button button-primary" href={apiBase + '/auth'}><KeyRound size={20} /> Sign in <ArrowUpRight size={18} /></a>
        : <Notice>Set VITE_API_URL before building the website.</Notice>}
    </main> : eventId ? <EventDashboard key={eventId} id={eventId} token={token} signOut={signOut} />
      : <Dashboard token={token} signOut={signOut} />}
  </>;
}

function Dashboard({ token, signOut }: { token: string; signOut: () => void }) {
  const state = usePolling<{ events: EventSummary[] }>('/admin/events', 30_000, token);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => { if (state.error instanceof ApiError && state.error.status === 401) signOut(); }, [state.error, signOut]);

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await api<EventInfo>('/admin/events', {
        method: 'POST', token, headers: jsonHeaders, body: JSON.stringify({ name }),
      });
      if (data) navigate('/admin/events/' + data.id);
    } catch (issue) { setError(messageOf(issue)); }
    finally { setSaving(false); }
  }

  return <main className="page-shell">
    <div className="page-heading"><div><span className="eyebrow"><CalendarDays size={17} /> ADMIN DASHBOARD</span><h1>Your events</h1></div>
      <button className="button button-primary" onClick={() => { setCreate(true); setName(''); setError(''); }}><Plus size={21} /> Create event</button></div>
    {state.error && <Notice retry={state.refresh}>{state.error.message}</Notice>}
    {!state.data && !state.error && <Loading>Loading events…</Loading>}
    {state.data && !state.data.events.length && <Empty title="No events yet">Create an event to get your booth, gallery and live display links.</Empty>}
    {state.data?.events.length ? <div className="event-list">{state.data.events.map((event) =>
      <Link key={event.id} className="event-row" to={`/admin/events/${event.id}`}>
        <span className="section-icon"><CalendarDays size={21} /></span><span><strong>{event.name}</strong><small>{dateLabel(event.createdAt)}</small></span>
        <ArrowUpRight size={20} /></Link>)}</div> : null}
    {create && <Modal title="Create an event" onClose={() => { if (!saving) setCreate(false); }}>
      <form onSubmit={(e) => void createEvent(e)} className="stack">
        <label className="field">Event name<input required autoFocus maxLength={80} placeholder="e.g. Friday night party" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {error && <Notice>{error}</Notice>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreate(false)} disabled={saving}>Cancel</button>
          <button className="button button-primary" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create event'}</button></div>
      </form>
    </Modal>}
  </main>;
}

function EventDashboard({ id, token, signOut }: { id: string; token: string; signOut: () => void }) {
  const path = '/admin/events/' + id;
  const state = usePolling<EventAdmin>(path, 20_000, token);
  const [access, setAccess] = useState<Access>();
  const [accessError, setAccessError] = useState('');
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [tab, setTab] = useState<'setup' | 'settings' | 'photos'>('setup');
  const [qr, setQr] = useState<{ name: string; url: string }>();
  const [confirm, setConfirm] = useState<Confirm>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [galleryVersion, setGalleryVersion] = useState(0);
  const navigate = useNavigate();
  useEffect(() => { if (state.error instanceof ApiError && state.error.status === 401) signOut(); }, [state.error, signOut]);
  useEffect(() => {
    const controller = new AbortController();
    setAccessError('');
    void api<Access>(path + '/links', { token, signal: controller.signal })
      .then(({ data }) => { if (data && !controller.signal.aborted) setAccess(data); })
      .catch((issue) => { if (!controller.signal.aborted) setAccessError(messageOf(issue)); });
    return () => controller.abort();
  }, [path, token, linkAttempt]);

  async function execute() {
    if (!confirm || pending) return;
    setPending(true); setError('');
    try {
      if (confirm === 'rotate') {
        const { data } = await api<Access>(path + '/links', { token, method: 'POST' });
        if (data) setAccess(data);
      } else if (confirm === 'event') {
        await api(path, { token, method: 'DELETE' });
        navigate('/admin', { replace: true });
      } else {
        await api(path + '/photos' + (confirm === 'photos' ? '' : '/' + confirm.id), { token, method: 'DELETE' });
        setGalleryVersion((n) => n + 1);
        state.refresh();
      }
      setConfirm(undefined);
    } catch (issue) { setError(messageOf(issue)); }
    finally { setPending(false); }
  }

  const event = state.data;
  const links = [
    { title: 'Photo booth', icon: Camera, desc: 'Open on the tablet with the camera.', url: access && appUrl(`/booth/${id}?key=${access.kiosk}`) },
    { title: 'Event gallery', icon: Images, desc: 'Share with guests who want to browse event photos.', url: event?.settings.galleryVisible ? appUrl(`/gallery/${id}`) : undefined },
    { title: 'Live display', icon: Tv, desc: 'Open on a TV, projector or connected computer.', url: access && appUrl(`/live/${id}?key=${access.live}`) },
  ];
  const confirmation = confirm === 'event' ? ['Delete this event?', 'The booth, gallery and live display links will stop working. All event photos will be removed.']
    : confirm === 'photos' ? ['Delete all photos?', 'Every current photo will be removed from this event. The booth can continue taking photos.']
    : confirm === 'rotate' ? ['Reset the booth link?', 'Open the new link on each booth tablet to resume uploads.']
    : ['Delete this photo?', 'This photo will be removed from the gallery and its download link will stop working.'];
  const ask = (action: Confirm) => { setError(''); setConfirm(action); };

  return <main className="page-shell">
    <Back to="/admin">All events</Back>
    {state.error && <Notice retry={state.refresh}>{state.error.message}</Notice>}
    {!event && !state.error && <Loading>Loading event…</Loading>}
    {event && <>
      <div className="page-heading"><div><span className="eyebrow"><CalendarDays size={17} /> EVENT SETTINGS</span><h1>{event.name}</h1></div></div>
      <div className="metrics">
        <div><Images size={21} /><span><small>Photos</small><strong>{event.count}</strong></span></div>
        <div><Database size={21} /><span><small>Event storage</small><strong>{sizeLabel(event.bytes)}</strong></span></div>
        <div><Database size={21} /><span><small>Installation storage</small><strong>{sizeLabel(event.storageUsed)} / {sizeLabel(event.storageLimit)}</strong></span></div>
      </div>
      <nav className="admin-tabs" aria-label="Event management">
        {([['setup', 'Device links', Camera], ['settings', 'Settings', Settings2], ['photos', 'Photos', Images]] as const)
          .map(([key, label, Icon]) => <button key={key} aria-current={key === tab ? 'page' : undefined} onClick={() => setTab(key)}><Icon size={19} />{label}</button>)}
      </nav>
      {tab === 'setup' && <div className="stack">
        {accessError && <Notice retry={() => setLinkAttempt((n) => n + 1)}>{accessError}</Notice>}
        {links.map(({ title, desc, url, icon: Icon }) => <section className="panel device-link" key={title}>
          <span className="section-icon"><Icon size={22} /></span><div className="device-body"><h2>{title}</h2><p>{desc}</p>
            {url ? <><input aria-label={title + ' URL'} readOnly value={url} onFocus={(e) => e.target.select()} />
              <div className="device-actions"><ExternalLink href={url}>Open</ExternalLink><CopyButton value={url} />
                <button className="button button-secondary button-small" onClick={() => setQr({ name: title, url })}><QrCode size={17} /> Show QR</button>
              </div></> : <p>{title === 'Event gallery' ? 'The gallery is private. Change visibility in Settings.' : accessError ? 'Link unavailable.' : 'Loading link…'}</p>}
          </div>
        </section>)}
        <div className="admin-actions"><button className="button button-secondary" onClick={() => ask('rotate')}><KeyRound size={18} /> Reset booth link</button>
          <button className="button button-danger" onClick={() => ask('event')}><Trash2 size={18} /> Delete event</button></div>
      </div>}
      {tab === 'settings' && <SettingsForm event={event} token={token} onSave={state.refresh} />}
      {tab === 'photos' && <div className="stack"><div className="section-heading"><h2>Event photos</h2>
        <button className="button button-danger button-small" disabled={!event.count} onClick={() => ask('photos')}><Trash2 size={17} /> Delete all photos</button></div>
        <EventPhotos key={galleryVersion} id={id} token={token} onRemove={ask} /></div>}
    </>}
    {qr && <Modal title={qr.name} onClose={() => setQr(undefined)}><p>Scan this code on the device you want to connect.</p>
      <Qr url={qr.url} label={qr.name + ' link'} size={240} /><div className="modal-actions"><CopyButton value={qr.url} /></div></Modal>}
    {confirm && <Modal title={confirmation[0]} onClose={() => { if (!pending) setConfirm(undefined); }}>
      <p>{confirmation[1]}</p>{error && <Notice>{error}</Notice>}<div className="modal-actions">
        <button className="button button-secondary" disabled={pending} onClick={() => setConfirm(undefined)}>Cancel</button>
        <button className="button button-danger" disabled={pending} onClick={() => void execute()}>{pending ? 'Working…' : confirm === 'rotate' ? 'Reset link' : 'Delete'}</button>
      </div></Modal>}
  </main>;
}

function SettingsForm({ event, token, onSave }: { event: EventAdmin; token: string; onSave: () => void }) {
  const [name, setName] = useState(event.name);
  const [settings, setSettings] = useState(event.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  const numeric = (key: keyof Settings, label: string, min: number, max: number) =>
    <label className="field">{label}<input type="number" required min={min} max={max} value={Number.isFinite(settings[key]) ? settings[key] as number : ''}
      onChange={(e) => change(key, e.target.valueAsNumber)} /></label>;
  const toggle = (key: keyof Settings, label: string) =>
    <label className="toggle"><input type="checkbox" checked={Boolean(settings[key])} onChange={(e) => change(key, e.target.checked)} /><span>{label}</span></label>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setSaved(false);
    try {
      const { data } = await api<EventInfo>('/admin/events/' + event.id, {
        method: 'PUT', headers: jsonHeaders, token, body: JSON.stringify({ name, settings }),
      });
      if (data) { setName(data.name); setSettings(data.settings); }
      setSaved(true);
      onSave();
    } catch (issue) { setError(messageOf(issue)); }
    finally { setSaving(false); }
  }

  return <form className="settings-form" onSubmit={(e) => void save(e)}>
    <SettingsGroup title="Event and booth">
      <label className="field">Event name<input required maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></label>
      <div className="field-grid">{numeric('countdown', 'Countdown (seconds)', 0, 15)}{numeric('autoReturn', 'Auto-return (seconds, 0 to disable)', 0, 180)}</div>
      <label className="field">Retention for new photos (days)<input type="number" required min={1} max={30}
        value={Number.isFinite(settings.retentionDays) ? settings.retentionDays : ''} onChange={(e) => change('retentionDays', e.target.valueAsNumber)} /></label>
      {toggle('mirror', 'Mirror front camera preview')}{toggle('galleryVisible', 'Make the event gallery public')}
    </SettingsGroup>
    <SettingsGroup title="Live display">
      <label className="field">Display mode<select value={settings.mode} onChange={(e) => change('mode', e.target.value as Settings['mode'])}>
        {modes.map((mode, i) => <option key={mode} value={mode}>{['Latest photo', 'All photos slideshow', 'Recent photos slideshow'][i]}</option>)}</select></label>
      <div className="field-grid">{numeric('slideSeconds', 'Slide duration (seconds)', 2, 60)}{numeric('recentCount', 'Number of recent photos', 1, 1000)}</div>
      <div className="field-grid"><label className="field">Transition<select value={settings.transition} onChange={(e) => change('transition', e.target.value as Settings['transition'])}>
        {transitions.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>
        {numeric('transitionMs', 'Transition duration (ms)', 0, 1500)}</div>
      <div className="field-grid"><label className="field">Image fit<select value={settings.fit} onChange={(e) => change('fit', e.target.value as Settings['fit'])}>
        {fits.map((fit) => <option key={fit} value={fit}>{fit === 'contain' ? 'Contain (entire photo)' : 'Cover (fill screen)'}</option>)}</select></label>
        <label className="field">Background color<input type="color" value={settings.background} onChange={(e) => change('background', e.target.value)} /></label></div>
      {toggle('showTitle', 'Show event title')}{toggle('showTimestamp', 'Show photo timestamp')}
      {toggle('showGalleryQr', 'Show public gallery QR code')}{toggle('showPlaceholder', 'Show placeholder before the first photo')}
    </SettingsGroup>
    <div className="settings-actions">{error && <Notice>{error}</Notice>}{saved && <span role="status">Settings saved.</span>}
      <button className="button button-primary" disabled={saving}><Save size={19} />{saving ? 'Saving…' : 'Save settings'}</button>
    </div>
  </form>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel stack"><h2>{title}</h2>{children}</section>;
}
