// Generates favicons, app icons and the Open Graph image from the brand logo.
// Run: node scripts/make-icons.mjs  (outputs to public/)
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const LOGO = 'src/assets/images/brand/logo.png';
const OUT = 'public';

const square = (size, pad = 0.08) =>
  sharp(LOGO)
    .resize(Math.round(size * (1 - pad * 2)), Math.round(size * (1 - pad * 2)), { fit: 'contain', background: '#ffffff' })
    .extend({
      top: Math.round(size * pad), bottom: Math.round(size * pad), left: Math.round(size * pad), right: Math.round(size * pad),
      background: '#ffffff',
    })
    .resize(size, size)
    .png();

await square(180).toFile(`${OUT}/apple-touch-icon.png`);
await square(192).toFile(`${OUT}/icon-192.png`);
await square(512).toFile(`${OUT}/icon-512.png`);

// favicon.ico: a single 32px PNG wrapped in an ICO container
const png32 = await square(32, 0.02).toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6); header.writeUInt8(32, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png32.length, 14); header.writeUInt32LE(22, 18);
await writeFile(`${OUT}/favicon.ico`, Buffer.concat([header, png32]));

// SVG favicon embedding a 64px PNG (keeps the real logo, scales crisply enough at tab size)
const png64 = await square(64, 0.02).toBuffer();
await writeFile(
  `${OUT}/icon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${png64.toString('base64')}"/></svg>\n`,
);

// Open Graph image, 1200×630
const logo = await sharp(LOGO).resize(220, 220, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <filter id="b"><feGaussianBlur stdDeviation="60"/></filter>
  </defs>
  <rect width="1200" height="630" fill="#ffffff"/>
  <g filter="url(#b)" opacity="0.6">
    <ellipse cx="150" cy="40" rx="380" ry="180" fill="#f5e9d4"/>
    <ellipse cx="620" cy="0" rx="320" ry="170" fill="#ffc7a6"/>
    <ellipse cx="1020" cy="20" rx="360" ry="200" fill="#b9b9f9"/>
  </g>
  <rect x="80" y="80" width="260" height="260" rx="36" fill="#ffffff" stroke="#e3e8ee" stroke-width="2"/>
  <text x="80" y="440" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="68" font-weight="300" fill="#0d253d" letter-spacing="-2">Ashiyana Real Estate</text>
  <text x="80" y="510" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="34" font-weight="300" fill="#5b6b82">Property consultants in Kothrud, Pune · 30+ years</text>
  <rect x="80" y="550" width="300" height="6" rx="3" fill="#533afd"/>
</svg>`;
await sharp(Buffer.from(svg)).composite([{ input: logo, left: 100, top: 100 }]).png().toFile(`${OUT}/og-image.png`);

console.log('icons written');
