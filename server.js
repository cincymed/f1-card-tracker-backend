import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Anthropic client
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY
  });
});

// Main recognition endpoint
app.post('/api/recognize', async (req, res) => {
  try {
    const { messages, model, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request format' });
    }

    // Pass through to Claude API
    const response = await client.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      messages: messages
    });

    res.json(response);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process request',
      details: error.status
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ F1 Card Tracker Server running on http://localhost:${PORT}`);
  console.log(`📡 API Key: ${process.env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ Missing'}`);
});