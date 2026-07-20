import sharp from 'sharp';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Image Dimension Validator
 * 
 * Validates:
 * - Minimum dimensions (too small = unusable)
 * - Maximum dimensions (too large = suspicious or unnecessary)
 * - Aspect ratio (extreme ratios suggest screenshots or crops)
 * - File size vs resolution ratio (detects compression issues)
 */
export async function analyzeDimensions(
  imagePath: string,
  fileSize: number
): Promise<{
  passed: boolean;
  confidence: number;
  details: {
    width: number;
    height: number;
    aspectRatio: number;
    megapixels: number;
    bytesPerPixel: number;
    isTooSmall: boolean;
    isTooLarge: boolean;
    hasExtremeAspectRatio: boolean;
    isSuspiciousCompression: boolean;
    verdict: string;
  };
}> {
  try {
    const metadata = await sharp(imagePath).metadata();

    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const aspectRatio = width / Math.max(height, 1);
    const megapixels = (width * height) / 1_000_000;
    const bytesPerPixel = fileSize / Math.max(width * height, 1);

    const { minImageWidth, minImageHeight, maxImageWidth, maxImageHeight } = config.analysis;

    const isTooSmall = width < minImageWidth || height < minImageHeight;
    const isTooLarge = width > maxImageWidth || height > maxImageHeight;

    // Extreme aspect ratios (> 4:1 or < 1:4) suggest panoramas, screenshots, or banners
    const hasExtremeAspectRatio = aspectRatio > 4 || aspectRatio < 0.25;

    // Very low bytes per pixel may indicate heavy compression/quality loss
    // Very high may indicate unnecessary quality for the use case
    const isSuspiciousCompression = bytesPerPixel < 0.1 && megapixels > 1;

    const issues: string[] = [];
    if (isTooSmall) issues.push(`too small (${width}x${height}, min: ${minImageWidth}x${minImageHeight})`);
    if (isTooLarge) issues.push(`too large (${width}x${height}, max: ${maxImageWidth}x${maxImageHeight})`);
    if (hasExtremeAspectRatio) issues.push(`unusual aspect ratio (${aspectRatio.toFixed(2)}:1)`);
    if (isSuspiciousCompression) issues.push(`heavily compressed (${bytesPerPixel.toFixed(3)} bytes/pixel)`);

    const passed = !isTooSmall && !isTooLarge && !hasExtremeAspectRatio;

    let confidence = 0.9;
    if (isTooSmall || isTooLarge) confidence = 0.95;
    if (hasExtremeAspectRatio) confidence = 0.8;

    const verdict = passed
      ? `Dimensions acceptable (${width}x${height}, ${megapixels.toFixed(1)}MP)`
      : `Dimension issues: ${issues.join('; ')}`;

    logger.debug('Dimension analysis complete', {
      width,
      height,
      aspectRatio: aspectRatio.toFixed(2),
      passed,
    });

    return {
      passed,
      confidence,
      details: {
        width,
        height,
        aspectRatio: Math.round(aspectRatio * 100) / 100,
        megapixels: Math.round(megapixels * 100) / 100,
        bytesPerPixel: Math.round(bytesPerPixel * 1000) / 1000,
        isTooSmall,
        isTooLarge,
        hasExtremeAspectRatio,
        isSuspiciousCompression,
        verdict,
      },
    };
  } catch (error) {
    logger.error('Dimension analysis failed', { error: (error as Error).message, imagePath });
    throw new Error(`Dimension validation failed: ${(error as Error).message}`);
  }
}
