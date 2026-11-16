// Renders the app icons from public/icons/icon.svg with Playwright's Chromium: icon-192.png and icon-512.png as
// drawn (transparent outside the rounded square), and maskable-512.png full-bleed on the bay colour with the mark at
// 64% of the icon's height, inside the maskable 80% safe zone. Run: node tools/make_icons.mjs
//
// Deterministic: the SVG is drawn inline at each size (no fonts, no images, no animation) in a fresh page at device
// scale 1, so the same SVG and the same Chromium give the same PNG bytes. A different Chromium build may anti-alias
// an edge differently.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ICONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BAY = '#121719';

const svg = readFileSync(join(ICONS, 'icon.svg'), 'utf8');

/** `scale` shrinks the drawing about its centre; `background` is the page behind it ('transparent' keeps alpha).
 *  The mark is 380.8 px of icon.svg's 512 (136 units at 2.8 px); at 0.86 it is 327.5 px, 64% of the maskable icon,
 *  and its farthest point (the band's rounded corner) is about 196 px from the centre, inside the 204.8 px zone. */
const OUTPUTS = [
  { file: 'icon-192.png', size: 192, scale: 1, background: 'transparent' },
  { file: 'icon-512.png', size: 512, scale: 1, background: 'transparent' },
  { file: 'maskable-512.png', size: 512, scale: 0.86, background: BAY },
];

const page = (size, scale, background) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: ${background}; }
  svg { display: block; width: ${size}px; height: ${size}px; transform: scale(${scale}); transform-origin: 50% 50%; }
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  for (const { file, size, scale, background } of OUTPUTS) {
    const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const tab = await context.newPage();
    await tab.setContent(page(size, scale, background));
    const png = await tab.screenshot({ omitBackground: background === 'transparent', animations: 'disabled' });
    writeFileSync(join(ICONS, file), png);
    console.log(`${file}: ${size}x${size}, ${png.length} bytes`);
    await context.close();
  }
} finally {
  await browser.close();
}
