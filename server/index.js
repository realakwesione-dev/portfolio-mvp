const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const Portfolio = require('./models/Portfolio');
const adminAuth = require('./middleware/adminAuth');

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

/* =========================
   APP INIT
========================= */
const app = express();
const server = http.createServer(app);

/* =========================
   SOCKET.IO (INIT EARLY)
========================= */
// Allowlist of known origins. Include Render frontend and local dev hosts.
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://portfolio-mvp-2.onrender.com',
  'https://arabiancrudeinvest.org'
];

const io = new Server(server, {
  cors: { origin: allowedOrigins }
});

/* =========================
   MIDDLEWARE
========================= */
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // TEMP: allow unknown origins to prevent frontend break due to CORS
      // Change this to stricter behavior once you confirm the deployed URL(s).
      return cb(null, true);
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   FILE UPLOADS
========================= */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  }
});

const upload = multer({ storage });

/* =========================
   ENV VALIDATION
========================= */
const { MONGODB_URI, ADMIN_KEY, REDIS_URL } = process.env;

if (!ADMIN_KEY || ADMIN_KEY === 'replace_with_secure_key') {
  console.error('FATAL: Invalid ADMIN_KEY');
  process.exit(1);
}

if (
  !MONGODB_URI ||
  (!MONGODB_URI.startsWith('mongodb+srv://') &&
   !MONGODB_URI.startsWith('mongodb://'))
) {
  console.error('FATAL: Invalid MongoDB URI');
  process.exit(1);
}

/* =========================
   DB CONNECTION
========================= */
let dbConnected = false;

async function connectMongoWithRetry(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        family: 4
      });
      dbConnected = true;
      console.log('MongoDB connected');
      return;
    } catch (err) {
      console.error(`Mongo retry ${i + 1}:`, err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.warn('MongoDB unavailable, using local fallback');
}

connectMongoWithRetry();

/* =========================
   LOCAL FALLBACK
========================= */
const localPath = path.join(__dirname, 'portfolio.json');

function ensureLocal() {
  if (!fs.existsSync(localPath)) {
    fs.writeFileSync(
      localPath,
      JSON.stringify({ name: 'Default User' }, null, 2)
    );
  }
}

function getPortfolioSync() {
  if (!dbConnected) {
    ensureLocal();
    return JSON.parse(fs.readFileSync(localPath));
  }
  return null;
}

/* =========================
   API ROUTE
========================= */
app.get('/api/portfolio', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.json(getPortfolioSync());
    }

    let data = await Portfolio.findOne();
    if (!data) data = await Portfolio.create({});
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching portfolio' });
  }
});

/* =========================
   ADMIN RATE LIMIT
========================= */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5
});

