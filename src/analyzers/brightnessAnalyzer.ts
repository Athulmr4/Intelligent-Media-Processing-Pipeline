import sharp from 'sharp';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Brightness/Exposure Analyzer
 * 
 * Approach: Analyzes image luminance statistics.
 * - Calculates mean brightness from grayscale conversion
 * - Checks histogram distribution for under/overexposure
 * - Evaluates contrast via standard deviation
 * 
 * Trade-off: Simple statistical analysis. A more robust approach
 * would use histogram equalization and zone-based analysis.
 */
export async function analyzeBrightness(imagePath: string): Promise<{
  passed: boolean;
  confidence: number;
  details: {
    meanBrightness: number;
    minBrightness: number;
    maxBrightness: number;
    standardDeviation: number;
    isDark: boolean;
    isBright: boolean;
    isLowContrast: boolean;
    verdict: string;
  };
}> {
  try {
    // Get image statistics
    const stats = await sharp(imagePath)
      .grayscale()
      .stats();

    const channel = stats.channels[0]; // Grayscale has one channel

    const mean = channel.mean;
    // sharp .stats() already provides stdev directly
    const stdDev = channel.stdev ?? 0;
    const minVal = channel.min;
    const maxVal = channel.max;

    const { minBrightness, maxBrightness } = config.analysis;

    const isDark = mean < minBrightness;
    const isBright = mean > maxBrightness;
    // Relaxed thresholds for real outdoor vehicle photos
    const isLowContrast = (maxVal - minVal) < 30 && stdDev < 8;

    const issues: string[] = [];
    if (isDark) issues.push(`too dark (mean: ${mean.toFixed(1)}, threshold: ${minBrightness})`);
    if (isBright) issues.push(`overexposed (mean: ${mean.toFixed(1)}, threshold: ${maxBrightness})`);
    if (isLowContrast) issues.push(`low contrast (stddev: ${stdDev.toFixed(1)})`);

    const passed = !isDark && !isBright && !isLowContrast;

    // Confidence based on how far from thresholds
    let confidence: number;
    if (passed) {
      const darkMargin = (mean - minBrightness) / minBrightness;
      const brightMargin = (maxBrightness - mean) / (255 - maxBrightness);
      confidence = 0.7 + 0.3 * Math.min(darkMargin, brightMargin, 1);
    } else {
      confidence = 0.75 + 0.2 * Math.min(
        isDark ? Math.abs(minBrightness - mean) / minBrightness : 1,
        isBright ? Math.abs(mean - maxBrightness) / (255 - maxBrightness) : 1,
        1
      );
    }

    const verdict = passed
      ? `Brightness is acceptable (mean: ${mean.toFixed(1)})`
      : `Brightness issues detected: ${issues.join(', ')}`;

    logger.debug('Brightness analysis complete', {
      mean: mean.toFixed(1),
      stdDev: stdDev.toFixed(1),
      passed,
    });

    return {
      passed,
      confidence: Math.min(1, Math.max(0, confidence)),
      details: {
        meanBrightness: Math.round(mean * 100) / 100,
        minBrightness: minVal,
        maxBrightness: maxVal,
        standardDeviation: Math.round(stdDev * 100) / 100,
        isDark,
        isBright,
        isLowContrast,
        verdict,
      },
    };
  } catch (error) {
    logger.error('Brightness analysis failed', { error: (error as Error).message, imagePath });
    throw new Error(`Brightness analysis failed: ${(error as Error).message}`);
  }
}
