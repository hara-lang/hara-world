import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const output = path.resolve("public/og-hara-world.jpg");
await mkdir(path.dirname(output), { recursive: true });

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2016" viewBox="0 0 2400 1260">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050608"/>
      <stop offset="0.58" stop-color="#11151a"/>
      <stop offset="1" stop-color="#080a0d"/>
    </linearGradient>
    <radialGradient id="signal" cx="74%" cy="28%" r="48%">
      <stop offset="0" stop-color="#2f7cff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#2f7cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="2400" height="1260" fill="url(#field)"/>
  <rect width="2400" height="1260" fill="url(#signal)"/>
  <path d="M0 1060H2400M280 0V1260M2120 0V1260" stroke="#dfe7f0" stroke-opacity="0.10"/>
  <path d="M1570 -140 2240 540 1560 1220 890 540Z" fill="none" stroke="#dfe7f0" stroke-opacity="0.12" stroke-width="2"/>
  <path d="M1760 10 2220 470 1760 930 1300 470Z" fill="none" stroke="#2f7cff" stroke-opacity="0.42" stroke-width="3"/>
  <rect x="280" y="220" width="132" height="132" rx="26" fill="#080a0d" stroke="#dfe7f0" stroke-opacity="0.18"/>
  <path fill="#f4f6f8" d="M302 242h27v37h38v-37h27v99h-27v-37h-38v37h-27z"/>
  <path fill="#2f7cff" d="M338 242h20v20h-20z"/>
  <text x="280" y="515" fill="#f4f6f8" font-family="Arial, Helvetica, sans-serif" font-size="174" font-weight="650" letter-spacing="-8">Hara World</text>
  <text x="290" y="635" fill="#a0a8b1" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="400">Dispatches from a programmable world.</text>
  <text x="290" y="1010" fill="#8db2ff" font-family="monospace" font-size="30" letter-spacing="8">WEB / RSS / MAIL / MOTION</text>
</svg>`;

await sharp(Buffer.from(svg))
  .jpeg({ quality: 90, progressive: true, chromaSubsampling: "4:4:4" })
  .toFile(output);

console.log(`Built ${output}`);
