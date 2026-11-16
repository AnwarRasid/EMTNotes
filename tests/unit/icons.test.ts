// Task 21: the app icons that tools/make_icons.mjs renders from public/icons/icon.svg. Their sizes come from each
// PNG's IHDR (width at bytes 16-19, height at 20-23). The maskable icon must be full-bleed with its mark inside the
// 80% safe zone, and the source SVG must carry no wordmark or embedded picture (no SCDF marks).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { render } from '@testing-library/preact';
import { h } from 'preact';
import { Icon } from '../../src/ui/Icon';

const file = (name: string) => readFileSync(`public/icons/${name}`);   // from the project root, as vitest runs

const PNG_SIGNATURE = '89504e470d0a1a0a';

function ihdrSize(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

/** The RGBA pixels of an 8-bit RGB or RGBA, non-interlaced PNG (what Chromium's screenshots are). */
function decode(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const [width, height] = ihdrSize(png);
  const depth = png[24];
  const colour = png[25];
  const interlace = png[28];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error(`Unexpected PNG format ${depth}/${colour}/${interlace}`);
  const channels = colour === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      if (pred === undefined) throw new Error(`Unknown PNG filter ${filter}`);
      out[y * stride + x] = (line[x]! + pred) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(out.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

describe('app icons', () => {
  it.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['maskable-512.png', 512],
  ])('%s is a square PNG, %i px a side', (name, size) => {
    const png = file(name);
    expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect(ihdrSize(png)).toEqual([size, size]);
  });

  it('has a full-bleed maskable icon with its mark at about 64% of its height, inside the 80% safe zone', () => {
    const { width, height, rgba } = decode(file('maskable-512.png'));
    const bg = [0x12, 0x17, 0x19];
    const r = 0.4 * width;   // the safe zone: a circle of 80% of the icon's width, centred
    let marked = 0;
    let seeThrough = 0;
    let farthest = 0;
    let top = height;
    let foot = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] !== 255) seeThrough += 1;
        const off = Math.max(...bg.map((v, k) => Math.abs(rgba[i + k]! - v)));
        if (off <= 8) continue;
        marked += 1;
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
        top = Math.min(top, y);
        foot = Math.max(foot, y + 1);
      }
    }
    expect(seeThrough).toBe(0);   // full-bleed: the platform's mask cuts the shape
    expect(farthest).toBeLessThanOrEqual(r);
    expect(marked).toBeGreaterThan(width * height * 0.05);   // the mark is there, not just the background
    expect((foot - top) / height).toBeCloseTo(0.64, 1);   // within 0.05 of 64%
  });

  it('draws the Star of Life and the band only: no text, no embedded image', () => {
    const svg = file('icon.svg').toString('utf8');
    expect(svg).not.toMatch(/<text|<image|<use[^>]+href="(?!#)|xlink:href|data:/);
    expect(svg).toContain('#3381D4');   // Star of Life blue
    expect(svg).toContain('#E2711F');   // the band's orange
    expect(svg).toContain('#E3BC2B');   // and yellow
  });
});

// Plan 3 Task 5: the mic on the Speak key is the mockup's (.as-mic), in the same decorative line family.
describe('the mic icon', () => {
  it("draws the mockup's mic: its capsule, then the stand", () => {
    const { container } = render(h(Icon, { name: 'mic' }));
    const svg = container.querySelector('svg.ic')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.innerHTML).toBe('<rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"></path>');
  });
});
