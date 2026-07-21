import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

async function testPreprocess() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const files = fs.readdirSync(uploadsDir);
  
  if (files.length === 0) {
    console.log('No images found in uploads/');
    return;
  }
  
  // Test the most recent image
  const imagePath = path.join(uploadsDir, files[files.length - 1]);
  console.log(`Processing: ${imagePath}`);
  
  const metadata = await sharp(imagePath).metadata();
  const w = metadata.width || 0;
  const h = metadata.height || 0;

  // Save the full preprocessed image
  await sharp(imagePath)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 2 })
    .toFile(path.join(__dirname, 'debug_full.jpg'));

  // Save bottom right (where plate is on auto-rickshaws)
  const brWidth = Math.floor(w * 0.5);
  const brHeight = Math.floor(h * 0.35);
  await sharp(imagePath)
    .extract({
      left: Math.floor(w * 0.5),
      top: Math.floor(h * 0.65),
      width: brWidth,
      height: brHeight,
    })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 3 })
    .resize({ width: Math.max(brWidth * 2, 800), withoutEnlargement: false })
    .toFile(path.join(__dirname, 'debug_br.jpg'));
    
  console.log('Saved debug images');
}

testPreprocess();
