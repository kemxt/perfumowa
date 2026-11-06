#!/usr/bin/env node
/**
 * Generuje brakujące placeholdery dla produktów z src/data/products.json:
 *
 *   public/assets/bottles/{slug}.svg     flakon BEZ etykiety (przezroczyste tło, 800×1200)
 *   public/assets/labels/{slug}.svg      rozwinięta etykieta: cały obwód minus GAP
 *   public/assets/gallery/{slug}-{n}.svg zdjęcia do galerii
 *
 * Geometria flakonu i proporcje etykiety wynikają z labelConfig produktu
 * (CYL_TOP / CYL_BOT / CYL_WIDTH / GAP), więc placeholder od razu pasuje do efektu 3D.
 *
 * Istniejących plików nie nadpisuje – użyj --force, żeby wygenerować wszystko od nowa.
 * Tekst zamieniany jest na ścieżki (opentype.js): SVG wczytany jako <img> lub tekstura
 * nie ma dostępu do web fontów strony.
 *
 * opentype.js i fonty (devDependencies) ładujemy tylko, gdy czegoś brakuje – build
 * w CI z kompletem plików w repo nie potrzebuje ich wcale.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');

const IMG_W = 800;
const IMG_H = 1200;
const GALLERY_W = 1200;
const GALLERY_H = 1500;

/** Proporcje flakonów (px w obrazie 800×1200). Szerokość korpusu pochodzi z CYL_WIDTH. */
const SHAPES = {
  classic: { shoulderY: 430, bottomY: 1100, shoulderR: 46, neckW: 118, neckTop: 372, collarH: 16, capTop: 178, capW: 232, capR: 14, fill: 0.12 },
  tall: { shoulderY: 398, bottomY: 1110, shoulderR: 34, neckW: 92, neckTop: 344, collarH: 14, capTop: 168, capW: 168, capR: 12, fill: 0.1 },
  squat: { shoulderY: 560, bottomY: 1082, shoulderR: 62, neckW: 140, neckTop: 500, collarH: 18, capTop: 318, capW: 286, capR: 16, fill: 0.16 },
};

const INCI =
  'ALCOHOL DENAT., PARFUM (FRAGRANCE), AQUA (WATER), LINALOOL, LIMONENE, CITRAL, GERANIOL, COUMARIN, BENZYL BENZOATE, CITRONELLOL.';

// ---------------------------------------------------------------------------
// Fonty i tekst → ścieżki
// ---------------------------------------------------------------------------

async function loadFamily(opentype, pkg, weight, style = 'normal') {
  // Fontsource dzieli fonty na subsety; polskie znaki (ą, ę, ł…) są w latin-ext.
  const fonts = [];
  for (const subset of ['latin', 'latin-ext']) {
    const file = path.join(ROOT, 'node_modules/@fontsource', pkg, 'files', `${pkg}-${subset}-${weight}-${style}.woff`);
    const buf = await readFile(file);
    fonts.push(opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return fonts;
}

/** Uzupełniane przez loadFonts() tuż przed pierwszym generowanym plikiem. */
const FONTS = {};

async function loadFonts() {
  const { default: opentype } = await import('opentype.js');
  Object.assign(FONTS, {
    serif: await loadFamily(opentype, 'cormorant-garamond', 500),
    serifItalic: await loadFamily(opentype, 'cormorant-garamond', 500, 'italic'),
    sans: await loadFamily(opentype, 'jost', 400),
    sansMedium: await loadFamily(opentype, 'jost', 500),
  });
}

function layoutText(fonts, text, size, tracking = 0) {
  const glyphs = [];
  let x = 0;
  let prev = null;
  for (const ch of text) {
    const font = fonts.find((f) => f.charToGlyphIndex(ch) > 0) ?? fonts[0];
    const glyph = font.charToGlyph(ch);
    const scale = size / font.unitsPerEm;
    if (prev && prev.font === font) x += font.getKerningValue(prev.glyph, glyph) * scale;
    glyphs.push({ glyph, x, size });
    x += glyph.advanceWidth * scale + tracking;
    prev = { font, glyph };
  }
  return { glyphs, width: Math.max(0, x - tracking) };
}

function measure(fonts, text, size, trackingEm = 0) {
  return layoutText(fonts, text, size, size * trackingEm).width;
}

/** Zwraca dane `d` ścieżki dla tekstu. anchor: start | middle | end. */
function textPath(fonts, text, { x, y, size, anchor = 'start', tracking = 0 }) {
  const { glyphs, width } = layoutText(fonts, text, size, size * tracking);
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const d = glyphs.map((g) => g.glyph.getPath(x0 + g.x, y, g.size).toPathData(1)).join('');
  if (d.includes('NaN')) throw new Error(`Uszkodzona ścieżka glifu w tekście "${text}" (sprawdź wersję opentype.js)`);
  return d;
}

/** Największy rozmiar ≤ maxSize, przy którym tekst mieści się w maxWidth. */
function fitSize(fonts, text, maxWidth, maxSize, trackingEm = 0) {
  const w = measure(fonts, text, maxSize, trackingEm);
  return w <= maxWidth ? maxSize : Math.floor((maxSize * maxWidth) / w);
}

function wrapText(fonts, text, size, maxWidth, trackingEm = 0) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(fonts, next, size, trackingEm) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const upper = (s) => s.toLocaleUpperCase('pl');

// ---------------------------------------------------------------------------
// Kolory
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}
function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.map((c, i) => c + (cb[i] - c) * t));
}
const lighten = (c, t) => mix(c, '#ffffff', t);
const darken = (c, t) => mix(c, '#000000', t);
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

