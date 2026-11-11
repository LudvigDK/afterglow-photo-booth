import { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/manrope/wght.css';
import './style.css';
import { consumeLink } from './api';
import Landing from './Landing';
import { Back, Empty, Loading, SiteHeader } from './ui';

const Admin = lazy(() => import('./Admin'));
const Booth = lazy(() => import('./Booth'));
const Gallery = lazy(() => import('./Gallery'));
const Live = lazy(() => import('./Live'));
const Photo = lazy(() => import('./PhotoPage'));

consumeLink();
window.addEventListener('popstate', consumeLink);
createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <Suspense fallback={<Loading>Opening Afterglow…</Loading>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/events/:eventId" element={<Admin />} />
        <Route path="/booth/:eventId" element={<Booth />} />
        <Route path="/gallery/:eventId" element={<Gallery />} />
        <Route path="/live/:eventId" element={<Live />} />
        <Route path="/photo/:photoId" element={<Photo />} />
        <Route path="*" element={<><SiteHeader /><main className="page-shell"><Back to="/">Home</Back><Empty title="Page not found">Open an event link or go back to the home page.</Empty></main></>} />
      </Routes>
    </Suspense>
  </HashRouter>,
);
