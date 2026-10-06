import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const __dirname = path.dirname(scriptDir);

// CRC32 implementation
function makeCrcTable() {
  const cTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    cTable[n] = c;
  }
  return cTable;
}

const crcTable = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([typeBuf, data]);
  const crc = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, body, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const scanlines = [];
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(1 + width * 4);
    line[0] = 0; // Filter: None
    const offset = y * width * 4;
    rgbaBuffer.copy(line, 1, offset, offset + width * 4);
    scanlines.push(line);
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdrChunk = createPngChunk('IHDR', ihdrData);
  const idatChunk = createPngChunk('IDAT', compressed);
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Distance from point (px, py) to segment (ax, ay)-(bx, by)
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

// Cubic bezier sampler
function sampleCubicBezier(p0, p1, p2, p3, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    pts.push({ x, y });
  }
  return pts;
}

// Convert SVG polyline segments
function polylineToSegments(pts, width) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({
      ax: pts[i].x,
      ay: pts[i].y,
      bx: pts[i + 1].x,
      by: pts[i + 1].y,
      w: width,
    });
  }
  return segs;
}

// Build all strokes of the Lira in coordinate space (0..100)
function buildLyreModel() {
  const segments = [];

  // 1. Crossbar (Yoke)
  segments.push({ ax: 28, ay: 28, bx: 72, by: 28, w: 6.0 });

  // 2. Left arm
  // d="M 31 28 C 21 28 16 17 24 13 C 30 10 36 17 31 28 C 23 45 22 61 40 73"
  const left1 = sampleCubicBezier({ x: 31, y: 28 }, { x: 21, y: 28 }, { x: 16, y: 17 }, { x: 24, y: 13 }, 25);
  const left2 = sampleCubicBezier({ x: 24, y: 13 }, { x: 30, y: 10 }, { x: 36, y: 17 }, { x: 31, y: 28 }, 25);
  const left3 = sampleCubicBezier({ x: 31, y: 28 }, { x: 23, y: 45 }, { x: 22, y: 61 }, { x: 40, y: 73 }, 35);
  segments.push(...polylineToSegments(left1, 5.5));
  segments.push(...polylineToSegments(left2, 5.5));
  segments.push(...polylineToSegments(left3, 5.5));

  // 3. Right arm
  // d="M 69 28 C 79 28 84 17 76 13 C 70 10 64 17 69 28 C 77 45 78 61 60 73"
  const right1 = sampleCubicBezier({ x: 69, y: 28 }, { x: 79, y: 28 }, { x: 84, y: 17 }, { x: 76, y: 13 }, 25);
  const right2 = sampleCubicBezier({ x: 76, y: 13 }, { x: 70, y: 10 }, { x: 64, y: 17 }, { x: 69, y: 28 }, 25);
  const right3 = sampleCubicBezier({ x: 69, y: 28 }, { x: 77, y: 45 }, { x: 78, y: 61 }, { x: 60, y: 73 }, 35);
  segments.push(...polylineToSegments(right1, 5.5));
  segments.push(...polylineToSegments(right2, 5.5));
  segments.push(...polylineToSegments(right3, 5.5));

  // 4. Base outline
  // M 37 72 L 63 72 L 68 85 L 32 85 Z
  segments.push({ ax: 37, ay: 72, bx: 63, by: 72, w: 4.0 });
  segments.push({ ax: 63, ay: 72, bx: 68, by: 85, w: 4.0 });
  segments.push({ ax: 68, ay: 85, bx: 32, by: 85, w: 4.0 });
  segments.push({ ax: 32, ay: 85, bx: 37, by: 72, w: 4.0 });

  // 5. Base foot line
  segments.push({ ax: 30, ay: 85, bx: 70, by: 85, w: 5.0 });

  // 6. Strings
  segments.push({ ax: 39, ay: 29, bx: 39, by: 72, w: 2.8 });
  segments.push({ ax: 46, ay: 29, bx: 46, by: 72, w: 2.8 });
  segments.push({ ax: 54, ay: 29, bx: 54, by: 72, w: 2.8 });
  segments.push({ ax: 61, ay: 29, bx: 61, by: 72, w: 2.8 });

  // Circles
  const circles = [
    { cx: 28, cy: 28, r: 3.5 },
    { cx: 72, cy: 28, r: 3.5 },
  ];

  // Base trapezoid polygon points
  const basePoly = [
    { x: 37, y: 72 },
    { x: 63, y: 72 },
    { x: 68, y: 85 },
    { x: 32, y: 85 },
  ];

  return { segments, circles, basePoly };
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const LYRE = buildLyreModel();

/**
 * Render Lira Icon into an RGBA Buffer.
 * @param {number} size - Width and height in px
 * @param {object} options - { background: 'none' | 'gradient' | 'circle' | 'squircle', lyreScale: number }
 */
function renderLyreIcon(size, options = {}) {
  const {
    background = 'gradient',
    lyreScale = 0.68,
    borderRadius = 0.22,
  } = options;

  const buf = Buffer.alloc(size * size * 4);

  // Transform matrix from SVG (0..100) to Icon (0..size)
  // Centered in (size/2, size/2)
  const centerX = size / 2;
  const centerY = size / 2;
  const scale = (size / 100) * lyreScale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Coordinate in lyre SVG space
      const svgX = (x - centerX) / scale + 50;
      const svgY = (y - centerY) / scale + 50;

      // Background calculation
      let bgR = 0, bgG = 0, bgB = 0, bgA = 0;

      if (background === 'none') {
        bgA = 0;
      } else if (background === 'circle') {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.hypot(dx, dy);
        const radius = size * 0.48;
        if (dist <= radius) {
          // Deep navy / indigo gradient
          const t = (x + y) / (size * 2);
          bgR = Math.round(18 + t * 24);
          bgG = Math.round(24 + t * 20);
          bgB = Math.round(42 + t * 50);
          bgA = 255;
        } else if (dist <= radius + 1) {
          const alpha = Math.max(0, 1 - (dist - radius));
          bgR = 24; bgG = 30; bgB = 52;
          bgA = Math.round(alpha * 255);
        }
      } else if (background === 'squircle' || background === 'gradient') {
        const rad = Math.floor(size * borderRadius);
        const dx = Math.max(0, Math.max(rad - x, x - (size - 1 - rad)));
        const dy = Math.max(0, Math.max(rad - y, y - (size - 1 - rad)));
        const distSq = dx * dx + dy * dy;
        const isInside = distSq <= rad * rad;

        if (isInside) {
          // Lira themed deep indigo/slate background with subtle radial glow
          const t = (x + y) / (size * 2);
          bgR = Math.round(15 * (1 - t) + 30 * t);
          bgG = Math.round(20 * (1 - t) + 38 * t);
          bgB = Math.round(35 * (1 - t) + 75 * t);
          bgA = 255;
        }
      }

      // Check Lyre elements
      let minStrokeDist = Infinity;
      for (let s = 0; s < LYRE.segments.length; s++) {
        const seg = LYRE.segments[s];
        const d = distToSegment(svgX, svgY, seg.ax, seg.ay, seg.bx, seg.by);
        // Normalize by stroke width
        const effDist = d - (seg.w / 2);
        if (effDist < minStrokeDist) {
          minStrokeDist = effDist;
        }
      }

      for (let c = 0; c < LYRE.circles.length; c++) {
        const cir = LYRE.circles[c];
        const d = Math.hypot(svgX - cir.cx, svgY - cir.cy) - cir.r;
        if (d < minStrokeDist) {
          minStrokeDist = d;
        }
      }

      // Base trapezoid fill
      const inBasePoly = pointInPolygon(svgX, svgY, LYRE.basePoly);

      // Convert distance to pixel space for antialiasing
      const pixelDist = minStrokeDist * scale;
      const antialiasWidth = 0.8;
      let strokeAlpha = 0;

      if (pixelDist <= -antialiasWidth) {
        strokeAlpha = 1;
      } else if (pixelDist < antialiasWidth) {
        strokeAlpha = 0.5 - (pixelDist / (2 * antialiasWidth));
      }

      let fillAlpha = inBasePoly ? 0.25 : 0;
      let finalAlpha = Math.max(strokeAlpha, fillAlpha);

      // Composite stroke (white #FFFFFF) over background
      if (finalAlpha > 0) {
        const fgR = 255, fgG = 255, fgB = 255;
        const a = finalAlpha;
        const outA = bgA / 255 + a * (1 - bgA / 255);
        if (outA > 0) {
          const r = (fgR * a + bgR * (bgA / 255) * (1 - a)) / outA;
          const g = (fgG * a + bgG * (bgA / 255) * (1 - a)) / outA;
          const b = (fgB * a + bgB * (bgA / 255) * (1 - a)) / outA;
          buf[idx] = Math.round(r);
          buf[idx + 1] = Math.round(g);
          buf[idx + 2] = Math.round(b);
          buf[idx + 3] = Math.round(outA * 255);
        }
      } else {
        buf[idx] = bgR;
        buf[idx + 1] = bgG;
        buf[idx + 2] = bgB;
        buf[idx + 3] = bgA;
      }
    }
  }

  return encodePng(size, size, buf);
}

