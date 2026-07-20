import sharp from 'sharp';
import { logger } from '../utils/logger';

const SCREENSHOT_RESOLUTIONS = new Set([
  '1170x2532','1284x2778','1125x2436','1080x2340','1080x2400',
  '1080x1920','750x1334','1440x3200','1440x2960','828x1792',
  '1920x1080','2560x1440','3840x2160','1366x768','1536x864',
  '1440x900','1280x720','2560x1600','3440x1440',
]);

async function checkUniformBorders(imagePath: string) {
  const metadata = await sharp(imagePath).metadata();
  const w = metadata.width || 0, h = metadata.height || 0;
  if (!w || !h) return { top: false, bottom: false };
  const stripH = Math.min(40, Math.floor(h * 0.05));

  async function isUniform(left: number, top: number, width: number, height: number) {
    try {
      const stats = await sharp(imagePath).extract({ left, top, width, height }).grayscale().stats();
      return stats.channels[0].stdev < 10;
    } catch { return false; }
  }

  const [top, bottom] = await Promise.all([
    isUniform(0, 0, w, stripH),
    isUniform(0, h - stripH, w, stripH),
  ]);
  return { top, bottom };
}

async function detectMoire(imagePath: string): Promise<boolean> {
  try {
    const meta = await sharp(imagePath).metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (w < 100 || h < 100) return false;
    const s = Math.min(200, Math.min(w, h));
    const stats = await sharp(imagePath)
      .extract({ left: Math.floor((w-s)/2), top: Math.floor((h-s)/2), width: s, height: s })
      .grayscale()
      .convolve({ width: 3, height: 3, kernel: [-1,-1,-1,-1,8,-1,-1,-1,-1] })
      .stats();
    return stats.channels[0].mean > 30;
  } catch { return false; }
}

export async function analyzeScreenshot(imagePath: string) {
  try {
    const metadata = await sharp(imagePath).metadata();
    const w = metadata.width || 0, h = metadata.height || 0;
    const flags: string[] = [];
    let score = 0;
    const maxScore = 6;

    const matchesRes = SCREENSHOT_RESOLUTIONS.has(`${w}x${h}`);
    if (matchesRes) { score += 1; flags.push('matches_screenshot_resolution'); }

    const borders = await checkUniformBorders(imagePath);
    if (borders.top || borders.bottom) {
      score += 1.5; flags.push('uniform_borders');
      if (borders.top) flags.push('status_bar_like');
    }

    const lacksExif = !metadata.exif;
    if (lacksExif) { score += 1; flags.push('no_camera_exif'); }
    if (metadata.format === 'png') { score += 0.5; flags.push('png_format'); }

    const hasMoire = await detectMoire(imagePath);
    if (hasMoire) { score += 2; flags.push('moire_pattern'); }

    const isScreenshot = score >= 2.5;
    const isPhotoOfPhoto = hasMoire && score >= 2;
    const passed = !isScreenshot && !isPhotoOfPhoto;
    const confidence = Math.min(1, 0.5 + (score / maxScore) * 0.5);

    const verdict = isPhotoOfPhoto ? 'Photo of another photo/screen detected'
      : isScreenshot ? 'Image appears to be a screenshot'
      : 'Not a screenshot or photo-of-photo';

    logger.debug('Screenshot analysis complete', { score, isScreenshot, flags });

    return {
      passed, confidence,
      details: { isLikelyScreenshot: isScreenshot, isLikelyPhotoOfPhoto: isPhotoOfPhoto,
        matchesScreenshotResolution: matchesRes, hasUniformBorders: borders.top || borders.bottom,
        hasStatusBar: borders.top, lacksExifCameraData: lacksExif, hasMoirePattern: hasMoire,
        score, maxScore, verdict, flags },
    };
  } catch (error) {
    logger.error('Screenshot analysis failed', { error: (error as Error).message });
    throw new Error(`Screenshot detection failed: ${(error as Error).message}`);
  }
}
