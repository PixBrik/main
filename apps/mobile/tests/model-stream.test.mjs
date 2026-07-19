import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const requireFromHere = createRequire(import.meta.url);
const helperUrl = new URL('../api/_modelStream.ts', import.meta.url);
const proxyUrls = [
  new URL('../api/meshy/model.ts', import.meta.url),
  new URL('../api/tripo/model.ts', import.meta.url),
];

async function loadHelper() {
  const source = await readFile(helperUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    Response,
    console,
    exports: module.exports,
    module,
    require: requireFromHere,
  });
  new vm.Script(output, { filename: helperUrl.pathname }).runInContext(context);
  return module.exports;
}

class StreamingResponse extends Writable {
  constructor() {
    super();
    this.byteCount = 0;
    this.flushCount = 0;
    this.headers = new Map();
    this.headersSent = false;
    this.statusCode = 0;
  }

  _write(chunk, _encoding, callback) {
    this.byteCount += chunk.byteLength;
    callback();
  }

  flushHeaders() {
    this.flushCount++;
    this.headersSent = true;
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }
}

function chunkedBody(totalBytes, chunkBytes = 64 * 1024) {
  let delivered = 0;
  return new ReadableStream({
    pull(controller) {
      if (delivered >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - delivered);
      controller.enqueue(new Uint8Array(size).fill(delivered === 0 ? 0x67 : 0x31));
      delivered += size;
    },
  });
}

test('provider model delivery streams a GLB larger than Vercel buffered responses', async () => {
  const { streamProviderModel } = await loadHelper();
  const size = 6 * 1024 * 1024 + 17;
  const provider = new Response(chunkedBody(size), {
    headers: { 'content-type': 'model/gltf-binary' },
    status: 200,
  });
  const response = new StreamingResponse();

  await streamProviderModel(provider, response);

  assert.equal(response.byteCount, size);
  assert.equal(response.statusCode, 200);
  assert.equal(response.flushCount, 1);
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.has('content-length'), false);
});

test('model streaming rejects provider errors, HTML and oversized declarations before headers', async () => {
  const { MAX_PROVIDER_MODEL_BYTES, streamProviderModel } = await loadHelper();
  const cases = [
    new Response('failed', { status: 503 }),
    new Response('<html></html>', { headers: { 'content-type': 'text/html' }, status: 200 }),
    new Response('x', {
      headers: {
        'content-length': String(MAX_PROVIDER_MODEL_BYTES + 1),
        'content-type': 'model/gltf-binary',
      },
      status: 200,
    }),
  ];
  for (const provider of cases) {
    const response = new StreamingResponse();
    await assert.rejects(streamProviderModel(provider, response));
    assert.equal(response.headersSent, false);
    assert.equal(response.byteCount, 0);
  }
});

test('provider routes never buffer or send generated GLBs', async () => {
  const helper = await readFile(helperUrl, 'utf8');
  assert.match(helper, /Readable\.fromWeb/);
  assert.match(helper, /await pipeline\(upstream, sizeLimit, res\)/);
  assert.match(helper, /res\.once\?\.\('close', abortUpstream\)/);
  for (const proxyUrl of proxyUrls) {
    const source = await readFile(proxyUrl, 'utf8');
    assert.match(source, /streamProviderModel\(modelRes, res\)/);
    assert.doesNotMatch(source, /arrayBuffer\(\)/);
    assert.doesNotMatch(source, /\.send\(buffer\)/);
  }
});