// 1. Generate XML Drawables
const resDir = path.resolve(__dirname, 'android/app/src/main/res');

const foregroundXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:translateX="19"
        android:translateY="19"
        android:scaleX="0.7"
        android:scaleY="0.7">
        <!-- Crossbar (Yoke) -->
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="6"
            android:strokeLineCap="round"
            android:pathData="M28,28 L72,28" />
        <!-- Crossbar Tips Circles -->
        <path
            android:fillColor="#FFFFFF"
            android:pathData="M 28 24.5 A 3.5 3.5 0 1 1 27.99 24.5 Z" />
        <path
            android:fillColor="#FFFFFF"
            android:pathData="M 72 24.5 A 3.5 3.5 0 1 1 71.99 24.5 Z" />
        <!-- Left curved arm -->
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="5.5"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:fillColor="#00000000"
            android:pathData="M 31,28 C 21,28 16,17 24,13 C 30,10 36,17 31,28 C 23,45 22,61 40,73" />
        <!-- Right curved arm -->
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="5.5"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:fillColor="#00000000"
            android:pathData="M 69,28 C 79,28 84,17 76,13 C 70,10 64,17 69,28 C 77,45 78,61 60,73" />
        <!-- Base Soundbox / Pedestal -->
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="4"
            android:strokeLineJoin="round"
            android:fillColor="#40FFFFFF"
            android:pathData="M 37,72 L 63,72 L 68,85 L 32,85 Z" />
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="5"
            android:strokeLineCap="round"
            android:pathData="M 30,85 L 70,85" />
        <!-- Vertical Lyre Strings -->
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="2.8"
            android:strokeLineCap="round"
            android:strokeAlpha="0.95"
            android:pathData="M 39,29 L 39,72 M 46,29 L 46,72 M 54,29 L 54,72 M 61,29 L 61,72" />
    </group>