/* =========================
   ADMIN UPDATE ROUTE
========================= */
app.post(
  '/MP_ADMIN_RESTRICTION/update',
  limiter,
  adminAuth,
  upload.fields([{ name: 'image', maxCount: 1 }]),
  async (req, res) => {
    try {
      const updates = { ...req.body };

      // Normalize uploaded image path
      if (req.files?.image) {
        updates.image = `/uploads/${req.files.image[0].filename}`;
      }

      // Helper: parse known complex fields coming from the admin form
      try {
        // galleryUrls may be JSON array string or newline/comma separated
        if (typeof updates.galleryUrls === 'string' && updates.galleryUrls.trim()) {
          try {
            updates.gallery = JSON.parse(updates.galleryUrls);
          } catch (e) {
            // fallback: split by newlines or commas
            updates.gallery = updates.galleryUrls.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
          }
        }

        // yearlyIncome can come in several formats from the admin form:
        // - newline separated lines like "2020,10000\n2021,15000"
        // - JSON array string
        // - array of strings
        if (updates.yearlyIncome) {
          try {
                if (typeof updates.yearlyIncome === 'string') {
              const raw = updates.yearlyIncome.trim();
              if (!raw) {
                updates.yearlyIncome = [];
              } else if (raw.startsWith('[')) {
                // JSON array (possibly empty)
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                  updates.yearlyIncome = [];
                } else {
                  updates.yearlyIncome = parsed.map((it) => {
                    if (typeof it === 'object') return { year: Number(it.year) || 0, income: Number(it.income || it.value) || 0 };
                    if (Array.isArray(it)) return { year: Number(it[0]) || 0, income: Number(it[1]) || 0 };
                    return { year: 0, income: 0 };
                  });
                }
              } else {
                // newline or comma separated lines
                updates.yearlyIncome = raw
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const parts = line.split(/[,\t ]+/).map((p) => p.trim()).filter(Boolean);
                    return { year: Number(parts[0]) || 0, income: Number(parts[1]) || 0 };
                  });
              }
            } else if (Array.isArray(updates.yearlyIncome)) {
              if (updates.yearlyIncome.length === 0) {
                updates.yearlyIncome = [];
              } else {
                updates.yearlyIncome = updates.yearlyIncome.map((it) => {
                  if (typeof it === 'string') {
                    const parts = it.split(/[,\t ]+/).map((p) => p.trim()).filter(Boolean);
                    return { year: Number(parts[0]) || 0, income: Number(parts[1]) || 0 };
                  }
                  return { year: Number(it.year) || 0, income: Number(it.income || it.value) || 0 };
                });
              }
            } else {
              updates.yearlyIncome = [];
            }
          } catch (e) {
            console.warn('Failed to parse yearlyIncome:', e.message);
            updates.yearlyIncome = [];
          }
        }

        // Coerce numeric fields
        const numFields = ['initialInvestment', 'currentValue', 'netGain', 'estimatedLifetimeEarnings', 'totalWealthGenerated'];
        for (const f of numFields) {
          if (updates[f] !== undefined) updates[f] = Number(updates[f]) || 0;
        }
      } catch (parseErr) {
        console.warn('Admin update parse warning:', parseErr.message);
      }

      /* fallback mode */
      if (!dbConnected) {
        ensureLocal();
        const local = JSON.parse(fs.readFileSync(localPath));
        // merge and persist locally with parsed updates
        const merged = { ...local };
        const allowedKeys = Object.keys(local);
        for (const k of allowedKeys) {
          if (updates[k] !== undefined) merged[k] = updates[k];
        }

        fs.writeFileSync(localPath, JSON.stringify(merged, null, 2));

        io.emit('portfolio', merged);
        return res.json({ message: 'Updated locally', portfolio: merged });
      }

      let portfolio = await Portfolio.findOne();

      if (!portfolio) {
        portfolio = new Portfolio({});
      }

      // DEBUG: log parsed updates to help diagnose production 500s
      try {
        console.info('[ADMIN DEBUG] parsed updates:', JSON.stringify(updates));
      } catch (e) {
        console.info('[ADMIN DEBUG] parsed updates (stringify failed)');
      }

      // Assign only allowed fields to avoid casting errors
      const allowedKeys = Object.keys(Portfolio.schema.paths).filter(k => k !== '__v' && k !== '_id');

      try {
        console.info('[ADMIN DEBUG] allowedKeys:', allowedKeys.join(', '));
      } catch (e) {
        /* ignore */
      }

      for (const key of allowedKeys) {
        if (updates[key] !== undefined) {
          portfolio[key] = updates[key];
        }
      }

      await portfolio.save();

      io.emit('portfolio', portfolio);

      res.json({ message: 'Updated', portfolio });
    } catch (err) {
      console.error('UPDATE ERROR:', err && err.stack ? err.stack : err);

      return res.status(500).json({
        message: 'Update failed',
        error: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : null,
      });
    }
  }
);

// If someone visits the API path in a browser (GET), redirect to the admin UI.
app.get('/MP_ADMIN_RESTRICTION/update', (req, res) => {
  return res.redirect('/MP_ADMIN_RESTRICTION');
});

/* =========================
   STATIC FRONTEND SERVE (SAFE)
========================= */
const clientPath = path.join(__dirname, '../client/dist');

app.use(express.static(clientPath));

// SPA fallback: only send index.html for requests that accept HTML
// and are not API/uploads/socket requests. This prevents returning
// index.html (text/html) for missing JS/CSS assets which breaks MIME checks.
app.get('*', (req, res, next) => {
  const urlPath = req.path || '';

  // Skip API, uploads, and socket routes
  if (urlPath.startsWith('/api') || urlPath.startsWith('/uploads') || urlPath.startsWith('/socket.io')) {
    return next();
  }

  // If the client explicitly accepts HTML, serve index.html
  if (req.accepts && req.accepts('html')) {
    return res.sendFile(path.join(clientPath, 'index.html'));
  }

  // For non-HTML requests (likely assets), return 404 so the client
  // receives proper status/type instead of an HTML page.
  return res.status(404).end();
});

/* =========================
   SOCKET.IO CONNECTION
========================= */
if (REDIS_URL) {
  (async () => {
    try {
      const pub = createClient({ url: REDIS_URL });
      const sub = pub.duplicate();

      await pub.connect();
      await sub.connect();

      io.adapter(createAdapter(pub, sub));
      console.log('Redis adapter enabled');
    } catch (err) {
      console.error('Redis error:', err.message);
    }
  })();
}

io.on('connection', async (socket) => {
  let data;

  try {
    data = dbConnected ? await Portfolio.findOne() : null;
  } catch (err) {
    console.error('Mongo fetch error on socket connection:', err.message);
    data = null;
  }

  if (!data) {
    data = getPortfolioSync() || { name: 'Default' };
  }

  socket.emit('portfolio', data);
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Lightweight health endpoint for quick deployment checks
app.get('/api/test', (req, res) => {
  res.json({ ok: true, time: new Date(), dbConnected });
});