const n = (v) => +v.toFixed(2);
const deg = (d) => (d * Math.PI) / 180;

function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stops(list) {
  return list
    .map(([offset, color, opacity = 1]) => `<stop offset="${offset}" stop-color="${color}"${opacity < 1 ? ` stop-opacity="${opacity}"` : ''}/>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Flakon
// ---------------------------------------------------------------------------

function bottleGeometry(product, defaults) {
  const cfg = { ...defaults, ...product.labelConfig };
  const shape = SHAPES[product.placeholder?.shape] ?? SHAPES.classic;
  const D = cfg.CYL_WIDTH * IMG_W;
  const cx = cfg.CYL_X * IMG_W;
  const r = D / 2;
  // Ten sam widok "lekko z góry" co TILT w scenie Three.js → zgodne elipsy.
  const tilt = Math.sin(deg(cfg.TILT)) * cfg.CURV;
  return {
    cfg, shape, D, cx, r, tilt,
    L: cx - r,
    R: cx + r,
    sag: r * tilt,
    labelTop: cfg.CYL_TOP * IMG_H,
    labelBot: cfg.CYL_BOT * IMG_H,
  };
}

/** Zwraca { defs, body } – osobno, żeby galeria mogła osadzić flakon w swojej scenie. */
function bottleParts(product, defaults, id = 'b') {
  const g = bottleGeometry(product, defaults);
  const { shape, D, cx, r, L, R, sag, tilt } = g;
  const { liquid, cap } = product.palette;
  const capStyle = product.placeholder?.cap ?? 'block';
  const { shoulderY: sy, bottomY: by, shoulderR: sr, neckW, neckTop, collarH, capTop, capR } = shape;
  // Kopułka jest optycznie cięższa od bloku – węższa wygląda lepiej.
  const capW = capStyle === 'dome' ? Math.min(shape.capW, neckW * 1.65) : shape.capW;

  const glassEdge = mix(liquid, '#2b2622', 0.55);
  const shadow = darken(product.palette.bg, 0.7);
  const wall = Math.max(10, D * 0.035);
  const ri = r - wall;
  const sagI = ri * tilt;
  const baseH = D * 0.11;
  const liquidTop = sy + (by - sy) * shape.fill;
  const liquidBot = by - baseH;
  const sagTop = (r - sr) * tilt;
  const capBot = neckTop - collarH;
  const capX0 = cx - capW / 2;
  const capX1 = cx + capW / 2;
  const sagCap = (capW / 2) * tilt;

  const defs = `
    <linearGradient id="${id}-glass" x1="0" x2="1" y1="0" y2="0">${stops([
      [0, glassEdge, 0.6], [0.07, lighten(liquid, 0.3), 0.3], [0.35, '#ffffff', 0.14], [0.68, '#ffffff', 0.06], [0.93, liquid, 0.35], [1, glassEdge, 0.65],
    ])}</linearGradient>
    <linearGradient id="${id}-liquid" x1="0" x2="1" y1="0" y2="0">${stops([
      [0, darken(liquid, 0.38), 0.95], [0.16, liquid, 0.9], [0.42, lighten(liquid, 0.28), 0.85], [0.78, liquid, 0.9], [1, darken(liquid, 0.42), 0.95],
    ])}</linearGradient>
    <linearGradient id="${id}-liquidv" x1="0" x2="0" y1="0" y2="1">${stops([
      [0, '#ffffff', 0.18], [0.5, '#ffffff', 0], [1, '#000000', 0.18],
    ])}</linearGradient>
    <linearGradient id="${id}-hl" x1="0" x2="0" y1="0" y2="1">${stops([
      [0, '#ffffff', 0], [0.1, '#ffffff', 0.85], [0.8, '#ffffff', 0.55], [1, '#ffffff', 0],
    ])}</linearGradient>
    <linearGradient id="${id}-cap" x1="0" x2="1" y1="0" y2="0">${stops([
      [0, darken(cap, 0.38)], [0.2, lighten(cap, 0.2)], [0.42, cap], [0.84, darken(cap, 0.18)], [1, darken(cap, 0.42)],
    ])}</linearGradient>
    <linearGradient id="${id}-metal" x1="0" x2="1" y1="0" y2="0">${stops([
      [0, '#7d5f33'], [0.25, '#f2deb0'], [0.5, '#b8945a'], [0.8, '#e6cf98'], [1, '#6e5229'],
    ])}</linearGradient>
    <filter id="${id}-blur-lg" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="${id}-blur-sm" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="${id}-soft" x="-50%" y="-5%" width="200%" height="110%"><feGaussianBlur stdDeviation="1.6"/></filter>`;

  const bodyPath = `M${n(L)} ${n(sy + sr)}Q${n(L)} ${sy} ${n(L + sr)} ${sy}A${n(r - sr)} ${n(sagTop)} 0 0 1 ${n(R - sr)} ${sy}Q${n(R)} ${sy} ${n(R)} ${n(sy + sr)}L${n(R)} ${by}A${n(r)} ${n(sag)} 0 0 1 ${n(L)} ${by}Z`;
  const liquidPath = `M${n(L + wall)} ${n(liquidTop)}A${n(ri)} ${n(sagI)} 0 0 1 ${n(R - wall)} ${n(liquidTop)}L${n(R - wall)} ${n(liquidBot)}A${n(ri)} ${n(sagI)} 0 0 1 ${n(L + wall)} ${n(liquidBot)}Z`;

  const capPath =
    capStyle === 'dome'
      ? (() => {
          const domeH = capW * 0.42;
          return `M${n(capX0)} ${n(capBot)}L${n(capX0)} ${n(capTop + domeH)}A${n(capW / 2)} ${n(domeH)} 0 0 1 ${n(capX1)} ${n(capTop + domeH)}L${n(capX1)} ${n(capBot)}A${n(capW / 2)} ${n(sagCap)} 0 0 1 ${n(capX0)} ${n(capBot)}Z`;
        })()
      : `M${n(capX0)} ${n(capTop + capR)}Q${n(capX0)} ${capTop} ${n(capX0 + capR)} ${capTop}A${n(capW / 2 - capR)} ${n(sagCap)} 0 0 1 ${n(capX1 - capR)} ${capTop}Q${n(capX1)} ${capTop} ${n(capX1)} ${n(capTop + capR)}L${n(capX1)} ${n(capBot)}A${n(capW / 2)} ${n(sagCap)} 0 0 1 ${n(capX0)} ${n(capBot)}Z`;
  const capTopFace =
    capStyle === 'dome'
      ? `<ellipse cx="${n(cx - capW * 0.16)}" cy="${n(capTop + capW * 0.2)}" rx="${n(capW * 0.12)}" ry="${n(capW * 0.06)}" fill="#ffffff" opacity="0.22" filter="url(#${id}-soft)"/>`
      : `<ellipse cx="${n(cx)}" cy="${capTop}" rx="${n(capW / 2 - capR)}" ry="${n(sagCap)}" fill="${lighten(cap, 0.25)}" opacity="0.9"/>`;

  const hlTop = sy + sr * 0.8;
  const hlBot = by - D * 0.06;

  const body = `
  <ellipse cx="${n(cx)}" cy="${n(by + sag + 10)}" rx="${n(r * 1.25)}" ry="${n(18 + sag)}" fill="${shadow}" opacity="0.26" filter="url(#${id}-blur-lg)"/>
  <ellipse cx="${n(cx)}" cy="${n(by + sag * 0.7)}" rx="${n(r * 0.98)}" ry="${n(sag + 3)}" fill="${shadow}" opacity="0.38" filter="url(#${id}-blur-sm)"/>
  <rect x="${n(cx - neckW / 2)}" y="${neckTop}" width="${neckW}" height="${n(sy - neckTop)}" fill="url(#${id}-glass)"/>
  <path d="${bodyPath}" fill="url(#${id}-glass)"/>
  <path d="${liquidPath}" fill="url(#${id}-liquid)"/>
  <path d="${liquidPath}" fill="url(#${id}-liquidv)"/>
  <ellipse cx="${n(cx)}" cy="${n(liquidTop)}" rx="${n(ri)}" ry="${n(sagI)}" fill="${lighten(liquid, 0.35)}" opacity="0.75"/>
  <path d="M${n(L + wall)} ${n(liquidBot)}A${n(ri)} ${n(sagI)} 0 0 0 ${n(R - wall)} ${n(liquidBot)}" fill="none" stroke="${darken(liquid, 0.3)}" stroke-width="2" opacity="0.35"/>
  <ellipse cx="${n(cx)}" cy="${n(by - baseH * 0.45)}" rx="${n(ri * 0.9)}" ry="${n(sagI + 4)}" fill="#ffffff" opacity="0.22" filter="url(#${id}-blur-sm)"/>
  <ellipse cx="${n(cx)}" cy="${sy}" rx="${n(r - sr)}" ry="${n(sagTop)}" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.45" stroke-width="1.5"/>
  <ellipse cx="${n(cx)}" cy="${sy}" rx="${n(neckW / 2)}" ry="${n((neckW / 2) * tilt)}" fill="${glassEdge}" opacity="0.18"/>
  <rect x="${n(L + D * 0.085)}" y="${n(hlTop)}" width="${n(D * 0.045)}" height="${n(hlBot - hlTop)}" rx="${n(D * 0.02)}" fill="url(#${id}-hl)" opacity="0.85" filter="url(#${id}-soft)"/>
  <rect x="${n(L + D * 0.155)}" y="${n(hlTop + 20)}" width="3" height="${n(hlBot - hlTop - 40)}" fill="url(#${id}-hl)" opacity="0.4"/>
  <rect x="${n(R - D * 0.075)}" y="${n(hlTop + 10)}" width="${n(D * 0.022)}" height="${n(hlBot - hlTop - 20)}" fill="url(#${id}-hl)" opacity="0.45" filter="url(#${id}-soft)"/>
  <line x1="${n(L + wall)}" y1="${n(sy + sr)}" x2="${n(L + wall)}" y2="${n(by - 6)}" stroke="${glassEdge}" stroke-opacity="0.22" stroke-width="1.5"/>
  <line x1="${n(R - wall)}" y1="${n(sy + sr)}" x2="${n(R - wall)}" y2="${n(by - 6)}" stroke="${glassEdge}" stroke-opacity="0.22" stroke-width="1.5"/>
  <path d="${bodyPath}" fill="none" stroke="${glassEdge}" stroke-opacity="0.5" stroke-width="2"/>
  <rect x="${n(cx - neckW / 2 - 10)}" y="${n(neckTop - collarH)}" width="${n(neckW + 20)}" height="${n(collarH + 2)}" rx="3" fill="url(#${id}-metal)"/>
  <path d="${capPath}" fill="url(#${id}-cap)"/>
  ${capTopFace}
  <path d="M${n(capX0 + 2)} ${n(capBot)}A${n(capW / 2 - 2)} ${n(sagCap)} 0 0 0 ${n(capX1 - 2)} ${n(capBot)}" fill="none" stroke="${darken(cap, 0.45)}" stroke-width="2" opacity="0.6"/>`;

  return { defs, body, geometry: g };
}

function bottleSVG(product, defaults) {
  const { defs, body } = bottleParts(product, defaults);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMG_W}" height="${IMG_H}" viewBox="0 0 ${IMG_W} ${IMG_H}">
  <title>${product.name} – flakon (placeholder)</title>
  <defs>${defs}</defs>${body}
</svg>
`;
}

// ---------------------------------------------------------------------------
// Etykieta
// ---------------------------------------------------------------------------

function labelSVG(product, defaults) {
  const { cfg, D } = bottleGeometry(product, defaults);
  const labelH = (cfg.CYL_BOT - cfg.CYL_TOP) * IMG_H;
  const span = 1 - cfg.GAP;
  // Szerokość = długość łuku (obwód × (1 − GAP)) w tej samej skali co wysokość → brak rozciągnięcia.
  const H = 700;
  const W = Math.round((H * span * Math.PI * D) / labelH);
  const { paper, ink } = product.palette;
  const size = product.sizes.find((s) => s.ml === 50) ?? product.sizes[0];
  const dark = luminance(paper) < 0.2;

  const paths = [];
  const lines = [];
  const add = (d, opacity = 1) => paths.push(`<path d="${d}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`);
  const hline = (x1, x2, y, w) => lines.push(`<line x1="${n(x1)}" y1="${y}" x2="${n(x2)}" y2="${y}" stroke-width="${w}"/>`);
  const vline = (x, y1, y2, w) => lines.push(`<line x1="${n(x)}" y1="${y1}" x2="${n(x)}" y2="${y2}" stroke-width="${w}"/>`);

  // Podwójne linie przez całą szerokość (przy obrocie tworzą ciągły pas).
  hline(0, W, 40, 2);
  hline(0, W, 52, 1);
  hline(0, W, H - 52, 1);
  hline(0, W, H - 40, 2);

  // --- Front (środek etykiety, widoczny przy offset = 0)
  const fx = W / 2;
  const frontW = Math.min(W * 0.3, 760);
  vline(fx - frontW / 2 - 24, 84, H - 84, 1);
  vline(fx + frontW / 2 + 24, 84, H - 84, 1);

  const brand = 'PERFUMOWA AURA';
  add(textPath(FONTS.sansMedium, brand, { x: fx, y: 138, size: fitSize(FONTS.sansMedium, brand, frontW * 0.86, 26, 0.32), anchor: 'middle', tracking: 0.32 }));
  hline(fx - 64, fx - 16, 176, 1.2);
  hline(fx + 16, fx + 64, 176, 1.2);
  paths.push(`<rect x="${n(fx - 6)}" y="170" width="12" height="12" transform="rotate(45 ${n(fx)} 176)"/>`);

  const nameMax = frontW * 0.94;
  const words = product.name.split(' ');
  let nameLines = [product.name];
  let nameSize = fitSize(FONTS.serif, product.name, nameMax, 150);
  if (nameSize < 112 && words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const s = Math.min(...pair.map((l) => fitSize(FONTS.serif, l, nameMax, 132)));
      if (!best || s > best.s) best = { pair, s };
    }
    nameLines = best.pair;
    nameSize = best.s;
  }
  const nameCenter = (196 + (H - 196)) / 2 - 6;
  const lineH = nameSize * 0.92;
  const firstBaseline = nameCenter - ((nameLines.length - 1) * lineH) / 2 + nameSize * 0.3;
  nameLines.forEach((l, i) => add(textPath(FONTS.serif, l, { x: fx, y: n(firstBaseline + i * lineH), size: nameSize, anchor: 'middle' })));

  const conc = upper(product.concentration);
  add(textPath(FONTS.sans, conc, { x: fx, y: H - 156, size: fitSize(FONTS.sans, conc, frontW * 0.8, 23, 0.38), anchor: 'middle', tracking: 0.38 }));
  const vol = `${size.ml} ML · ${(size.ml / 29.57).toFixed(1)} FL.OZ`;
  add(textPath(FONTS.sans, vol, { x: fx, y: H - 112, size: 18, anchor: 'middle', tracking: 0.2 }), 0.8);

  // --- Panel nut (widoczny po ćwierć obrotu)
  const panelW = W * 0.16;
  const notesX = W * 0.885;
  const heading = 'Nuty';
  add(textPath(FONTS.serifItalic, heading, { x: notesX, y: 132, size: 44, anchor: 'middle' }));
  const tiers = [
    ['GŁOWA', product.notes.top],
    ['SERCE', product.notes.heart],
    ['BAZA', product.notes.base],
  ];
  const noteSize = Math.min(28, ...tiers.flatMap(([, list]) => list.map((t) => fitSize(FONTS.serif, t, panelW, 28))));
  let y = 196;
  for (const [title, list] of tiers) {
    add(textPath(FONTS.sansMedium, title, { x: notesX, y, size: 15, anchor: 'middle', tracking: 0.3 }), 0.75);
    y += noteSize * 1.25;
    for (const note of list) {
      add(textPath(FONTS.serif, note, { x: notesX, y: n(y), size: noteSize, anchor: 'middle' }));
      y += noteSize * 1.12;
    }
    y += 24;
  }

  // --- Panel informacyjny (po drugiej stronie przerwy)
  const infoX = W * 0.115;
  add(textPath(FONTS.serifItalic, 'Perfumowa Aura', { x: infoX, y: 130, size: fitSize(FONTS.serifItalic, 'Perfumowa Aura', panelW, 36), anchor: 'middle' }));
  const small = Math.min(14, fitSize(FONTS.sans, 'ALCOHOL DENAT., PARFUM', panelW, 14, 0.08));
  let iy = 176;
  for (const line of wrapText(FONTS.sans, INCI, small, panelW, 0.08)) {
    add(textPath(FONTS.sans, line, { x: infoX, y: iy, size: small, anchor: 'middle', tracking: 0.08 }), 0.8);
    iy += small * 1.55;
  }
  iy += 14;
  const lot = `LOT ${(hash(product.slug) % 9000) + 1000} · ${product.year}`;
  add(textPath(FONTS.sansMedium, lot, { x: infoX, y: n(iy), size: small, anchor: 'middle', tracking: 0.2 }), 0.8);
  iy += small * 1.7;
  add(textPath(FONTS.sans, 'WYPRODUKOWANO W POLSCE', { x: infoX, y: n(iy), size: Math.min(small, fitSize(FONTS.sans, 'WYPRODUKOWANO W POLSCE', panelW, 14, 0.12)), anchor: 'middle', tracking: 0.12 }), 0.8);

  // Kod kreskowy (deterministyczny dla sluga)
  const rand = rng(hash(product.slug));
  const bcW = Math.min(panelW * 0.8, 210);
  const bcTop = H - 186;
  const bcH = 74;
  let bx = infoX - bcW / 2;
  const bars = [];
  while (bx < infoX + bcW / 2 - 4) {
    const w = 1.5 + Math.floor(rand() * 4) * 1.5;
    bars.push(`<rect x="${n(bx)}" y="${bcTop}" width="${n(w)}" height="${bcH}"/>`);
    bx += w + 1.5 + Math.floor(rand() * 3) * 1.5;
  }
  paths.push(...bars);
  const code = `590${String(hash(product.name)).padStart(10, '0').slice(0, 10)}`;
  add(textPath(FONTS.sans, code, { x: infoX, y: bcTop + bcH + 22, size: 15, anchor: 'middle', tracking: 0.18 }), 0.85);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>${product.name} – etykieta (placeholder)</title>
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${hash(product.slug) % 100}" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="table" tableValues="0 ${dark ? 0.1 : 0.07}"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${paper}"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
  <g stroke="${ink}" opacity="0.85">${lines.join('')}</g>
  <g fill="${ink}">${paths.join('')}</g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------------

/** Ciemny motyw (np. Bursztynowa Noc): tło ciemniejsze niż tekst. */
const isDark = ({ bg, fg }) => luminance(bg) < luminance(fg);
/** Odcień tła „w głąb”: na jasnym tle ciemniej, na ciemnym jaśniej. */
const deepen = (palette, t) => (isDark(palette) ? lighten(palette.bg, t * 0.7) : darken(palette.bg, t));

function galleryStill(product, defaults) {
  const { bg, fg, paper, ink } = product.palette;
  const { defs, body, geometry } = bottleParts(product, defaults, 'g');
  const { L, R, cx, labelTop, labelBot, shape } = geometry;
  const s = 0.66;
  const plinthTop = 1086;
  const tx = GALLERY_W / 2 - cx * s;
  const ty = plinthTop + 6 - shape.bottomY * s;
  const name = product.name;
  const nameSize = fitSize(FONTS.serif, name, (R - L) * 0.6, 54);
  const brandSize = fitSize(FONTS.sansMedium, 'PERFUMOWA AURA', (R - L) * 0.5, 14, 0.3);
  const labelMid = (labelTop + labelBot) / 2;
  const stone = mix('#d9d3c8', bg, 0.18);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_W}" height="${GALLERY_H}" viewBox="0 0 ${GALLERY_W} ${GALLERY_H}">
  <defs>
    ${defs}
    <linearGradient id="bg" x1="0" x2="0" y1="0" y2="1">${stops([[0, lighten(bg, 0.1)], [1, bg]])}</linearGradient>
    <linearGradient id="stone" x1="0" x2="1" y1="0" y2="0">${stops([[0, darken(stone, 0.2)], [0.3, lighten(stone, 0.2)], [1, darken(stone, 0.25)]])}</linearGradient>
    <linearGradient id="labelShade" x1="0" x2="1" y1="0" y2="0">${stops([[0, '#000', 0.28], [0.25, '#fff', 0.08], [0.6, '#000', 0], [1, '#000', 0.4]])}</linearGradient>
    <filter id="shadow" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="24"/></filter>
  </defs>
  <rect width="${GALLERY_W}" height="${GALLERY_H}" fill="url(#bg)"/>
  <path d="M300 1500V560A300 300 0 0 1 900 560V1500Z" fill="${deepen(product.palette, 0.1)}"/>
  <rect y="1250" width="${GALLERY_W}" height="250" fill="${deepen(product.palette, 0.18)}"/>
  <ellipse cx="640" cy="1352" rx="300" ry="34" fill="${darken(bg, 0.65)}" opacity="0.3" filter="url(#shadow)"/>
  <rect x="380" y="${plinthTop}" width="440" height="262" fill="url(#stone)"/>
  <ellipse cx="600" cy="${plinthTop}" rx="220" ry="22" fill="${lighten(stone, 0.3)}"/>
  <g transform="translate(${n(tx)} ${n(ty)}) scale(${s})">
    ${body}
    <rect x="${n(L)}" y="${n(labelTop)}" width="${n(R - L)}" height="${n(labelBot - labelTop)}" fill="${paper}"/>
    <g fill="${ink}">
      <path d="${textPath(FONTS.sansMedium, 'PERFUMOWA AURA', { x: cx, y: n(labelTop + 46), size: brandSize, anchor: 'middle', tracking: 0.3 })}"/>
      <path d="${textPath(FONTS.serif, name, { x: cx, y: n(labelMid + nameSize * 0.3), size: nameSize, anchor: 'middle' })}"/>
    </g>
    <rect x="${n(L)}" y="${n(labelTop)}" width="${n(R - L)}" height="${n(labelBot - labelTop)}" fill="url(#labelShade)"/>
  </g>
  <path fill="${fg}" d="${textPath(FONTS.sansMedium, upper(product.family), { x: 80, y: 120, size: 20, tracking: 0.3 })}"/>
</svg>
`;
}

function galleryNotes(product) {
  const { bg, fg, liquid } = product.palette;
  const dark = isDark(product.palette);
  const note = product.notes.top[0];
  const noteSize = fitSize(FONTS.serifItalic, note.toLowerCase(), GALLERY_W - 160, 170);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_W}" height="${GALLERY_H}" viewBox="0 0 ${GALLERY_W} ${GALLERY_H}">
  <rect width="${GALLERY_W}" height="${GALLERY_H}" fill="${bg}"/>
  <circle cx="440" cy="560" r="330" fill="${dark ? lighten(bg, 0.12) : lighten(bg, 0.32)}"/>
  <circle cx="770" cy="790" r="270" fill="${liquid}" opacity="0.85"/>
  <circle cx="540" cy="1010" r="160" fill="${fg}"/>
  <circle cx="930" cy="360" r="130" fill="none" stroke="${fg}" stroke-width="2"/>
  <path d="M120 1120C340 980 520 720 640 300" fill="none" stroke="${fg}" stroke-width="2"/>
  <path d="M640 300C700 360 760 380 840 372" fill="none" stroke="${fg}" stroke-width="2"/>
  <path fill="${fg}" d="${textPath(FONTS.sansMedium, 'NUTA GŁOWY', { x: 80, y: 1236, size: 20, tracking: 0.32 })}"/>
  <path fill="${fg}" d="${textPath(FONTS.serifItalic, note.toLowerCase(), { x: 72, y: 1390, size: noteSize })}"/>
</svg>
`;
}

