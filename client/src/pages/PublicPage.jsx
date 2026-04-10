import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import api from '../api';
import img1 from '../assets/image1.jpeg';
import img2 from '../assets/image2.jpeg';
import img3 from '../assets/image3.jpeg';

function PublicPage() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedSrc, setSelectedSrc] = useState(null);
  

  const openLightbox = (src) => {
    setSelectedSrc(src);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setSelectedSrc(null);
  };

  // keyboard escape for modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  

  // lock body scroll when lightbox open
  useEffect(() => {
    if (lightboxOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [lightboxOpen]);

  // fetch portfolio
  useEffect(() => {
    api
      .get('/api/portfolio')
      .then((response) => setPortfolio(response.data))
      .catch(() => setError('Unable to load portfolio data.'))
      .finally(() => setLoading(false));
  }, []);

  // Live updates via Socket.IO — falls back to initial GET if needed
  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
    const socket = io(base, { transports: ['websocket'] });

    socket.on('connect', () => {
      // console.log('Socket connected', socket.id);
    });

    socket.on('portfolio', (data) => {
      setPortfolio(data);
      setLoading(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket connect error', err);
    });

    return () => {
      try { socket.disconnect(); } catch (e) {}
    };
  }, []);

  

  

  if (loading) {
    return <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center">Loading portfolio...</div>;
  }

  if (error) {
    return <div className="rounded-3xl border border-rose-500 bg-rose-950/40 p-8 text-center text-rose-200">{error}</div>;
  }

  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const imageUrl = portfolio.image?.startsWith('http') ? portfolio.image : `${apiBase}${portfolio.image}`;
  const galleryFromApi = (portfolio.gallery && portfolio.gallery.length > 0)
    ? portfolio.gallery.map((g) => (g.startsWith('http') ? g : `${apiBase}${g}`))
    : null;
  const gallerySources = galleryFromApi || [img1, img2, img3];

  

  return (
    <section className="space-y-8">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-lg shadow-black/20">
        <div className="flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
          <img
            src={imageUrl}
            alt={portfolio.name}
            className="h-40 w-40 rounded-full border-4 border-slate-700 object-cover"
          />
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-3">
                <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Investor</p>
                <span className="top-tier-badge" title="Top tier">
                  Top tier
                </span>
              </div>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <h1 className="mt-2 text-4xl font-semibold text-white dp-heading">{portfolio.name}</h1>
              </div>
              <p className="mt-2 text-lg text-slate-300">{portfolio.sector}</p>
            </div>
            <div className="grid gap-4 pt-4 sm:grid-cols-3">
              <div className="rounded-3xl bg-slate-950/80 p-4">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Initial</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">${portfolio.initialInvestment.toLocaleString()}</p>
              </div>
              <div className="rounded-3xl bg-slate-950/80 p-4">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Current</p>
                <p className="mt-2 text-2xl font-semibold text-sky-300">${portfolio.currentValue.toLocaleString()}</p>
              </div>
              <div className="rounded-3xl bg-slate-950/80 p-4">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Earnings</p>
                <p className="mt-2 text-2xl font-semibold text-lime-300">${portfolio.netGain.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8">
        <h2 className="text-xl font-semibold text-white">About this portfolio</h2>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">{portfolio.about || 'This portfolio shows one investor record with current performance numbers and a profile image. Use the admin page to update the details and upload a new profile image.'}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm text-slate-400">Date of birth</p>
            <p className="text-slate-200">{portfolio.dob || '—'}</p>

            <p className="mt-3 text-sm text-slate-400">Place of birth</p>
            <p className="text-slate-200">{portfolio.birthPlace || '—'}</p>

            <p className="mt-3 text-sm text-slate-400">Investment type</p>
            <p className="text-slate-200">{portfolio.investmentType || '—'}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-slate-400">Energy assets</p>
            <p className="text-slate-200">{portfolio.energyAssets || '—'}</p>

            <p className="mt-3 text-sm text-slate-400">Estimated lifetime earnings</p>
            <p className="text-emerald-300">${(portfolio.estimatedLifetimeEarnings || 0).toLocaleString()}</p>

            <p className="mt-3 text-sm text-slate-400">Total wealth generated</p>
            <p className="text-lime-300">${(portfolio.totalWealthGenerated || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm text-slate-400">Yearly income (sample)</h3>
          <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            {portfolio.yearlyIncome && portfolio.yearlyIncome.length > 0 ? (
              <ul className="text-sm text-slate-200">
                {portfolio.yearlyIncome.slice(-10).map((y) => (
                  <li key={y.year} className="flex justify-between border-b border-slate-800/40 py-1">
                    <span>{y.year}</span>
                    <span>${y.income.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-400">No yearly income ledger available.</p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white">Investor biography</h3>
          <p className="mt-3 text-slate-300">{portfolio.bio || 'Biography not available.'}</p>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white">Company history</h3>
          <p className="mt-3 text-slate-300">{portfolio.companyHistory || 'Company history not available.'}</p>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white">Gallery</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {gallerySources.map((src, i) => (
              <div key={i} className="group relative overflow-hidden rounded-lg">
                <img
                  src={src}
                  alt={`gallery-${i + 1}`}
                  onClick={() => openLightbox(src)}
                  role="button"
                  tabIndex={0}
                  className="w-full h-40 object-cover dp-gallery-item cursor-pointer rounded-lg"
                />

                <div className="absolute inset-0 flex items-end justify-between p-3 pointer-events-none">
                  <div className="pointer-events-auto">
                    <button
                      aria-label="Open image"
                      onClick={() => openLightbox(src)}
                      className="rounded-md bg-black/40 px-3 py-1 text-sm text-white backdrop-blur-sm"
                    >
                      View
                    </button>
                  </div>

                  {/* likes removed */}
                </div>
              </div>
            ))}
          </div>
        </div>

        {lightboxOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={closeLightbox}
          >
            <div className="max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
              <img src={selectedSrc} alt="full" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default PublicPage;
