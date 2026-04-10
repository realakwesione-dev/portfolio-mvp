const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const Portfolio = require('./models/Portfolio');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
require('dotenv').config();
const rateLimit = require('express-rate-limit');
const adminAuth = require('./middleware/adminAuth');

const app = express();

// Restrict CORS: allow production frontend origin, allow localhost in development
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://arabiancrude.org']
  : ['http://localhost:5173', 'http://localhost:3000'];

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (e.g., curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('CORS policy: Origin not allowed'));
  }
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${file.fieldname}${ext}`;
    cb(null, name);
  }
});

const upload = multer({ storage });

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;

// Enforce strong ADMIN_KEY at startup
if (!ADMIN_KEY || ADMIN_KEY === 'replace_with_secure_key') {
  console.error('FATAL: ADMIN_KEY is not set or uses insecure default. Set a strong ADMIN_KEY in environment.');
  process.exit(1);
}

// Enforce SRV-only MongoDB connection strings per production policy
if (!MONGODB_URI || !MONGODB_URI.startsWith('mongodb+srv://')) {
  console.error('FATAL: MONGODB_URI must be an Atlas SRV connection string starting with "mongodb+srv://".');
  console.error('Set MONGODB_URI to something like: mongodb+srv://portfolio_admin:<password>@clustermp0.wjcll8f.mongodb.net/portfolioDB?retryWrites=true&w=majority');
  process.exit(1);
}

let dbConnected = false;
const fallbackPortfolio = {
  name: 'Your Name',
  sector: 'Technology',
  initialInvestment: 100000,
  currentValue: 120000,
  netGain: 20000,
  image: '/uploads/default.png'
};

const localDataPath = path.join(__dirname, 'portfolio.json');

// Ensure local JSON file exists with default fallback content
async function ensureLocalData() {
  try {
    await fs.promises.access(localDataPath);
  } catch (err) {
    await fs.promises.writeFile(localDataPath, JSON.stringify(fallbackPortfolio, null, 2));
  }
}
// Helper: simple sleep
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry connecting to MongoDB with exponential backoff, run in background
async function connectMongoWithRetry(uri, maxAttempts = 10) {
  let attempt = 0;
  const baseDelay = 1000; // 1s
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, family: 4 });
      dbConnected = true;
      console.log('Connected to MongoDB');
      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt} failed:`, err.message || err);
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Retrying MongoDB in ${Math.min(delay, 30000)}ms...`);
      await sleep(Math.min(delay, 30000));
    }
  }
  console.warn('Unable to connect to MongoDB after multiple attempts — continuing with local JSON fallback.');
}

// Start connecting but don't block server startup
connectMongoWithRetry(MONGODB_URI).catch((err) => console.error('Mongo retry failed:', err));

async function getOrCreatePortfolio() {
  if (!dbConnected) {
    await ensureLocalData();
    const raw = await fs.promises.readFile(localDataPath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (err) {
      return fallbackPortfolio;
    }
  }

  let portfolio = await Portfolio.findOne();
  if (!portfolio) {
    portfolio = await Portfolio.create({});
  }
  return portfolio;
}

app.get('/api/portfolio', async (req, res) => {
  try {
    const portfolio = await getOrCreatePortfolio();
    res.json(portfolio);
  } catch (error) {
    console.error('GET /api/portfolio error:', error);
    res.status(500).json({ message: 'Unable to fetch portfolio data' });
  }
});

// Socket.IO will be attached to the HTTP server to provide scalable real-time updates
let io = null;
const REDIS_URL = process.env.REDIS_URL || null;

async function setupSocketIO(httpServer) {
  io = new Server(httpServer, { cors: { origin: allowedOrigins } });

  if (REDIS_URL) {
    // Try to connect immediately, but if Redis is unavailable keep retrying in background
    async function tryConfigureRedisAdapter(attempts = 0) {
      try {
        const pubClient = createClient({ url: REDIS_URL });
        const subClient = pubClient.duplicate();
        await pubClient.connect();
        await subClient.connect();
        io.adapter(createAdapter(pubClient, subClient));
        console.log('Socket.IO Redis adapter configured');
        return true;
      } catch (err) {
        const waitMs = Math.min(1000 * Math.pow(2, attempts), 30000);
        console.error(`Redis adapter connect attempt ${attempts + 1} failed:`, err.message || err);
        console.log(`Retrying Redis adapter in ${waitMs}ms...`);
        await sleep(waitMs);
        return tryConfigureRedisAdapter(attempts + 1);
      }
    }

    // Start background retry (non-blocking)
    tryConfigureRedisAdapter().catch((err) => console.error('Redis adapter retry failed:', err));
  } else {
    console.log('No REDIS_URL provided — running Socket.IO without Redis adapter');
  }

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    (async () => {
      try {
        const current = await getOrCreatePortfolio();
        socket.emit('portfolio', current);
      } catch (err) {
        // ignore
      }
    })();
    socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
  });
}

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.ADMIN_RATE_LIMIT_MAX) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});

app.post('/MP_ADMIN_RESTRICTION/update', adminLimiter, adminAuth, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 3 }]), async (req, res) => {
  // adminAuth middleware logs success/failure; log additional context here
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  try {
    const updates = {};

    if (req.body.name) updates.name = req.body.name;
    if (req.body.sector) updates.sector = req.body.sector;
    if (req.body.initialInvestment) updates.initialInvestment = Number(req.body.initialInvestment);
    if (req.body.currentValue) updates.currentValue = Number(req.body.currentValue);
    if (req.body.netGain) updates.netGain = Number(req.body.netGain);
    if (req.body.dob) updates.dob = req.body.dob;
    if (req.body.birthPlace) updates.birthPlace = req.body.birthPlace;
    if (req.body.investmentType) updates.investmentType = req.body.investmentType;
    if (req.body.energyAssets) updates.energyAssets = req.body.energyAssets;
    if (req.body.estimatedLifetimeEarnings) updates.estimatedLifetimeEarnings = Number(req.body.estimatedLifetimeEarnings);
    if (req.body.totalWealthGenerated) updates.totalWealthGenerated = Number(req.body.totalWealthGenerated);
    if (req.body.about) updates.about = req.body.about;
    if (req.body.bio) updates.bio = req.body.bio;
    if (req.body.companyHistory) updates.companyHistory = req.body.companyHistory;

    // Handle yearlyIncome: accept JSON array or newline CSV lines like "1989,900000"
    if (req.body.yearlyIncome) {
      const raw = req.body.yearlyIncome;
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
          updates.yearlyIncome = parsed.map((it) => ({ year: Number(it.year), income: Number(it.income) }));
        }
      } catch (err) {
        // Fallback CSV parsing
        const lines = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const arr = [];
        for (const line of lines) {
          const parts = line.split(',').map((p) => p.trim());
          if (parts.length >= 2) {
            const y = Number(parts[0]);
            const v = Number(parts[1].replace(/[^0-9.-]/g, ''));
            if (!Number.isNaN(y) && !Number.isNaN(v)) arr.push({ year: y, income: v });
          }
        }
        if (arr.length) updates.yearlyIncome = arr;
      }
    }
    // single profile image upload
    if (req.files && req.files.image && req.files.image[0]) {
      updates.image = `/uploads/${req.files.image[0].filename}`;
    }

    console.info(`[ADMIN_UPDATE] attempt ${new Date().toISOString()} ip=${ip} fields=${Object.keys(updates).join(',')}`);

    // gallery management: accept kept gallery URLs from the form and uploaded files
    let keptGallery = [];
    if (req.body.galleryUrls) {
      try {
        const parsed = typeof req.body.galleryUrls === 'string' ? JSON.parse(req.body.galleryUrls) : req.body.galleryUrls;
        if (Array.isArray(parsed)) keptGallery = parsed.map((g) => String(g));
      } catch (err) {
        // ignore parse errors
      }
    }

    const uploadedGallery = (req.files && req.files.gallery && Array.isArray(req.files.gallery))
      ? req.files.gallery.map((f) => `/uploads/${f.filename}`)
      : [];

    if (keptGallery.length || uploadedGallery.length) {
      // merge kept and uploaded, enforce max 3
      updates.gallery = [...keptGallery, ...uploadedGallery].slice(0, 3);
    }

    if (!dbConnected) {
      // Persist updates to local JSON file so admin can update without MongoDB
      await ensureLocalData();
      const raw = await fs.promises.readFile(localDataPath, 'utf8');
      const local = JSON.parse(raw || '{}');
      const merged = { ...local, ...updates };
      await fs.promises.writeFile(localDataPath, JSON.stringify(merged, null, 2));
      // broadcast to connected Socket.IO clients if available
      try { if (io) io.emit('portfolio', merged); } catch (e) { console.error('Socket emit error:', e); }
      return res.json({ message: 'Portfolio updated locally (MongoDB unavailable)', portfolio: merged });
    }

    const portfolio = await getOrCreatePortfolio();
    Object.assign(portfolio, updates);
    await portfolio.save();

    // broadcast to connected Socket.IO clients the updated portfolio
    try { const payload = portfolio && portfolio.toObject ? portfolio.toObject() : portfolio; if (io) io.emit('portfolio', payload); } catch (e) { console.error('Socket emit error:', e); }

    res.json({ message: 'Portfolio updated successfully', portfolio });
  } catch (error) {
    console.error('POST /MP_ADMIN_RESTRICTION/update error:', error);
    res.status(500).json({ message: 'Unable to update portfolio' });
  }
});

const PORT = process.env.PORT || 5000;
const httpServer = http.createServer(app);

// initialize Socket.IO and (optionally) Redis adapter
setupSocketIO(httpServer).catch((err) => console.error('Error setting up Socket.IO:', err));

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
