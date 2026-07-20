const sharp = require('sharp');

const svg = `<svg width="800" height="600">
  <rect width="800" height="600" fill="#32507A"/>
  <rect x="150" y="220" width="500" height="160" fill="white" rx="8"/>
  <text x="400" y="320" text-anchor="middle" font-size="56" font-family="Arial" fill="black">MH 12 AB 1234</text>
</svg>`;

sharp(Buffer.from(svg))
  .jpeg({ quality: 85 })
  .toFile('./test_vehicle.jpg')
  .then(() => console.log('Created test_vehicle.jpg (800x600 with plate text)'))
  .catch(e => console.error('Failed:', e.message));
