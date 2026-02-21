import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// MongoDB Connection
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set');
} else {
 mongoose.connect(MONGODB_URI)
    .then(async () => {
      console.log('✅ MongoDB connected');
      try {
        const db = mongoose.connection.db;
        const result = await db.collection('collections').updateMany(
          { 'priceHistory.snapshot': { $exists: true } },
          { $set: { priceHistory: [] } }
        );
        if (result.modifiedCount > 0) {
          console.log('Migration: cleared bloated priceHistory from ' + result.modifiedCount + ' collection(s)');
        }
      } catch (err) {
        console.error('Migration warning (non-fatal):', err.message);
      }
    })
    .catch(err => console.error('❌ MongoDB connection error:', err));
}

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Define Collection Schema
const collectionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  cards: { type: mongoose.Schema.Types.Mixed, default: {} },
  priceHistory: [{
    date: { type: Date, default: Date.now },
    totalValue: Number,
    cardCount: Number,
    snapshot: mongoose.Schema.Types.Mixed
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Collection = mongoose.model('Collection', collectionSchema);

// Simple rate limiting
const requestLimits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 10;

  if (!requestLimits.has(ip)) {
    requestLimits.set(ip, []);
  }

  const requests = requestLimits.get(ip);
  const recentRequests = requests.filter(time => now - time < windowMs);

  if (recentRequests.length >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  recentRequests.push(now);
  requestLimits.set(ip, recentRequests);
  next();
}

// CORS
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(rateLimit);

// Initialize Anthropic
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// JWT Verification Middleware
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    mongoConnected: mongoose.connection.readyState === 1
  });
});

// Signup endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;

    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    const user = new User({
      email,
      password: hashedPassword
    });

    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, token, userId: user._id });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatch = await bcryptjs.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, token, userId: user._id });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token endpoint
app.post('/api/auth/verify', verifyToken, (req, res) => {
  res.json({ success: true, email: req.email });
});

// Get collection
app.get('/api/collection/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const collection = await Collection.findOne({ userId });
    
    res.json({
      cards: collection ? collection.cards : {},
      synced: true
    });
  } catch (error) {
    console.error('Error fetching collection:', error);
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

// Save collection
app.post('/api/collection/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { cards } = req.body;

    if (!cards) {
      return res.status(400).json({ error: 'Cards data required' });
    }

    const totalValue = calculateTotalValue(cards);
    const cardCount = countTotalCards(cards);

    const priceHistoryEntry = {
      date: new Date(),
      totalValue,
      cardCount
    };

    const collection = await Collection.findOneAndUpdate(
      { userId },
      {
        cards,
        updatedAt: new Date(),
        $push: {
          priceHistory: {
            $each: [priceHistoryEntry],
            $slice: -500
          }
        }
      },
      { upsert: true, new: true }
    );


    res.json({ success: true, synced: true, totalValue });
  } catch (error) {
    console.error('Error saving collection:', error);
    res.status(500).json({ error: 'Failed to save collection' });
  }
});

// Get price history
app.get('/api/collection/:userId/history', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const collection = await Collection.findOne({ userId });
    
    res.json({
      priceHistory: collection ? collection.priceHistory || [] : [],
      success: true
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

// Helper functions
function calculateTotalValue(cards) {
  let total = 0;
  Object.keys(cards).forEach(cardKey => {
    const variants = cards[cardKey];
    Object.keys(variants).forEach(variant => {
      if (variant === '_analyses' || variant.startsWith('_')) return;
      const count = variants[variant] || 0;
      const baseValue = getVariantBaseValue(variant);
      total += count * baseValue;
    });
  });
  return Math.round(total);
}

function countTotalCards(cards) {
  let count = 0;
  Object.keys(cards).forEach(cardKey => {
    const variants = cards[cardKey];
    Object.keys(variants).forEach(variant => {
      if (variant === '_analyses' || variant.startsWith('_')) return;
      count += variants[variant] || 0;
    });
  });
  return count;
}

function getVariantBaseValue(variant) {
  const values = {
    'Base': 2,
    'Refractor': 5,
    'Purple Refractor /299': 15,
    'Blue Refractor /150': 20,
    'Green Refractor /99': 30,
    'Gold Refractor /50': 50,
    'Orange Refractor /25': 75,
    'Red Refractor /5': 150,
    'SuperFractor 1/1': 500,
    'Printing Plate 1/1': 400,
    'Black Refractor /10': 100,
    'Magenta/Pink Refractor /250': 12,
    'Gold Wave /75': 40
  };
  return values[variant] || 5;
}

// AI recognition endpoint
app.post('/api/recognize', verifyToken, async (req, res) => {
  try {
    const { messages, model, max_tokens, tools } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request format' });
    }

    const totalSize = JSON.stringify(messages).length;
    if (totalSize > 20_000_000) {
      return res.status(413).json({ error: 'Request too large' });
    }

 const params = {
  model: model || 'claude-sonnet-4-20250514',
  max_tokens: max_tokens || 2000,
  messages: messages
};

if (tools && Array.isArray(tools)) {
  params.tools = tools;
}

const response = await client.messages.create(params);


    res.json(response);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process request'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`✅ F1 Card Tracker Server running on port ${PORT}`);
  console.log(`🔒 CORS Origin: ${FRONTEND_URL}`);
});
