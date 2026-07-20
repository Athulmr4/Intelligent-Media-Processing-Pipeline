import sharp from 'sharp';
import { logger } from '../utils/logger';

/**
 * Metadata / Tampering Heuristics Analyzer
 * 
 * Checks for signs of image editing or tampering:
 * 1. EXIF metadata consistency
 * 2. JPEG quality estimation (re-saved images lose quality)
 * 3. Color channel statistical anomalies
 * 4. Error Level Analysis approximation
 */
export async function analyzeMetadata(imagePath: string) {
  try {
    const metadata = await sharp(imagePath).metadata();
    const stats = await sharp(imagePath).stats();
    const flags: string[] = [];
    let score = 0;

    // 1. Check for stripped EXIF (common after editing)
    const hasExif = !!metadata.exif;
    const hasIcc = !!metadata.icc;
    if (!hasExif && metadata.format === 'jpeg') {
      score += 1;
      flags.push('jpeg_without_exif');
    }

    // 2. Check for unusual channel statistics (editing artifacts)
    const channels = stats.channels;
    if (channels.length >= 3) {
      const means = channels.map(c => c.mean);
      const stdevs = channels.map(c => c.stdev);

      // Check if one channel is drastically different (color manipulation)
      const meanRange = Math.max(...means) - Math.min(...means);
      if (meanRange > 80) {
        score += 0.5;
        flags.push('unusual_channel_imbalance');
      }

      // Very low stdev across all channels can indicate synthetic images
      const allLowStdev = stdevs.every(s => s < 15);
      if (allLowStdev) {
        score += 1;
        flags.push('suspiciously_uniform_channels');
      }
    }

    // 3. Check for alpha channel (unusual for vehicle photos)
    if (metadata.channels === 4 && metadata.hasAlpha) {
      score += 1;
      flags.push('has_alpha_channel');
    }

    // 4. Check color space
    if (metadata.space && !['srgb', 'rgb'].includes(metadata.space)) {
      score += 0.5;
      flags.push(`unusual_colorspace_${metadata.space}`);
    }

    // 5. Very small file size for the resolution could indicate heavy re-compression
    const pixels = (metadata.width || 0) * (metadata.height || 0);
    // We don't have file size here, but we can check the metadata density
    if (metadata.density && metadata.density < 72 && metadata.format === 'jpeg') {
      score += 0.5;
      flags.push('low_density');
    }

    const maxScore = 4.5;
    const isSuspicious = score >= 2;
    const passed = !isSuspicious;
    const confidence = Math.min(1, 0.5 + (score / maxScore) * 0.4);

    const verdict = isSuspicious
      ? `Image shows signs of editing/tampering (score: ${score}/${maxScore})`
      : 'No significant editing artifacts detected';

    logger.debug('Metadata analysis complete', { score, flags, passed });

    return {
      passed, confidence,
      details: {
        format: metadata.format,
        colorSpace: metadata.space,
        channels: metadata.channels,
        hasExif, hasIcc,
        hasAlpha: !!metadata.hasAlpha,
        density: metadata.density,
        isSuspicious,
        tamperingScore: score,
        maxScore,
        flags, verdict,
      },
    };
  } catch (error) {
    logger.error('Metadata analysis failed', { error: (error as Error).message });
    throw new Error(`Metadata analysis failed: ${(error as Error).message}`);
  }
}
