import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Global error handler middleware.
 * Catches unhandled errors and returns structured JSON responses.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  // Handle Multer errors (file size, invalid type, etc.)
  if ((err as any).code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      success: false,
      error: { message: `File too large. Max size: ${Math.round((err as any).limit / 1024 / 1024)}MB` },
    });
    return;
  }
  if ((err as any).code === 'LIMIT_UNEXPECTED_FILE' || err.message?.includes('Invalid file type')) {
    res.status(400).json({
      success: false,
      error: { message: err.message },
    });
    return;
  }
  // Multer wraps fileFilter errors - handle generic multer errors as 400
  if ((err as any).storageErrors || err.message?.includes('Unexpected field')) {
    res.status(400).json({
      success: false,
      error: { message: err.message },
    });
    return;
  }

  const statusCode = (err as any).statusCode || (err as any).status || 500;
  // Known client errors should expose message
  const isClientError = statusCode >= 400 && statusCode < 500;
  const message = isClientError ? err.message : 'Internal server error';

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

/**
 * 404 handler for unknown routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
}

/**
 * Request logging middleware.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      durationMs: duration,
      contentLength: res.get('content-length'),
    });
  });
  next();
}
