/**
 * Poly Haven → PixBrik library master packer.
 *
 * Poly Haven's CC0 photoreal models ship as multi-file glTF (gltf + bin +
 * textures); the library needs self-contained binary GLBs on an allowlisted
 * host. This tool downloads a model's 1k-texture bundle, packs it into a
 * single GLB with gltf-transform, and drops it in assets/library-masters/v1
 * (served via raw.githubusercontent.com once committed).
 *
 * Usage: node tools/library/pack-polyhaven.mjs <slug> [<slug> ...]
 * License: every Poly Haven asset is CC0 — verify the slug exists on
 * polyhaven.com before packing; this tool also records the license in the
 * manifest it prints.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT_DIR = path.join('assets', 'library-masters', 'v1');
const RESOLUTION = '1k';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function download(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
}

async function packOne(slug) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${slug}`);
  const bundle = files?.gltf?.[RESOLUTION]?.gltf;
  if (!bundle?.url || !bundle?.include) {
    throw new Error(`${slug}: no ${RESOLUTION} gltf bundle`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `ph-${slug}-`));
  const gltfPath = path.join(workDir, `${slug}.gltf`);
  await download(bundle.url, gltfPath);
  let downloaded = 0;
  for (const [relPath, info] of Object.entries(bundle.include)) {
    await download(info.url, path.join(workDir, relPath));
    downloaded += info.size ?? 0;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slug}.glb`);
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', '@gltf-transform/cli', 'copy', gltfPath, outPath],
    { shell: process.platform === 'win32', stdio: 'pipe' },
  );

  const glb = fs.readFileSync(outPath);
  if (glb.length < 4 || glb.toString('latin1', 0, 4) !== 'glTF') {
    throw new Error(`${slug}: packed file is not a GLB`);
  }
  fs.rmSync(workDir, { force: true, recursive: true });
  return { bytes: glb.length, downloadedBytes: downloaded, slug };
}

const slugs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (!slugs.length) {
  console.error('Usage: node tools/library/pack-polyhaven.mjs <slug> [<slug> ...]');
  process.exit(1);
}
const manifest = [];
for (const slug of slugs) {
  try {
    const result = await packOne(slug);
    manifest.push(result);
    console.log(`OK  ${slug}  ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
  } catch (error) {
    console.log(`FAIL ${slug}  ${error.message}`);
  }
}
console.log('\nManifest (license CC0, source polyhaven.com):');
console.log(JSON.stringify(manifest, null, 2));
