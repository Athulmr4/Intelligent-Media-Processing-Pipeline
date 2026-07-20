import { Request, Response } from 'express';
import { ImageModel, AnalysisModel, ProcessingStatus } from '../models/image.model';
import { processingQueue } from '../queue/processingQueue';
import { logger } from '../utils/logger';

/**
 * GET /api/v1/images/:id/status
 * Fetch processing status for a specific image.
 */
export async function getImageStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const image = ImageModel.findById(id);

    if (!image) {
      res.status(404).json({
        success: false,
        error: { message: `Image not found: ${id}` },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        id: image.id,
        status: image.status,
        filename: image.original_filename,
        retryCount: image.retry_count,
        createdAt: image.created_at,
        updatedAt: image.updated_at,
        completedAt: image.completed_at,
        ...(image.status === 'failed' && { errorMessage: image.error_message }),
      },
    });
  } catch (error) {
    logger.error('Error fetching image status', { error: (error as Error).message });
    res.status(500).json({ success: false, error: { message: 'Failed to fetch status' } });
  }
}

/**
 * GET /api/v1/images/:id/results
 * Fetch analysis results for a specific image.
 */
export async function getImageResults(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const image = ImageModel.findById(id);

    if (!image) {
      res.status(404).json({
        success: false,
        error: { message: `Image not found: ${id}` },
      });
      return;
    }

    if (image.status === 'pending' || image.status === 'processing') {
      res.status(202).json({
        success: true,
        data: {
          id: image.id,
          status: image.status,
          message: `Image is still ${image.status}. Please check back later.`,
        },
        _links: {
          status: `/api/v1/images/${id}/status`,
        },
      });
      return;
    }

    const analysisResults = AnalysisModel.findByImageId(id as string);

    const formattedResults = analysisResults.map(r => ({
      analyzer: r.analyzer_name,
      passed: r.passed === 1,
      confidence: r.confidence,
      details: r.details ? JSON.parse(r.details) : null,
      executionTimeMs: r.execution_time_ms,
    }));

    res.json({
      success: true,
      data: {
        id: image.id,
        status: image.status,
        filename: image.original_filename,
        dimensions: image.width && image.height ? { width: image.width, height: image.height } : null,
        overallScore: image.overall_score,
        issuesFound: image.issues_found,
        totalChecks: formattedResults.length,
        analyses: formattedResults,
        ...(image.status === 'failed' && { errorMessage: image.error_message }),
        createdAt: image.created_at,
        completedAt: image.completed_at,
      },
    });
  } catch (error) {
    logger.error('Error fetching image results', { error: (error as Error).message });
    res.status(500).json({ success: false, error: { message: 'Failed to fetch results' } });
  }
}

/**
 * GET /api/v1/images
 * List all images with pagination.
 */
export async function listImages(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as ProcessingStatus | undefined;

    const result = ImageModel.findAll({ page, limit, status });

    res.json({
      success: true,
      data: {
        images: result.images.map(img => ({
          id: img.id,
          filename: img.original_filename,
          status: img.status,
          overallScore: img.overall_score,
          issuesFound: img.issues_found,
          fileSize: img.file_size,
          dimensions: img.width && img.height ? { width: img.width, height: img.height } : null,
          createdAt: img.created_at,
          completedAt: img.completed_at,
        })),
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      },
    });
  } catch (error) {
    logger.error('Error listing images', { error: (error as Error).message });
    res.status(500).json({ success: false, error: { message: 'Failed to list images' } });
  }
}

/**
 * GET /api/v1/stats
 * Get pipeline statistics.
 */
export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const dbStats = ImageModel.getStats();
    const queueStats = processingQueue.getStats();

    res.json({
      success: true,
      data: {
        database: dbStats,
        queue: queueStats,
      },
    });
  } catch (error) {
    logger.error('Error fetching stats', { error: (error as Error).message });
    res.status(500).json({ success: false, error: { message: 'Failed to fetch stats' } });
  }
}

/**
 * GET /api/v1/health
 * Health check endpoint.
 */
export async function healthCheck(_req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    },
  });
}
