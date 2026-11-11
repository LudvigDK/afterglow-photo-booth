import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Camera, Check, CircleAlert, Copy, Expand, LoaderCircle, Minimize, Sparkle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Link } from 'react-router-dom';
import { copyText, messageOf } from './api';

export function Brand() {
  return <Link className="brand" to="/" aria-label="Afterglow home">
    <span className="brand-mark"><Sparkle size={22} fill="currentColor" strokeWidth={1.2} /></span>
    Afterglow<span className="brand-period">.</span>
  </Link>;
}

export function SiteHeader({ children }: { children?: ReactNode }) {
  return <header className="site-header"><Brand /><nav aria-label="Main navigation">{children}</nav></header>;
}

export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={23} />{children}</div>;
}

export function Notice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div className="notice" role="alert"><CircleAlert size={19} /><span>{children}</span>
    {retry && <button className="button button-small" onClick={retry}>Retry</button>}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Camera size={27} /></span><h2>{title}</h2>{children && <p>{children}</p>}</div>;
}

export function Back({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="back-link" to={to}><ArrowLeft size={17} />{children}</Link>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="button button-secondary button-small" href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={16} /></a>;
}

export function FullscreenButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
  return <button type="button" className="icon-button" title={label} aria-label={label} onClick={onClick}>{active ? <Minimize size={20} /> : <Expand size={20} />}</button>;
}

export function Qr({ url, label, size = 208 }: { url: string; label: string; size?: number }) {
  return <div className="qr"><QRCodeSVG value={url} size={size} level="M" marginSize={4} title={label} /></div>;
}

export function CopyButton({ value }: { value: string }) {
  const [label, setLabel] = useState('Copy link');
  useEffect(() => {
    if (label === 'Copy link') return;
    const timer = setTimeout(() => setLabel('Copy link'), 2500);
    return () => clearTimeout(timer);
  }, [label]);
  return <button className="button button-secondary button-small" onClick={async () => {
    try { await copyText(value); setLabel('Copied'); }
    catch (error) { setLabel(messageOf(error)); }
  }}>{label === 'Copied' ? <Check size={17} /> : <Copy size={17} />}{label}</button>;
}

export function Modal({ title, onClose, children, className = '' }: {
  title: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`modal ${className}`} aria-labelledby={titleId} onCancel={(event) => {
    event.preventDefault();
    onClose();
  }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-inner">
      <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>
      {children}
    </div>
  </dialog>;
}

export const dateLabel = (date: number) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const timeLabel = (date: number) => new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const sizeLabel = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB`
  : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes ? `${Math.ceil(bytes / 1000)} KB` : '0 MB';
