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

// multer storage: use disk by default, but switch to memory when Cloudinary is configured
let upload;
// Default disk storage (fallback)
const diskStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  }
});

upload = multer({ storage: diskStorage });

/* =========================
   ENV VALIDATION
========================= */
const { MONGODB_URI, ADMIN_KEY, REDIS_URL } = process.env;

/* =========================
   CLOUDINARY (OPTIONAL)
========================= */
const cloudinary = require('cloudinary').v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUDNAME || process.env.CLOUDNAME;
const cloudKey = process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY || process.env.KEY;
const cloudSecret = process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || process.env.API_SECRET;

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true, url: process.env.CLOUDINARY_URL });
} else if (cloudName && cloudKey && cloudSecret) {
  cloudinary.config({ cloud_name: cloudName, api_key: cloudKey, api_secret: cloudSecret, secure: true });
}

// If Cloudinary is configured, switch multer to memory storage so we can stream files
if (cloudinary.config && (process.env.CLOUDINARY_URL || (cloudName && cloudKey && cloudSecret))) {
  const memStorage = multer.memoryStorage();
  upload = multer({ storage: memStorage });

  // Helper: upload a buffer to Cloudinary
  async function uploadBufferToCloudinary(buffer, originalname, folder = 'portfolio') {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
      stream.end(buffer);
    });
  }

  // attach helper to app locals for use in routes
  app.locals.uploadBufferToCloudinary = uploadBufferToCloudinary;
}

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

// Default image path (can be overridden with env var)
const DEFAULT_PROFILE_IMAGE = process.env.DEFAULT_PROFILE_IMAGE || '/uploads/image2.jpeg';

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
      const data = getPortfolioSync();
      // ensure image exists locally, fallback to DEFAULT_PROFILE_IMAGE
      if (data && data.image && data.image.startsWith('/uploads')) {
        const imgPath = path.join(__dirname, data.image.replace(/^\//, ''));
        if (!fs.existsSync(imgPath)) {
          data.image = DEFAULT_PROFILE_IMAGE;
        }
      }
      return res.json(data);
    }

    let data = await Portfolio.findOne();
    if (!data) data = await Portfolio.create({});
    const result = data.toObject ? data.toObject() : data;
    // If image points to a local uploads path, validate existence and fallback if missing
    if (result && result.image && typeof result.image === 'string' && result.image.startsWith('/uploads')) {
      const imgPath = path.join(__dirname, result.image.replace(/^\//, ''));
      if (!fs.existsSync(imgPath)) {
        result.image = DEFAULT_PROFILE_IMAGE;
      }
    }
    res.json(result);
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
  // accept main image and optional gallery files
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]),
  async (req, res) => {
    try {
      const updates = { ...req.body };

      // Normalize uploaded image path and upload to Cloudinary when configured
      if (req.files?.image) {
        try {
          if (app.locals.uploadBufferToCloudinary) {
            const buf = req.files.image[0].buffer;
            if (buf) {
              const result = await app.locals.uploadBufferToCloudinary(buf, req.files.image[0].originalname);
              updates.image = result && (result.secure_url || result.url) ? (result.secure_url || result.url) : `/uploads/${req.files.image[0].originalname}`;
            }
          } else if (req.files.image[0].filename) {
            updates.image = `/uploads/${req.files.image[0].filename}`;
          }
        } catch (e) {
          console.warn('Image upload failed:', e && e.message ? e.message : e);
        }
      }

      // Handle gallery uploads (multiple files)
      if (req.files?.gallery && req.files.gallery.length) {
        const galleryUrls = [];
        for (const f of req.files.gallery) {
          try {
            if (app.locals.uploadBufferToCloudinary && f.buffer) {
              const r = await app.locals.uploadBufferToCloudinary(f.buffer, f.originalname, 'portfolio/gallery');
              if (r && (r.secure_url || r.url)) galleryUrls.push(r.secure_url || r.url);
            } else if (f.filename) {
              galleryUrls.push(`/uploads/${f.filename}`);
            }
          } catch (e) {
            console.warn('Gallery upload failed for', f.originalname, e && e.message ? e.message : e);
          }
        }

        if (galleryUrls.length) {
          updates.gallery = (updates.gallery || []).concat(galleryUrls);
        }
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
// Normalize repeated slashes in the URL (e.g. //MP_ADMIN_RESTRICTION)
app.use((req, res, next) => {
  try {
    if (req.url && req.url.includes('//')) {
      const normalized = req.url.replace(/\/{2,}/g, '/');
      return res.redirect(301, normalized);
    }
  } catch (e) {
    /* ignore */
  }
  return next();
});

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