import { useEffect, useState } from 'react';
import api from '../api';

// Admin key is entered at runtime to avoid exposing it in build artifacts

function AdminPage() {
  const [data, setData] = useState({
    name: '',
    sector: '',
    initialInvestment: '',
    currentValue: '',
    netGain: ''
  });
  const [adminKey, setAdminKey] = useState('');
  const [yearlyIncomeText, setYearlyIncomeText] = useState('');
  const [about, setAbout] = useState('');
  const [bio, setBio] = useState('');
  const [companyHistory, setCompanyHistory] = useState('');
  const [dob, setDob] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [investmentType, setInvestmentType] = useState('');
  const [energyAssets, setEnergyAssets] = useState('');
  const [estimatedLifetimeEarnings, setEstimatedLifetimeEarnings] = useState('');
  const [totalWealthGenerated, setTotalWealthGenerated] = useState('');
  const [imageFile, setImageFile] = useState(null);
  // unified items for gallery (type: 'url' | 'file')
  const [galleryItems, setGalleryItems] = useState([]);
  const [draggingId, setDraggingId] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/portfolio')
      .then((response) => {
        const portfolio = response.data;
            setData({
          name: portfolio.name || '',
          sector: portfolio.sector || '',
          initialInvestment: portfolio.initialInvestment || '',
          currentValue: portfolio.currentValue || '',
          netGain: portfolio.netGain || ''
        });
        setDob(portfolio.dob || '');
        setBirthPlace(portfolio.birthPlace || '');
        setInvestmentType(portfolio.investmentType || '');
        setEnergyAssets(portfolio.energyAssets || '');
        setEstimatedLifetimeEarnings(portfolio.estimatedLifetimeEarnings || '');
        setTotalWealthGenerated(portfolio.totalWealthGenerated || '');
        setAbout(portfolio.about || '');
        setBio(portfolio.bio || '');
        setCompanyHistory(portfolio.companyHistory || '');
        setYearlyIncomeText(
          (portfolio.yearlyIncome || []).map((y) => `${y.year},${y.income}`).join('\n')
        );
        setGalleryItems((portfolio.gallery || []).map((u, i) => ({ id: `u-${i}-${Date.now()}`, type: 'url', src: u })));
      })
      .catch(() => setStatus('Unable to load current portfolio values.'));
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setData((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');
    setLoading(true);

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('sector', data.sector);
    formData.append('initialInvestment', data.initialInvestment);
    formData.append('currentValue', data.currentValue);
    formData.append('netGain', data.netGain);
    formData.append('dob', dob);
    formData.append('birthPlace', birthPlace);
    formData.append('investmentType', investmentType);
    formData.append('energyAssets', energyAssets);
    formData.append('estimatedLifetimeEarnings', estimatedLifetimeEarnings);
    formData.append('totalWealthGenerated', totalWealthGenerated);
    formData.append('about', about);
    formData.append('bio', bio);
    formData.append('companyHistory', companyHistory);
    // Normalize yearlyIncome to JSON array of { year, value }
    try {
      const yearlyArray = (yearlyIncomeText || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(',').map((p) => p.trim());
          return { year: Number(parts[0]) || 0, value: Number(parts[1]) || 0 };
        });

      formData.append('yearlyIncome', JSON.stringify(yearlyArray));
    } catch (e) {
      formData.append('yearlyIncome', JSON.stringify([]));
    }
    if (imageFile) formData.append('image', imageFile);
    // prepare kept gallery urls and files in current order
    const keptUrls = galleryItems.filter((it) => it.type === 'url').map((it) => it.src);
    const filesToUpload = galleryItems.filter((it) => it.type === 'file').map((it) => it.file);
    formData.append('galleryUrls', JSON.stringify(keptUrls || []));
    if (filesToUpload && filesToUpload.length) {
      for (const f of filesToUpload) formData.append('gallery', f);
    }

    try {
      const response = await api.post('/MP_ADMIN_RESTRICTION/update', formData, {
        headers: {
          Authorization: `Bearer ${adminKey}`
        }
      });

      setStatus('Portfolio updated successfully.');
      return response.data;
    } catch (error) {
      // Prefer structured server error info when available
      const server = error?.response?.data;
      const message = server?.message || server?.error || error?.message || 'Update failed. Check admin key and server status.';
      setStatus(message);
      // show detailed stack in console for debugging
      if (server?.stack) console.error('Server stack:', server.stack);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-lg shadow-black/20">
        <h1 className="text-3xl font-semibold text-white">Admin panel</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Update the portfolio data, including the displayed profile image. Use the secret admin key configured in your environment.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-8">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-200">
            <span>Name</span>
            <input
              name="name"
              value={data.name}
              onChange={handleChange}
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-500"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Admin key (kept private)</span>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Enter admin key"
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Sector</span>
            <input
              name="sector"
              value={data.sector}
              onChange={handleChange}
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-500"
            />
          </label>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-200">
            <span>Date of birth</span>
            <input value={dob} onChange={(e) => setDob(e.target.value)} className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Place of birth</span>
            <input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
          </label>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <label className="space-y-2 text-sm text-slate-200">
            <span>Initial investment</span>
            <input
              name="initialInvestment"
              type="number"
              value={data.initialInvestment}
              onChange={handleChange}
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-500"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Current value</span>
            <input
              name="currentValue"
              type="number"
              value={data.currentValue}
              onChange={handleChange}
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-500"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Net gain</span>
            <input
              name="netGain"
              type="number"
              value={data.netGain}
              onChange={handleChange}
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-500"
            />
          </label>
        </div>

        <label className="space-y-2 text-sm text-slate-200">
          <span>Profile image</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setImageFile(event.target.files?.[0] || null)}
            className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:text-slate-200"
          />
        </label>

        <label className="space-y-2 text-sm text-slate-200">
          <span>Gallery images (max 3 — drag to reorder)</span>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex gap-2" role="list">
              {galleryItems.map((item, i) => (
                <div
                  key={item.id}
                  role="listitem"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    setDraggingId(item.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (!draggedId) return;
                    if (draggedId === item.id) return;
                    setGalleryItems((prev) => {
                      const fromIndex = prev.findIndex((p) => p.id === draggedId);
                      const toIndex = prev.findIndex((p) => p.id === item.id);
                      if (fromIndex === -1 || toIndex === -1) return prev;
                      const next = [...prev];
                      const [moved] = next.splice(fromIndex, 1);
                      next.splice(toIndex, 0, moved);
                      return next;
                    });
                  }}
                  className={`relative w-24 h-16 overflow-hidden rounded-md border border-slate-700 group ${draggingId === item.id ? 'dragging' : ''}`}
                >
                  <img
                    src={item.src}
                    alt={item.type === 'url' ? `existing-${i}` : `new-${i}`}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <button type="button" onClick={() => setGalleryItems((s) => s.filter((it) => it.id !== item.id))} className="absolute top-1 right-1 rounded-full bg-rose-600/90 p-1 text-xs text-white">×</button>
                </div>
              ))}
            </div>

            <input
              type="file"
              accept="image/*"
              multiple
              disabled={galleryItems.length >= 3}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                const allowed = 3 - galleryItems.length;
                if (allowed <= 0) return;
                const toAdd = files.slice(0, allowed).map((f, idx) => ({ id: `f-${Date.now()}-${idx}`, type: 'file', file: f, src: URL.createObjectURL(f) }));
                setGalleryItems((s) => [...s, ...toAdd]);
              }}
              className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:text-slate-200"
            />
          </div>
        </label>

        <label className="space-y-2 text-sm text-slate-200">
          <span>About this portfolio</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={4} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
        </label>

        <label className="space-y-2 text-sm text-slate-200">
          <span>Investor bio</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} placeholder="Short investor bio or profile" className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
        </label>

        <label className="space-y-2 text-sm text-slate-200">
          <span>Company history</span>
          <textarea value={companyHistory} onChange={(e) => setCompanyHistory(e.target.value)} rows={4} placeholder="Company background and history" className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
        </label>

        <label className="space-y-2 text-sm text-slate-200">
          <span>Yearly income (one per line as "year,income")</span>
          <textarea value={yearlyIncomeText} onChange={(e) => setYearlyIncomeText(e.target.value)} rows={6} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
        </label>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-200">
            <span>Energy assets</span>
            <input value={energyAssets} onChange={(e) => setEnergyAssets(e.target.value)} className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Investment type</span>
            <input value={investmentType} onChange={(e) => setInvestmentType(e.target.value)} className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
          </label>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-200">
            <span>Estimated lifetime earnings</span>
            <input value={estimatedLifetimeEarnings} onChange={(e) => setEstimatedLifetimeEarnings(e.target.value)} type="number" className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
          </label>
          <label className="space-y-2 text-sm text-slate-200">
            <span>Total wealth generated</span>
            <input value={totalWealthGenerated} onChange={(e) => setTotalWealthGenerated(e.target.value)} type="number" className="w-full rounded-3xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100" />
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-full bg-sky-500 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save changes'}
        </button>

        {status && (
          <p className="max-w-2xl rounded-3xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-200">
            {status}
          </p>
        )}
      </form>
    </div>
  );
}

export default AdminPage;
