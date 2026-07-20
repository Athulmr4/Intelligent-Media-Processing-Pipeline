import sharp from 'sharp';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Blur Detection Analyzer
 * 
 * Approach: Uses the Laplacian variance method.
 * - Converts image to grayscale
 * - Applies a Laplacian kernel (edge detection)
 * - Calculates the variance of the result
 * - Low variance = blurry image (fewer sharp edges)
 * 
 * Trade-off: This is a well-established heuristic but can produce
 * false positives on images with naturally smooth content (sky photos, etc.)
 */
export async function analyzeBlur(imagePath: string): Promise<{
  passed: boolean;
  confidence: number;
  details: {
    laplacianVariance: number;
    threshold: number;
    verdict: string;
    severity: 'none' | 'mild' | 'moderate' | 'severe';
  };
}> {
  const startTime = Date.now();

  try {
    // Load image and convert to grayscale
    const image = sharp(imagePath).grayscale();

    // Apply Laplacian kernel for edge detection
    // The Laplacian kernel: [0, 1, 0], [1, -4, 1], [0, 1, 0]
    const laplacianKernel = {
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    };

    const convolved = await image
      .convolve(laplacianKernel)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Calculate variance of the Laplacian output
    const pixels = convolved.data;
    let sum = 0;
    let sumSq = 0;
    const n = pixels.length;

    for (let i = 0; i < n; i++) {
      const val = pixels[i];
      sum += val;
      sumSq += val * val;
    }

    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);

    const threshold = config.analysis.blurThreshold;
    const passed = variance >= threshold;

    // Calculate severity and confidence
    let severity: 'none' | 'mild' | 'moderate' | 'severe';
    let confidence: number;

    if (variance >= threshold * 2) {
      severity = 'none';
      confidence = 0.95;
    } else if (variance >= threshold) {
      severity = 'none';
      confidence = 0.7 + (0.25 * (variance - threshold) / threshold);
    } else if (variance >= threshold * 0.5) {
      severity = 'mild';
      confidence = 0.7;
    } else if (variance >= threshold * 0.2) {
      severity = 'moderate';
      confidence = 0.8;
    } else {
      severity = 'severe';
      confidence = 0.9;
    }

    const verdict = passed
      ? 'Image sharpness is acceptable'
      : `Image appears ${severity}ly blurry (variance: ${variance.toFixed(2)}, threshold: ${threshold})`;

    logger.debug('Blur analysis complete', {
      variance: variance.toFixed(2),
      threshold,
      passed,
      severity,
      durationMs: Date.now() - startTime,
    });

    return {
      passed,
      confidence: Math.min(1, Math.max(0, confidence)),
      details: {
        laplacianVariance: Math.round(variance * 100) / 100,
        threshold,
        verdict,
        severity,
      },
    };
  } catch (error) {
    logger.error('Blur analysis failed', { error: (error as Error).message, imagePath });
    throw new Error(`Blur detection failed: ${(error as Error).message}`);
  }
}
