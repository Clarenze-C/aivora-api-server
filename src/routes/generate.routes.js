import express from 'express';
import { handleImageGeneration } from '../services/generation.service.js';
import { handleVideoGeneration } from '../services/generation.service.js';

const router = express.Router();

/**
 * Normalize shot type values from Chrome Extension to database format
 * Extension sends: "close-up", "half-body", "full-body"
 * Database expects: "close", "half", "full"
 */
function normalizeShotType(shotType) {
  if (!shotType) return null;
  const mapping = {
    'close-up': 'close',
    'half-body': 'half',
    'full-body': 'full'
  };
  return mapping[shotType] || shotType;
}

/**
 * POST /api/generate
 * Main endpoint for Chrome Extension
 * Receives payload from content script when user clicks on image/video
 *
 * Payload:
 * {
 *   "mode": "image" | "video",
 *   "platform": "pinterest" | "tiktok" | "instagram",
 *   "sourceUrl": "https://...",
 *   "shotType": "close-up" | "half-body" | "full-body",
 *   "settings": { "style": "natural", "quality": "high" },
 *   "timestamp": "2025-12-25T..."
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { mode, platform, sourceUrl, shotType, settings, timestamp } = req.body;

    // Validate required fields
    if (!mode || !platform || !sourceUrl) {
      return res.status(400).json({
        error: 'Missing required fields: mode, platform, sourceUrl'
      });
    }

    // Validate mode
    if (!['image', 'video'].includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode. Must be "image" or "video"'
      });
    }

    // Validate platform
    const validPlatforms = ['pinterest', 'tiktok', 'instagram', 'generic'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`
      });
    }

    // Normalize shot type
    const normalizedShotType = normalizeShotType(shotType);

    console.log(`[${mode.toUpperCase()}] Generation request from ${platform}`);
    console.log(`Source URL: ${sourceUrl}`);
    console.log(`Shot Type: ${shotType || 'auto-detect'} -> ${normalizedShotType || 'null'}`);
    console.log(`Settings: ${JSON.stringify(settings || {})}`);

    // Route to appropriate handler
    let result;
    if (mode === 'image') {
      result = await handleImageGeneration({
        platform,
        sourceUrl,
        shotType: normalizedShotType,
        settings: settings || {},
        timestamp: timestamp || new Date().toISOString()
      });
    } else {
      result = await handleVideoGeneration({
        platform,
        sourceUrl,
        shotType: normalizedShotType,
        settings: settings || {},
        timestamp: timestamp || new Date().toISOString()
      });
    }

    // Return success response
    res.json({
      success: true,
      jobId: result.jobId,
      status: result.status,
      message: result.message,
      estimatedTime: result.estimatedTime
    });

  } catch (error) {
    console.error('Error in /api/generate:', error);
    res.status(500).json({
      error: 'Failed to process generation request',
      message: error.message
    });
  }
});

/**
 * POST /api/generate/image
 * Direct image generation endpoint
 */
router.post('/image', async (req, res) => {
  try {
    const { sourceUrl, shotType, settings } = req.body;

    if (!sourceUrl) {
      return res.status(400).json({ error: 'sourceUrl is required' });
    }

    const normalizedShotType = normalizeShotType(shotType);

    const result = await handleImageGeneration({
      platform: 'generic',
      sourceUrl,
      shotType: normalizedShotType,
      settings: settings || {},
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      jobId: result.jobId,
      status: result.status
    });

  } catch (error) {
    console.error('Error in /api/generate/image:', error);
    res.status(500).json({
      error: 'Failed to generate image',
      message: error.message
    });
  }
});

/**
 * POST /api/generate/video
 * Direct video generation endpoint
 */
router.post('/video', async (req, res) => {
  try {
    const { sourceUrl, shotType, settings } = req.body;

    if (!sourceUrl) {
      return res.status(400).json({ error: 'sourceUrl is required' });
    }

    const normalizedShotType = normalizeShotType(shotType);

    const result = await handleVideoGeneration({
      platform: 'generic',
      sourceUrl,
      shotType: normalizedShotType,
      settings: settings || {},
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      jobId: result.jobId,
      status: result.status
    });

  } catch (error) {
    console.error('Error in /api/generate/video:', error);
    res.status(500).json({
      error: 'Failed to generate video',
      message: error.message
    });
  }
});

/**
 * GET /api/generate/status/:jobId
 * Check status of a generation job
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    // TODO: Implement job status check from Supabase
    res.json({
      jobId,
      status: 'processing',
      message: 'Status check not yet implemented'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check job status',
      message: error.message
    });
  }
});

export default router;