function galleryMood(product) {
  const { bg, fg, liquid } = product.palette;
  const night = isDark(product.palette);
  const skyTop = night ? darken(bg, 0.55) : lighten(bg, 0.5);
  const sun = night ? fg : lighten(liquid, 0.35);
  const layers = [0, 1, 2, 3].map((i) => {
    const y0 = 930 + i * 130;
    const amp = 46 - i * 8;
    let d = `M0 ${y0}`;
    for (let x = 0; x <= GALLERY_W; x += 40) d += `L${x} ${n(y0 + amp * Math.sin(x / 210 + i * 1.7) + amp * 0.4 * Math.sin(x / 90 + i))}`;
    d += `L${GALLERY_W} ${GALLERY_H}L0 ${GALLERY_H}Z`;
    const fill = night ? darken(bg, 0.2 + i * 0.16) : mix(bg, fg, 0.18 + i * 0.2);
    return `<path d="${d}" fill="${fill}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_W}" height="${GALLERY_H}" viewBox="0 0 ${GALLERY_W} ${GALLERY_H}">
  <defs>
    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">${stops([[0, skyTop], [0.65, bg]])}</linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <rect width="${GALLERY_W}" height="${GALLERY_H}" fill="url(#sky)"/>
  <circle cx="780" cy="640" r="230" fill="${sun}" opacity="0.5" filter="url(#glow)"/>
  <circle cx="780" cy="640" r="160" fill="${sun}"/>
  ${layers.join('\n  ')}
  <path fill="${night ? fg : bg}" d="${textPath(FONTS.serifItalic, product.name, { x: 80, y: 1400, size: fitSize(FONTS.serifItalic, product.name, 700, 64) })}"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Zapis
// ---------------------------------------------------------------------------

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const products = JSON.parse(await readFile(path.join(ROOT, 'src/data/products.json'), 'utf8'));
const defaults = JSON.parse(await readFile(path.join(ROOT, 'src/lib/bottle-label/defaults.json'), 'utf8'));

/** Lista plików do wygenerowania: [ścieżka publiczna, funkcja budująca SVG]. */
const jobs = [];
for (const product of products) {
  jobs.push([product.media.bottle, () => bottleSVG(product, defaults)]);
  jobs.push([product.media.label, () => labelSVG(product, defaults)]);
  const builders = [galleryStill, galleryNotes, galleryMood];
  for (const [i, item] of product.media.gallery.entries()) {
    const build = builders[i % builders.length];
    jobs.push([item.src, () => build(product, defaults)]);
  }
}

const pending = [];
let skipped = 0;
for (const [publicPath, build] of jobs) {
  if (!publicPath?.startsWith('/assets/')) continue;
  const file = path.join(ROOT, 'public', publicPath);
  if (!FORCE && (await exists(file))) {
    skipped++;
  } else if (!file.endsWith('.svg')) {
    console.warn(`  ! brak pliku ${publicPath} – placeholdery generuję tylko jako .svg`);
  } else {
    pending.push([publicPath, file, build]);
  }
}

if (pending.length) await loadFonts();
for (const [publicPath, file, build] of pending) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, build());
  console.log(`  + ${publicPath}`);
}

console.log(`placeholdery: ${pending.length} wygenerowanych, ${skipped} istniejących pominięto${FORCE ? '' : ' (--force nadpisuje)'}`);
