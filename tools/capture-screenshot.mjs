#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const url = getArg('url', 'http://127.0.0.1:3000');
const out = getArg('out', path.join('artifacts', 'app-screenshot.png'));
const waitMs = Number(getArg('wait', '2500'));

const dir = path.dirname(out);
fs.mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 980 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`Saved screenshot to ${out}`);
