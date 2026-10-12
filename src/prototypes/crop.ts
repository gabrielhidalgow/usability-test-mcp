import { chromium } from 'playwright';

// Image work happens in the Chromium the tool already installs, so there is no image library dependency.
type Box = { x: number; y: number; width: number; height: number };

async function withCanvas<T>(png: Buffer, work: (page: import('playwright').Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    await page.evaluate(`(async data => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
      const canvas = document.getElementById('c');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
    })(${JSON.stringify(png.toString('base64'))})`);
    return await work(page);
  } finally { await browser.close(); }
}

/** Cuts each box (image pixels) out of one PNG and returns PNGs. */
export async function cropPng(png: Buffer, boxes: Box[]): Promise<Buffer[]> {
  return withCanvas(png, async page => {
    const out = await page.evaluate(`(list => {
      const source = document.getElementById('c');
      return list.map(b => {
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(b.width)); c.height = Math.max(1, Math.round(b.height));
        c.getContext('2d').drawImage(source, Math.round(b.x), Math.round(b.y), c.width, c.height, 0, 0, c.width, c.height);
        return c.toDataURL('image/png').split(',')[1];
      });
    })(${JSON.stringify(boxes)})`) as string[];
    return out.map(b64 => Buffer.from(b64, 'base64'));
  });
}

// Sent as plain source so build tools cannot inject helpers that do not exist inside the page.
const DETECT_SOURCE = String.raw`(({ minSize, minGap }) => {
  const canvas = document.getElementById('c');
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const bg = [data[0], data[1], data[2]];
  const filled = (x, y) => { const i = (y * width + x) * 4; return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24; };
  const runs = (length, test) => {
    const out = []; let start = -1, gap = 0;
    for (let i = 0; i <= length; i++) {
      const on = i < length && test(i);
      if (on) { if (start < 0) start = i; gap = 0; }
      else if (start >= 0 && (++gap >= minGap || i === length)) { out.push([start, i - gap + 1]); start = -1; gap = 0; }
    }
    return out;
  };
  const boxes = [];
  for (const [y0, y1] of runs(height, y => { for (let x = 0; x < width; x += 2) if (filled(x, y)) return true; return false; })) {
    for (const [x0, x1] of runs(width, x => { for (let y = y0; y < y1; y += 2) if (filled(x, y)) return true; return false; })) {
      const ys = runs(y1 - y0, dy => { for (let x = x0; x < x1; x += 2) if (filled(x, y0 + dy)) return true; return false; });
      const top = y0 + (ys.length ? ys[0][0] : 0), bottom = y0 + (ys.length ? ys[ys.length - 1][1] : y1 - y0);
      if (x1 - x0 >= minSize && bottom - top >= minSize) boxes.push({ x: x0, y: top, width: x1 - x0, height: bottom - top });
    }
  }
  return boxes;
})`;
/**
 * Finds screens in an exported section image: rectangles that differ from the background colour,
 * separated by background gaps. Bands of rows first, then columns within each band.
 */
export async function detectFrames(png: Buffer, minSize = 60, minGap = 8): Promise<Box[]> {
  return withCanvas(png, page => page.evaluate(`${DETECT_SOURCE}(${JSON.stringify({ minSize, minGap })})`) as Promise<Box[]>);
}
