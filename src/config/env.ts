import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  dbPath: process.env.DB_PATH || './data/pipeline.db',

  // Uploads
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
  allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp,image/bmp').split(','),

  // Queue
  queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '2000', 10),

  // Analysis Thresholds
  analysis: {
    blurThreshold: parseFloat(process.env.BLUR_THRESHOLD || '100'),
    minBrightness: parseFloat(process.env.MIN_BRIGHTNESS || '40'),
    maxBrightness: parseFloat(process.env.MAX_BRIGHTNESS || '220'),
    minImageWidth: parseInt(process.env.MIN_IMAGE_WIDTH || '200', 10),
    minImageHeight: parseInt(process.env.MIN_IMAGE_HEIGHT || '200', 10),
    maxImageWidth: parseInt(process.env.MAX_IMAGE_WIDTH || '8000', 10),
    maxImageHeight: parseInt(process.env.MAX_IMAGE_HEIGHT || '8000', 10),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
};
