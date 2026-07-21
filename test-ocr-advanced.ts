import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import tesseract from 'tesseract.js';

async function tryExtractPlate() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const files = fs.readdirSync(uploadsDir);
  if (files.length === 0) return;
  const imagePath = path.join(uploadsDir, files[files.length - 1]);
  console.log(`Processing: ${imagePath}`);

  const meta = await sharp(imagePath).metadata();
  const w = meta.width || 0, h = meta.height || 0;

  // Let's create multiple thresholds to see which one works best
  const thresholds = [100, 128, 150];
  
  const worker = await tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
  });

  for (const t of thresholds) {
    const buf = await sharp(imagePath)
      .grayscale()
      .threshold(t)
      .resize({ width: w * 2 }) // scale up
      .toBuffer();
      
    // save for debug
    fs.writeFileSync(path.join(__dirname, `debug_thresh_${t}.jpg`), buf);
    
    const { data: { text } } = await worker.recognize(buf);
    console.log(`--- Threshold ${t} ---`);
    console.log(text.trim());
  }
  await worker.terminate();
}

tryExtractPlate();
