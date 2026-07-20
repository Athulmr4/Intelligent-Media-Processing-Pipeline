import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config/env';
import { initDatabase, closeDatabase } from './config/database';
import { router } from './routes';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/errorHandler';
import { processingQueue } from './queue/processingQueue';
import { processImage } from './services/imageProcessor';
import { logger } from './utils/logger';

// ─── Initialize Application ─────────────────────────────────────────

const app = express();

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Serve static dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use(router);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────────────────

function startServer(): void {
  // Initialize database
  initDatabase();

  // Register queue processor
  processingQueue.process(async (imageId: string) => {
    await processImage(imageId);
  });

  // Queue event listeners for logging
  processingQueue.on('job:failed', (job) => {
    const { ImageModel } = require('./models/image.model');
    ImageModel.updateStatus(job.imageId, 'failed', {
      error_message: job.error || 'Processing failed after max retries',
    });
  });

  // Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`
╔══════════════════════════════════════════════════════╗
║   Intelligent Media Processing Pipeline              ║
║   Server running on http://localhost:${config.port}            ║
║   Environment: ${config.nodeEnv.padEnd(37)}║
║   Dashboard: http://localhost:${config.port}/dashboard.html   ║
╚══════════════════════════════════════════════════════╝
    `);
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');

      // Wait for active jobs to complete
      await processingQueue.shutdown(10000);

      // Close database
      closeDatabase();

      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force shutdown after 15 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

// Only start if this is the main module (not imported for testing)
if (require.main === module) {
  startServer();
}

export { app, startServer };
