/**
 * Test script to upload an image and check results.
 * Usage: node scripts/test-upload.js [path-to-image]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2] || './test_vehicle.jpg';

if (!fs.existsSync(imagePath)) {
  console.error('Image not found:', imagePath);
  process.exit(1);
}

const boundary = '----FormBoundary' + Date.now();
const file = fs.readFileSync(imagePath);
const filename = path.basename(imagePath);

const bodyParts = [
  `--${boundary}\r\n`,
  `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n`,
  `Content-Type: image/jpeg\r\n\r\n`,
];

const bodyStart = Buffer.from(bodyParts.join(''));
const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat([bodyStart, file, bodyEnd]);

console.log(`\n📤 Uploading: ${filename} (${(file.length / 1024).toFixed(1)} KB)\n`);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/images/upload',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    console.log('Upload Response:', JSON.stringify(result, null, 2));

    if (result.success) {
      const imageId = result.data.id;
      console.log(`\n⏳ Waiting for processing (ID: ${imageId})...`);

      // Poll for results
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        http.get(`http://localhost:3000/api/v1/images/${imageId}/results`, (res) => {
          let rdata = '';
          res.on('data', c => rdata += c);
          res.on('end', () => {
            const r = JSON.parse(rdata);
            if (r.data && (r.data.status === 'completed' || r.data.status === 'failed')) {
              clearInterval(poll);
              console.log('\n✅ Analysis Results:', JSON.stringify(r, null, 2));
            } else if (attempts > 30) {
              clearInterval(poll);
              console.log('\n⏰ Timeout waiting for results');
            } else {
              process.stdout.write('.');
            }
          });
        });
      }, 2000);
    }
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
  console.log('\nMake sure the server is running: npm run dev');
});

req.write(body);
req.end();
