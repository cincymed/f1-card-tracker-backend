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

// MongoDB Connection
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set');
} else {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
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
    snapshot: mongoose.Schema.Types.Mixed // Store card details at this point in time
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

// JWT Verification Middleware (ADD HERE)
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
    req.userId = decoded.userId;
    req.email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Test endpoint (this is your first route)
app.get('/api/test', (req, res) => {
```

So the structure is:
```
Initialize Anthropic ✓
Add verifyToken middleware ← HERE
Add routes/endpoints

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    mongoConnected: mongoose.connection.readyState === 1
  });
});

// Signup endpoint (ADD HERE)
app.post('/api/auth/signup', async (req, res) => {
  // ... code ...
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  // ... code ...
});

// Verify token endpoint
app.post('/api/auth/verify', verifyToken, (req, res) => {
  // ... code ...
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
app.post('/api/collection/:userId', verifyToken,async (req, res) => {
  try {
    const { userId } = req.params;
    const { cards } = req.body;

    if (!cards) {
      return res.status(400).json({ error: 'Cards data required' });
    }

    // Calculate total collection value
    const totalValue = calculateTotalValue(cards);
    const cardCount = countTotalCards(cards);

    // Create price history entry
    const priceHistoryEntry = {
      date: new Date(),
      totalValue,
      cardCount,
      snapshot: JSON.parse(JSON.stringify(cards))
    };

    const collection = await Collection.findOneAndUpdate(
      { userId },
      { 
        cards, 
        updatedAt: new Date(),
        $push: { priceHistory: priceHistoryEntry }
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

app.get('/api/collection/:userId/history', async (req, res) => {

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
  // This is a simple calculation - you can make it more sophisticated
  // For now, we'll estimate based on card count and rarity
  Object.keys(cards).forEach(cardKey => {
    const variants = cards[cardKey];
    Object.keys(variants).forEach(variant => {
      if (variant === '_analyses' || variant.startsWith('_')) return;
      const count = variants[variant] || 0;
      // Simple estimate: base value varies by variant
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
  // Rough estimates for variant values
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
    const { messages, model, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request format' });
    }

    const totalSize = JSON.stringify(messages).length;
    if (totalSize > 20_000_000) {
      return res.status(413).json({ error: 'Request too large' });
    }

    const response = await client.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      messages: messages
    });

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
