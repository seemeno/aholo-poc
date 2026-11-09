import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] || path.join(os.homedir(), '.cursor/projects/d-workspace/canvases/consumer-try-on-code-audit.canvas.tsx'));
const port = Number(process.env.CANVAS_PREVIEW_PORT || 4317);
if (!source.endsWith('.canvas.tsx')) throw new Error('请选择 .canvas.tsx 文件');
await stat(source);
let cached;
async function stamp() {
  return (await Promise.all([source, 'entry.tsx', 'canvas-adapter.tsx', 'preview.css'].map(async p => {
    const s = await stat(path.isAbsolute(p) ? p : path.join(directory, p));
    return `${s.mtimeMs}:${s.size}`;
  }))).join('|');
}
async function bundle(version) {
  if (cached?.version === version) return cached.body;
  const result = await build({
    absWorkingDir: directory,
    entryPoints: ['entry.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    sourcemap: 'inline',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: { 'cursor/canvas': path.join(directory, 'canvas-adapter.tsx') },
    plugins: [{ name: 'original-canvas', setup(b) {
      b.onResolve({ filter: /^canvas:source$/ }, () => ({ path: source }));
      // Sources outside this tool's directory still use its isolated React installation.
      b.onResolve({ filter: /^react(?:\/.*)?$/ }, args => {
        if (args.resolveDir === directory || args.resolveDir.includes('node_modules')) return;
        return b.resolve(args.path, { resolveDir: directory, kind: args.kind });
      });
    } }]
  });
  const body = result.outputFiles[0].contents;
  cached = { version, body };
  return body;
}

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>消费者试搭 · Canvas 预览</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
await bundle(await stamp());
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
  if (!['127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0])) {
    res.writeHead(403); res.end('Local access only'); return;
  }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  try {
    const route = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    if (route === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
    else if (route === '/bundle.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(await bundle(await stamp()));
    } else if (route === '/preview.css') {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.end(await readFile(path.join(directory, 'preview.css')));
    } else if (route === '/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ service: 'local-canvas-preview', pid: process.pid, version: await stamp(), file: path.basename(source) }));
    } else { res.writeHead(404); res.end('Not found'); }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(error.message));
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Canvas preview: http://127.0.0.1:${port}`);
  console.log(`Source: ${source}`);
});
