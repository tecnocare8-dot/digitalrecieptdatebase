// 「デジタル経費記録」のアイコン一式を1つのデザインから作る。
//   node scripts/generate-icons.mjs
// デザイン: 藍〜青のグラデーションに白いレシート、右下に金色の「¥」バッジ（経費の記録）
import sharp from 'sharp';
import fs from 'fs';

/**
 * @param {{ rounded: boolean, scale: number }} o
 *   rounded: 角丸の背景（ブラウザのタブ・Android用）。false は四角いまま（iPhone は自分で角を丸めるため）
 *   scale:   絵柄の大きさ。スマホが円形などに切り抜く「maskable」用は小さめにして欠けないようにする
 */
function iconSvg({ rounded, scale }) {
  const t = (1 - scale) * 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4338CA"/>
      <stop offset="1" stop-color="#0284C7"/>
    </linearGradient>
    <linearGradient id="coin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FCD34D"/>
      <stop offset="1" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <circle cx="96" cy="72" r="220" fill="#FFFFFF" opacity="0.07"/>
  <g transform="translate(${t} ${t}) scale(${scale})">
    <!-- レシート（下端はギザギザ） -->
    <path d="M150 104 Q150 86 168 86 L344 86 Q362 86 362 104 L362 404
             L335 386 L308 404 L281 386 L256 404 L229 386 L202 404 L175 386 L150 404 Z"
          fill="#FFFFFF"/>
    <rect x="186" y="138" width="140" height="18" rx="9" fill="#4338CA"/>
    <rect x="186" y="190" width="104" height="14" rx="7" fill="#C7D2FE"/>
    <rect x="186" y="228" width="124" height="14" rx="7" fill="#C7D2FE"/>
    <rect x="186" y="266" width="84" height="14" rx="7" fill="#C7D2FE"/>
    <!-- ¥ バッジ -->
    <circle cx="352" cy="368" r="84" fill="#0F172A" opacity="0.18"/>
    <circle cx="346" cy="360" r="80" fill="url(#coin)" stroke="#FFFFFF" stroke-width="12"/>
    <g stroke="#FFFFFF" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M314 318 L346 360 L378 318"/>
      <path d="M346 360 L346 406"/>
      <path d="M322 368 L370 368"/>
      <path d="M322 392 L370 392"/>
    </g>
  </g>
</svg>`;
}

/** PNGを1枚ずつ入れた .ico（最近のブラウザはICO内のPNGに対応） */
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();

const standard = iconSvg({ rounded: true, scale: 1 });
const fullBleed = iconSvg({ rounded: false, scale: 1 });
const maskable = iconSvg({ rounded: false, scale: 0.72 });

fs.writeFileSync('app/icon.svg', standard);
fs.writeFileSync('app/apple-icon.png', await png(fullBleed, 180));
fs.writeFileSync('app/favicon.ico', icoFromPngs(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(standard, size) })))));
fs.mkdirSync('public/icons', { recursive: true });
fs.writeFileSync('public/icons/icon-192.png', await png(standard, 192));
fs.writeFileSync('public/icons/icon-512.png', await png(standard, 512));
fs.writeFileSync('public/icons/maskable-512.png', await png(maskable, 512));
console.log('icons generated');
