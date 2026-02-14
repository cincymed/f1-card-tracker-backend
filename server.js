import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
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

// Define Collection Schema
const collectionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  cards: { type: mongoose.Schema.Types.Mixed, default: {} },
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

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    mongoConnected: mongoose.connection.readyState === 1
  });
});

// Get collection
app.get('/api/collection/:userId', async (req, res) => {
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
app.post('/api/collection/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { cards } = req.body;

    if (!cards) {
      return res.status(400).json({ error: 'Cards data required' });
    }

    const collection = await Collection.findOneAndUpdate(
      { userId },
      { cards, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, synced: true });
  } catch (error) {
    console.error('Error saving collection:', error);
    res.status(500).json({ error: 'Failed to save collection' });
  }
});

// AI recognition endpoint
app.post('/api/recognize', async (req, res) => {
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
```