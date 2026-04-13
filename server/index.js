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

      if (req.files?.image) {
        updates.image = `/uploads/${req.files.image[0].filename}`;
      }

      /* fallback mode */
      if (!dbConnected) {
        ensureLocal();
        const local = JSON.parse(fs.readFileSync(localPath));
        const merged = { ...local, ...updates };

        fs.writeFileSync(localPath, JSON.stringify(merged, null, 2));

        io.emit('portfolio', merged);
        return res.json({ message: 'Updated locally', portfolio: merged });
      }

      let portfolio = await Portfolio.findOne();

      if (!portfolio) {
        portfolio = new Portfolio({});
      }

      Object.assign(portfolio, updates);
      await portfolio.save();

      io.emit('portfolio', portfolio);

      res.json({ message: 'Updated', portfolio });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Update failed' });
    }
  }
);

/* =========================
   STATIC FRONTEND SERVE (SAFE)
========================= */
const clientPath = path.join(__dirname, '../client/dist');

app.use(express.static(clientPath));

// IMPORTANT: static middleware must run before the SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
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