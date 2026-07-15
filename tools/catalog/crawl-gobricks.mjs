/**
 * GoBricks MOC-parts catalog crawler.
 *
 * Pulls the public storefront API (the same endpoints the site's own frontend
 * calls) to build a complete local parts inventory: every part, every colour
 * variant, with real USD prices, live stock counts, and LEGO/LDraw
 * cross-reference codes.
 *
 * Politeness: sequential requests with a ~400 ms delay + jitter (≈2 req/s),
 * resumable via NDJSON so re-runs never re-fetch finished parts.
 *
 * Output (data/gobricks/):
 *   colors.json      — full colour chart with LEGO/BrickLink/LDraw mappings
 *   categories.json  — category tree
 *   products.ndjson  — one line per product (list rows)
 *   details.ndjson   — one line per product detail (all colour-variant SKUs)
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'data', 'gobricks');
mkdirSync(outDir, { recursive: true });

const BASE = 'https://gobricks.net/szoversea/frontend/v1';
const HEADERS = { Accept: 'application/json', currency: 'USD' };
const DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: HEADERS });
    const body = await response.json();
    if (body.ret !== 1) {
      throw new Error(`ret=${body.ret} ${body.msg ?? ''}`);
    }
    return body.data;
  } catch (error) {
    if (attempt >= 4) throw error;
    await sleep(1500 * attempt);
    return fetchJson(url, attempt + 1);
  }
}

// ---- colours & categories (one call each) ----
if (!existsSync(join(outDir, 'colors.json'))) {
  const colors = await fetchJson(`${BASE}/color/list`);
  writeFileSync(join(outDir, 'colors.json'), JSON.stringify(colors, null, 1));
  console.log(`colors: ${colors.colors?.length ?? 0}`);
  await sleep(DELAY_MS);
}
if (!existsSync(join(outDir, 'categories.json'))) {
  const categories = await fetchJson(`${BASE}/productCategory/tree?product_type=2`);
  writeFileSync(join(outDir, 'categories.json'), JSON.stringify(categories, null, 1));
  console.log('categories saved');
  await sleep(DELAY_MS);
}

// ---- product list (paginated) ----
const productsPath = join(outDir, 'products.ndjson');
let products = [];
if (existsSync(productsPath)) {
  products = readFileSync(productsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  console.log(`resuming with ${products.length} products already listed`);
} else {
  const pageSize = 50;
  for (let page = 1; page < 200; page++) {
    const data = await fetchJson(
      `${BASE}/product/list?page=${page}&page_size=${pageSize}&product_type=2&order_by_type=CREATE_TIME&order_by_direction=&category_id=`,
    );
    const rows = data.rows ?? [];
    for (const row of rows) {
      appendFileSync(productsPath, JSON.stringify(row) + '\n');
      products.push(row);
    }
    console.log(`list page ${page}: +${rows.length} (total ${products.length}/${data.total ?? '?'})`);
    if (rows.length < pageSize) break;
    await sleep(DELAY_MS + Math.random() * 200);
  }
}

// ---- details (one per product, resumable) ----
const detailsPath = join(outDir, 'details.ndjson');
const done = new Set();
if (existsSync(detailsPath)) {
  for (const line of readFileSync(detailsPath, 'utf8').trim().split('\n').filter(Boolean)) {
    try {
      done.add(JSON.parse(line).id);
    } catch {
      // Skip corrupt line.
    }
  }
  console.log(`resuming details: ${done.size} already fetched`);
}

let fetched = 0;
let failed = 0;
for (const product of products) {
  if (done.has(product.id)) continue;
  const skuId = product.product_sku?.id;
  if (!skuId) {
    failed++;
    continue;
  }
  try {
    const detail = await fetchJson(`${BASE}/product/detail?sku_id=${skuId}`);
    appendFileSync(detailsPath, JSON.stringify(detail) + '\n');
    fetched++;
    if (fetched % 25 === 0) {
      console.log(`details: ${done.size + fetched}/${products.length}`);
    }
  } catch (error) {
    failed++;
    console.log(`FAIL ${product.id} ${product.caption}: ${error.message}`);
  }
  await sleep(DELAY_MS + Math.random() * 200);
}

console.log(`DONE. products=${products.length} newDetails=${fetched} failed=${failed}`);
