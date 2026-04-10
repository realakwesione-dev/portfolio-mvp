import { useEffect, useState } from 'react';

function Splash() {
  const [visible, setVisible] = useState(false);
  const [render, setRender] = useState(true);

  useEffect(() => {
    try {
      const shown = sessionStorage.getItem('splashShown');
      if (shown) {
        setRender(false);
        return;
      }
    } catch (e) {
      // sessionStorage may be unavailable in some envs — proceed to show
    }

    // show splash without blocking background loads
    setVisible(true);

    // timings: fadeIn 500ms, hold 1200ms, fadeOut 500ms => total 2200ms
    const total = 2200;
    const t = setTimeout(() => {
      setVisible(false);
      try { sessionStorage.setItem('splashShown', '1'); } catch (e) {}
      // remove from render after animation completes
      setTimeout(() => setRender(false), 600);
    }, total);

    return () => clearTimeout(t);
  }, []);

  if (!render) return null;

  // allow tap/click to dismiss early on touch devices
  const handleDismiss = () => {
    setVisible(false);
    try { sessionStorage.setItem('splashShown', '1'); } catch (e) {}
    setTimeout(() => setRender(false), 600);
  };

  return (
    <div aria-hidden className={`splash-root ${visible ? 'splash-show' : 'splash-hide'}`} onClick={handleDismiss} role="presentation">
      <div className="splash-inner" onClick={(e) => e.stopPropagation()}>
        <h1 className="splash-title">Welcome to Your Arab Petroleum Profile</h1>
        <p className="splash-sub">Your official petroleum portfolio overview</p>
      </div>
    </div>
  );
}

export default Splash;
