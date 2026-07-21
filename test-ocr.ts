import { analyzeOCR } from './src/analyzers/ocrAnalyzer';
import path from 'path';
import fs from 'fs';

async function testOCR() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const files = fs.readdirSync(uploadsDir);
  
  if (files.length === 0) {
    console.log('No images found in uploads/');
    return;
  }
  
  // Test the most recent image
  const imagePath = path.join(uploadsDir, files[files.length - 1]);
  console.log(`Testing OCR on: ${imagePath}`);
  
  try {
    const result = await analyzeOCR(imagePath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
  }
}

testOCR();
