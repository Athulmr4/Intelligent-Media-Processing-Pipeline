import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { upload, uploadImage } from '../controllers/upload.controller';
import { getImageStatus, getImageResults, listImages, getStats, healthCheck } from '../controllers/results.controller';
import { config } from '../config/env';

const router = Router();

// ─── Rate Limiter ────────────────────────────────────────────────────

// Rate limiter for general API access
// Set high enough to not interfere with dashboard auto-polling
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: 1000, // High limit — dashboard polls every 5s
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Too many requests. Please try again later.' },
  },
});

// Stricter rate limit for uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: {
    success: false,
    error: { message: 'Upload rate limit exceeded. Max 10 uploads per minute.' },
  },
});

// ─── Routes ──────────────────────────────────────────────────────────

// Health check (no rate limit)
router.get('/health', healthCheck);

// Apply general rate limit to all API routes
router.use('/api', apiLimiter);

// Upload
router.post('/api/v1/images/upload', uploadLimiter, upload.single('image'), uploadImage);

// Status & Results
router.get('/api/v1/images/:id/status', getImageStatus);
router.get('/api/v1/images/:id/results', getImageResults);

// List & Stats
router.get('/api/v1/images', listImages);
router.get('/api/v1/stats', getStats);

export { router };
