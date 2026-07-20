import { ImageModel, AnalysisModel } from '../models/image.model';
import { analyzeBlur, analyzeBrightness, analyzeDuplicates, analyzeDimensions,
  analyzeScreenshot, analyzeOCR, analyzeMetadata } from '../analyzers';
import { logger } from '../utils/logger';

interface AnalysisEntry {
  image_id: string;
  analyzer_name: string;
  passed: boolean;
  confidence?: number;
  details?: Record<string, any>;
  execution_time_ms?: number;
}

/**
 * Process a single image through all analyzers.
 * This is the main processing function called by the queue.
 */
export async function processImage(imageId: string): Promise<void> {
  const image = ImageModel.findById(imageId);
  if (!image) {
    throw new Error(`Image not found: ${imageId}`);
  }

  logger.info('Starting image processing', { imageId, filename: image.original_filename });

  // Update status to processing
  ImageModel.updateStatus(imageId, 'processing');

  const results: AnalysisEntry[] = [];
  const errors: string[] = [];

  // Helper to run an analyzer safely
  async function runAnalyzer(
    name: string,
    fn: () => Promise<{ passed: boolean; confidence: number; details: any }>
  ) {
    const start = Date.now();
    try {
      const result = await fn();
      results.push({
        image_id: imageId,
        analyzer_name: name,
        passed: result.passed,
        confidence: result.confidence,
        details: result.details,
        execution_time_ms: Date.now() - start,
      });
      logger.debug(`Analyzer ${name} complete`, { imageId, passed: result.passed, ms: Date.now() - start });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: ${msg}`);
      results.push({
        image_id: imageId,
        analyzer_name: name,
        passed: true, // Don't penalize for analyzer failures
        confidence: 0,
        details: { error: msg, verdict: 'Analyzer failed - result inconclusive' },
        execution_time_ms: Date.now() - start,
      });
      logger.warn(`Analyzer ${name} failed`, { imageId, error: msg });
    }
  }

  // Run all analyzers
  // Run dimension check first (fast), then others in parallel
  await runAnalyzer('dimension_validation', () => analyzeDimensions(image.stored_path, image.file_size));

  // Get dimensions for the image record
  try {
    const sharp = require('sharp');
    const meta = await sharp(image.stored_path).metadata();
    if (meta.width && meta.height) {
      ImageModel.updateStatus(imageId, 'processing', { width: meta.width, height: meta.height });
    }
  } catch {}

  // Run remaining analyzers in parallel for speed
  await Promise.all([
    runAnalyzer('blur_detection', () => analyzeBlur(image.stored_path)),
    runAnalyzer('brightness_analysis', () => analyzeBrightness(image.stored_path)),
    runAnalyzer('duplicate_detection', () => analyzeDuplicates(image.stored_path, imageId)),
    runAnalyzer('screenshot_detection', () => analyzeScreenshot(image.stored_path)),
    runAnalyzer('metadata_tampering', () => analyzeMetadata(image.stored_path)),
    runAnalyzer('ocr_plate_validation', () => analyzeOCR(image.stored_path)),
  ]);

  // Save all results in a single transaction
  AnalysisModel.createBatch(results);

  // Calculate overall score
  const totalAnalyzers = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const weightedScore = results.reduce((sum, r) => {
    const weight = r.confidence || 0.5;
    return sum + (r.passed ? weight : 0);
  }, 0);
  const maxWeight = results.reduce((sum, r) => sum + (r.confidence || 0.5), 0);
  const overallScore = maxWeight > 0 ? Math.round((weightedScore / maxWeight) * 100) / 100 : 0;
  const issuesFound = totalAnalyzers - passedCount;

  // Update final status
  if (errors.length === totalAnalyzers) {
    // All analyzers failed
    ImageModel.updateStatus(imageId, 'failed', {
      error_message: `All analyzers failed: ${errors.join('; ')}`,
      issues_found: issuesFound,
    });
  } else {
    ImageModel.updateStatus(imageId, 'completed', {
      overall_score: overallScore,
      issues_found: issuesFound,
    });
  }

  logger.info('Image processing complete', {
    imageId,
    overallScore,
    issuesFound,
    totalAnalyzers,
    passedCount,
    analyzerErrors: errors.length,
  });
}
