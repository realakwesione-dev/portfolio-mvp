import { Routes, Route, Link, useLocation } from 'react-router-dom';
import PublicPage from './pages/PublicPage';
import AdminPage from './pages/AdminPage';
import logoUrl from './assets/page_logo.jpg';
import Splash from './components/Splash';
import Footer from './components/Footer';

function App() {
  const bgImg = '/src/assets/background_img.jpg';
  const overlay = 'linear-gradient(120deg, rgba(0,46,93,0.62), rgba(247,201,72,0.12), rgba(198,40,40,0.08))';

  return (
    <div className="min-h-screen text-slate-100">
      <Splash />
      {/* blurred background layer */}
      <div className="dp-bg-layer" style={{ backgroundImage: `${overlay}, url('${bgImg}')` }} />

      <div className="app-content">
        <header className="border-b border-slate-800 bg-[rgba(2,6,23,0.36)] px-4 py-5 shadow-sm shadow-black/30 sm:px-8">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link to="/">
                <img src={logoUrl} alt="Logo" className="h-10 w-10 rounded-md object-cover" />
              </Link>
              <Link to="/" className="text-2xl font-semibold tracking-tight text-white dp-heading">
                <span className="text-[var(--dp-gold)] mr-2">DUBAI</span> PETROLEUM
              </Link>
            </div>
            {/* Admin link intentionally removed from public header */}
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <Routes>
            <Route path="/" element={<PublicPage />} />
            <Route path="/MP_ADMIN_RESTRICTION" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
      {/* Footer shown on non-admin (public) routes only */}
      {useLocation().pathname !== '/MP_ADMIN_RESTRICTION' && <Footer />}
    </div>
  );
}

export default App;
