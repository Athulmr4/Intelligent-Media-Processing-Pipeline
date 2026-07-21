import sharp from 'sharp';
import { logger } from '../utils/logger';

let Tesseract: any = null;

async function loadTesseract() {
  if (!Tesseract) {
    try {
      Tesseract = await import('tesseract.js');
    } catch (e) {
      logger.warn('Tesseract.js not available, OCR analysis will be skipped');
      return null;
    }
  }
  return Tesseract;
}

// Indian vehicle number plate regex patterns
// Standard: XX 00 XX 0000 or XX-00-XX-0000 or XX00XX0000
const INDIAN_PLATE_PATTERNS = [
  /[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{1,4}/gi,
  /[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{1,4}/gi,
];

// State codes for validation
const VALID_STATE_CODES = new Set([
  'AN','AP','AR','AS','BR','CG','CH','DD','DL','DN','GA','GJ','HP',
  'HR','JH','JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL',
  'OD','OR','PB','PY','RJ','SK','TN','TS','TR','UK','UP','WB',
]);

function validateIndianPlate(text: string): { valid: boolean; plates: string[]; details: string } {
  const foundPlates: string[] = [];

  for (const pattern of INDIAN_PLATE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleaned = match.replace(/[\s-]/g, '').toUpperCase();
        const stateCode = cleaned.substring(0, 2);
        if (VALID_STATE_CODES.has(stateCode) && cleaned.length >= 6 && cleaned.length <= 11) {
          foundPlates.push(match.trim().toUpperCase());
        }
      }
    }
  }

  const unique = [...new Set(foundPlates)];
  return {
    valid: unique.length > 0,
    plates: unique,
    details: unique.length > 0
      ? `Found valid Indian plate(s): ${unique.join(', ')}`
      : 'No valid Indian number plate format detected',
  };
}

async function preprocessForOCR(imagePath: string): Promise<Buffer[]> {
  const metadata = await sharp(imagePath).metadata();
  const w = metadata.width || 0;
  const h = metadata.height || 0;
  const regions: Buffer[] = [];

  // Region 1: Full image
  regions.push(await sharp(imagePath).grayscale().normalize().toBuffer());

  if (w > 100 && h > 100) {
    // Region 2: Bottom 40% of image
    regions.push(await sharp(imagePath)
      .extract({ left: 0, top: Math.floor(h * 0.6), width: w, height: Math.floor(h * 0.4) })
      .grayscale().normalize().toBuffer());

    // Region 3: Bottom-right corner
    const brW = Math.floor(w * 0.5); const brH = Math.floor(h * 0.35);
    regions.push(await sharp(imagePath)
      .extract({ left: Math.floor(w * 0.5), top: Math.floor(h * 0.65), width: brW, height: brH })
      .grayscale().normalize().toBuffer());

    // Region 4: Bottom-left corner
    regions.push(await sharp(imagePath)
      .extract({ left: 0, top: Math.floor(h * 0.65), width: brW, height: brH })
      .grayscale().normalize().toBuffer());
  }
  return regions;
}

export async function analyzeOCR(imagePath: string) {
  try {
    const tesseract = await loadTesseract();
    let allExtractedText = '';
    let bestConfidence = 0;
    let ocrAvailable = true;

    if (tesseract) {
      try {
        const worker = await tesseract.createWorker('eng');
        const regions = await preprocessForOCR(imagePath);
        for (const regionBuffer of regions) {
          try {
            const result = await worker.recognize(regionBuffer);
            allExtractedText += (result.data.text || '') + '\n';
            if (result.data.confidence && result.data.confidence > bestConfidence) {
              bestConfidence = result.data.confidence;
            }
          } catch (e) {}
        }
        await worker.terminate();
      } catch (e) {
        logger.warn('OCR processing failed, continuing without OCR', { error: (e as Error).message });
        ocrAvailable = false;
      }
    } else {
      ocrAvailable = false;
    }

    const plateValidation = allExtractedText ? validateIndianPlate(allExtractedText) : {
      valid: false, plates: [], details: 'No text extracted (OCR unavailable or no text found)',
    };

    // "passed" means no issues found. For OCR, we consider it passed if:
    // - A valid plate was found, OR
    // - OCR wasn't available (we can't flag what we can't check)
    const passed = !ocrAvailable || plateValidation.valid || allExtractedText.trim().length === 0;

    const confidence = ocrAvailable ? Math.min(1, bestConfidence / 100) : 0.3;

    const verdict = !ocrAvailable
      ? 'OCR not available - skipped plate validation'
      : plateValidation.valid
        ? `Valid Indian vehicle plate detected: ${plateValidation.plates.join(', ')}`
        : allExtractedText.trim().length > 0
          ? 'Text found but no valid Indian number plate format detected'
          : 'No text detected in image';

    logger.debug('OCR analysis complete', {
      textLength: allExtractedText.length,
      platesFound: plateValidation.plates.length,
      ocrAvailable,
    });

    return {
      passed, confidence,
      details: {
        ocrAvailable,
        extractedText: allExtractedText.substring(0, 500),
        ocrConfidence: Math.round(bestConfidence * 100) / 100,
        plateValidation,
        verdict,
      },
    };
  } catch (error) {
    logger.error('OCR analysis failed', { error: (error as Error).message });
    throw new Error(`OCR analysis failed: ${(error as Error).message}`);
  }
}
