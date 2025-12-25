import express from 'express';
import { checkSupabaseConnection } from '../utils/health.js';

const router = express.Router();

// Basic health check
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Detailed health check with dependencies
router.get('/detailed', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      supabase: { status: 'unknown' }
    }
  };

  // Check Supabase connection
  try {
    const supabaseHealth = await checkSupabaseConnection();
    health.checks.supabase = supabaseHealth;
  } catch (error) {
    health.checks.supabase = { status: 'error', message: error.message };
    health.status = 'degraded';
  }

  // Determine overall status
  const allHealthy = Object.values(health.checks).every(check => check.status === 'healthy');
  health.status = allHealthy ? 'healthy' : 'degraded';

  return res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

export default router;
