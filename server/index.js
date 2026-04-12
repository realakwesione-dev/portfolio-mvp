const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const Portfolio = require('./models/Portfolio');
const adminAuth = require('./middleware/adminAuth');

const app = express();

/* =========================
   CORS CONFIG
========================= */
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? [
        'https://arabiancrude.org',
        'https://portfolio-mvp-1.onrender.com'
      ]
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS blocked'));
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   FILE UPLOAD SETUP
========================= */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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

if (!MONGODB_URI || !MONGODB_URI.startsWith('mongodb+srv://')) {
  console.error('FATAL: Invalid MongoDB SRV URI');
  process.exit(1);
}

/* =========================
   DATABASE CONNECTION
========================= */
let dbConnected = false;

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      family: 4
    });
    dbConnected = true;
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB failed:', err.message);
  }
}

connectMongo();

/* =========================
   LOCAL FALLBACK
========================= */
const localPath = path.join(__dirname, 'portfolio.json');

async function ensureLocal() {
  if (!fs.existsSync(localPath)) {
    fs.writeFileSync(
      localPath,
      JSON.stringify({ name: 'Default User' }, null, 2)
    );
  }
}

async function getPortfolio() {
  if (!dbConnected) {
    await ensureLocal();
    return JSON.parse(fs.readFileSync(localPath));
  }

  let p = await Portfolio.findOne();
  if (!p) p = await Portfolio.create({});
  return p;
}

/* =========================
   API ROUTES
========================= */
app.get('/api/portfolio', async (req, res) => {
  try {
    const data = await getPortfolio();
    res.json(data);
  } catch {
    res.status(500).json({ message: 'Error fetching portfolio' });
  }
});

/* =========================
   ADMIN UPDATE
========================= */
const limiter = rateLimit({
  windowMs: 60000,
  max: 15
});

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

      if (!dbConnected) {
        await ensureLocal();
        const local = JSON.parse(fs.readFileSync(localPath));
        const merged = { ...local, ...updates };
        fs.writeFileSync(localPath, JSON.stringify(merged, null, 2));

        if (io) io.emit('portfolio', merged);
        return res.json({ message: 'Updated locally', portfolio: merged });
      }

      const portfolio = await getPortfolio();
      Object.assign(portfolio, updates);
      await portfolio.save();

      if (io) io.emit('portfolio', portfolio);

      res.json({ message: 'Updated', portfolio });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Update failed' });
    }
  }
);

/* =========================
   SERVE FRONTEND (IMPORTANT)
========================= */
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

/* =========================
   SOCKET.IO
========================= */
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins }
});

if (REDIS_URL) {
  (async () => {
    try {
      const pub = createClient({ url: REDIS_URL });
      const sub = pub.duplicate();
      await pub.connect();
      await sub.connect();
      io.adapter(createAdapter(pub, sub));
      console.log('Redis adapter enabled');
    } catch (e) {
      console.error('Redis failed:', e.message);
    }
  })();
}

io.on('connection', async (socket) => {
  const data = await getPortfolio();
  socket.emit('portfolio', data);
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});