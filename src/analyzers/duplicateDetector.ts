import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import { HashModel } from '../models/image.model';
import { logger } from '../utils/logger';

/**
 * Duplicate Detection Analyzer
 * 
 * Uses two approaches:
 * 1. File hash (SHA-256) - detects exact duplicates
 * 2. Perceptual hash (average hash) - detects visually similar images
 * 
 * The perceptual hash works by:
 * - Resize to 8x8 grayscale
 * - Compare each pixel to the mean
 * - Generate a 64-bit hash
 * - Similar images produce similar hashes (hamming distance)
 * 
 * Trade-off: Average hash is simple but effective for near-duplicates.
 * More robust alternatives include pHash or dHash, which handle
 * rotation and scaling better.
 */

/**
 * Calculate SHA-256 hash of file content.
 */
function calculateFileHash(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculate a perceptual hash (average hash / aHash).
 * Produces a 64-character hex string (256-bit for better discrimination).
 */
async function calculatePerceptualHash(imagePath: string): Promise<string> {
  // Resize to 16x16 grayscale for a 256-bit hash
  const resized = await sharp(imagePath)
    .grayscale()
    .resize(16, 16, { fit: 'fill' })
    .raw()
    .toBuffer();

  // Calculate mean pixel value
  let sum = 0;
  for (let i = 0; i < resized.length; i++) {
    sum += resized[i];
  }
  const mean = sum / resized.length;

  // Generate hash: 1 if pixel >= mean, 0 otherwise
  let hashBits = '';
  for (let i = 0; i < resized.length; i++) {
    hashBits += resized[i] >= mean ? '1' : '0';
  }

  // Convert binary string to hex
  let hexHash = '';
  for (let i = 0; i < hashBits.length; i += 4) {
    hexHash += parseInt(hashBits.slice(i, i + 4), 2).toString(16);
  }

  return hexHash;
}

/**
 * Calculate hamming distance between two hex hash strings.
 */
function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return Infinity;

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    // Count bits set in XOR result
    distance += xor.toString(2).split('1').length - 1;
  }
  return distance;
}

/**
 * Run duplicate detection analysis.
 */
export async function analyzeDuplicates(
  imagePath: string,
  imageId: string
): Promise<{
  passed: boolean;
  confidence: number;
  details: {
    fileHash: string;
    perceptualHash: string;
    isExactDuplicate: boolean;
    isSimilarImage: boolean;
    duplicateOf: string[];
    similarTo: Array<{ imageId: string; distance: number }>;
    verdict: string;
  };
}> {
  try {
    // Calculate both hashes
    const fileHash = calculateFileHash(imagePath);
    const perceptualHash = await calculatePerceptualHash(imagePath);

    // Store hashes for future comparisons
    HashModel.create({
      image_id: imageId,
      file_hash: fileHash,
      perceptual_hash: perceptualHash,
    });

    // Check for exact duplicates (same file hash)
    const exactMatches = HashModel.findByFileHash(fileHash, imageId);
    const isExactDuplicate = exactMatches.length > 0;
    const duplicateOf = exactMatches.map(m => m.image_id);

    // Check for similar images (perceptual hash comparison)
    const allHashes = HashModel.getAll(imageId);
    const similarTo: Array<{ imageId: string; distance: number }> = [];

    const SIMILARITY_THRESHOLD = 10; // Hamming distance threshold (out of 256 bits)

    for (const existing of allHashes) {
      if (existing.perceptual_hash) {
        const distance = hammingDistance(perceptualHash, existing.perceptual_hash);
        if (distance <= SIMILARITY_THRESHOLD && distance > 0) {
          similarTo.push({
            imageId: existing.image_id,
            distance,
          });
        }
      }
    }

    const isSimilarImage = similarTo.length > 0;
    const passed = !isExactDuplicate && !isSimilarImage;

    let confidence: number;
    if (isExactDuplicate) {
      confidence = 1.0; // 100% certain it's a duplicate
    } else if (isSimilarImage) {
      // Higher confidence for smaller hamming distances
      const minDistance = Math.min(...similarTo.map(s => s.distance));
      confidence = 0.6 + 0.4 * (1 - minDistance / SIMILARITY_THRESHOLD);
    } else {
      confidence = 0.85; // Reasonably confident it's not a duplicate
    }

    let verdict: string;
    if (isExactDuplicate) {
      verdict = `Exact duplicate of image(s): ${duplicateOf.join(', ')}`;
    } else if (isSimilarImage) {
      verdict = `Visually similar to ${similarTo.length} existing image(s)`;
    } else {
      verdict = 'No duplicates or similar images detected';
    }

    logger.debug('Duplicate analysis complete', {
      imageId,
      isExactDuplicate,
      isSimilarImage,
      similarCount: similarTo.length,
    });

    return {
      passed,
      confidence: Math.min(1, Math.max(0, confidence)),
      details: {
        fileHash,
        perceptualHash,
        isExactDuplicate,
        isSimilarImage,
        duplicateOf,
        similarTo,
        verdict,
      },
    };
  } catch (error) {
    logger.error('Duplicate analysis failed', { error: (error as Error).message, imagePath });
    throw new Error(`Duplicate detection failed: ${(error as Error).message}`);
  }
}
