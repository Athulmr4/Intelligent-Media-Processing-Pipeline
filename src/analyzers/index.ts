/**
 * Analyzer Registry
 * 
 * Central index of all image analyzers.
 * Each analyzer follows a consistent interface returning:
 *   { passed, confidence, details }
 */

export { analyzeBlur } from './blurDetector';
export { analyzeBrightness } from './brightnessAnalyzer';
export { analyzeDuplicates } from './duplicateDetector';
export { analyzeDimensions } from './dimensionValidator';
export { analyzeScreenshot } from './screenshotDetector';
export { analyzeOCR } from './ocrAnalyzer';
export { analyzeMetadata } from './metadataAnalyzer';

/** Names for display/logging */
export const ANALYZER_NAMES = [
  'blur_detection',
  'brightness_analysis',
  'duplicate_detection',
  'dimension_validation',
  'screenshot_detection',
  'ocr_plate_validation',
  'metadata_tampering',
] as const;

export type AnalyzerName = typeof ANALYZER_NAMES[number];
