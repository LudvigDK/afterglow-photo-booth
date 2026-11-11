import { ArrowDown, ArrowRight, Camera, Images, ScanLine, Tv, Sparkle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand, SiteHeader } from './ui';
import party from './assets/party.jpg';

const screens = [
  { icon: Camera, name: 'The booth', text: 'Set up a tablet, choose a camera, and let guests take their own photos.' },
  { icon: ScanLine, name: 'The gallery', text: 'Scan the QR after each shot to save it. Open the event gallery to see the rest.' },
  { icon: Tv, name: 'The live display', text: 'Put the latest shot or a rolling slideshow on a TV or projector.' },
];

export default function Landing() {
  return <div className="landing">
    <SiteHeader>
      <button className="nav-link" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>How it works</button>
      <Link className="button button-secondary button-small" to="/admin">Admin dashboard <ArrowRight size={17} /></Link>
    </SiteHeader>
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> THE EVENT PHOTO BOOTH</div>
          <h1>Good times.<br /><em>Great photos.</em></h1>
          <p>Turn a tablet into a photo booth. Give guests instant QR downloads and put every new shot on the big screen.</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/admin"><Camera size={21} /> Set up an event <ArrowRight size={19} /></Link>
            <button className="button button-quiet" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>How it works <ArrowDown size={18} /></button>
          </div>
        </div>
        <figure className="hero-art">
          <div className="print-shadow" />
          <div className="hero-print">
            <div className="print-image">
              <img src={party} alt="Three friends laughing together in front of a violet tinsel backdrop" fetchPriority="high" />
              <i /><i /><i /><i />
            </div>
            <figcaption><span><Sparkle size={16} fill="currentColor" /> AFTERGLOW</span><span>✦</span></figcaption>
          </div>
          <div className="art-icon" aria-hidden="true"><Sparkle fill="currentColor" size={38} strokeWidth={1} /></div>
        </figure>
      </section>
      <section className="how" id="how-it-works">
        <div className="section-heading"><span className="section-icon"><Images size={19} /></span><h2>One event. Three screens.</h2></div>
        <div className="feature-grid">{screens.map(({ icon: Icon, name, text }) =>
          <article className="feature" key={name}><Icon size={25} /><h3>{name}</h3><p>{text}</p></article>)}</div>
      </section>
    </main>
    <footer className="site-footer"><Brand /></footer>
  </div>;
}