</vector>
`;

const backgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#111520"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`;

const colorBackgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#111520</color>
</resources>
`;

const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
`;

// Save XMLs
fs.writeFileSync(path.join(resDir, 'drawable/ic_launcher_foreground.xml'), foregroundXml);
fs.writeFileSync(path.join(resDir, 'drawable-v24/ic_launcher_foreground.xml'), foregroundXml);
fs.writeFileSync(path.join(resDir, 'drawable/ic_launcher_background.xml'), backgroundXml);
fs.writeFileSync(path.join(resDir, 'values/ic_launcher_background.xml'), colorBackgroundXml);
fs.writeFileSync(path.join(resDir, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptiveIconXml);
fs.writeFileSync(path.join(resDir, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptiveIconXml);
console.log('Vector XML files created.');

// 2. Generate PNGs for each density
const densities = [
  { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
  { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
  { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
  { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
  { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 },
];

for (const d of densities) {
  const targetDir = path.join(resDir, d.dir);
  fs.mkdirSync(targetDir, { recursive: true });

  const iconPng = renderLyreIcon(d.iconSize, { background: 'gradient' });
  const roundIconPng = renderLyreIcon(d.iconSize, { background: 'circle' });
  const fgIconPng = renderLyreIcon(d.fgSize, { background: 'none', lyreScale: 0.70 });

  fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), iconPng);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), roundIconPng);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_foreground.png'), fgIconPng);
  console.log(`Generated ${d.dir} PNGs`);
}

// 3. Generate Web & Desktop PNGs
const publicDir = path.resolve(__dirname, 'public');
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, 'icon.png'), renderLyreIcon(256, { background: 'gradient' }));
fs.writeFileSync(path.join(publicDir, 'tray-icon.png'), renderLyreIcon(32, { background: 'none', lyreScale: 0.9 }));
fs.writeFileSync(path.join(publicDir, 'tray-icon-16.png'), renderLyreIcon(16, { background: 'none', lyreScale: 0.9 }));

const electronRes = path.resolve(__dirname, 'electron/resources');
fs.mkdirSync(electronRes, { recursive: true });
fs.writeFileSync(path.join(electronRes, 'icon.png'), renderLyreIcon(256, { background: 'gradient' }));
fs.writeFileSync(path.join(electronRes, 'tray-icon.png'), renderLyreIcon(32, { background: 'none', lyreScale: 0.9 }));

console.log('All Lira icons generated successfully!');
