import http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { directory, sourceInfo, runtimeVersion } from './runtime-info.mjs';

const { source, sourceKey } = await sourceInfo(process.argv[2]);
const port = Number(process.env.CANVAS_PREVIEW_PORT ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port');
const rendererVersion = await runtimeVersion();
let cached;
let dependencies = [];
async function stamp() {
  const files = [...new Set([source, ...dependencies, ...['entry.tsx', 'canvas-adapter.tsx', 'preview.css'].map(p => path.join(directory, p))])].sort();
  return (await Promise.all(files.map(async file => {
    try { const s = await stat(file); return `${file}:${s.mtimeMs}:${s.size}`; }
    catch (error) { if (error.code === 'ENOENT') return `${file}:missing`; throw error; }
  }))).join('|');
}
async function bundle() {
  if (cached?.version === await stamp()) return cached;
  const result = await build({
    absWorkingDir: directory, entryPoints: ['entry.tsx'], outfile: 'bundle.js',
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    sourcemap: 'inline', metafile: true, logLevel: 'silent',
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: { 'cursor/canvas': path.join(directory, 'canvas-adapter.tsx') },
    plugins: [{ name: 'original-tsx', setup(b) {
      b.onResolve({ filter: /^canvas:source$/ }, () => ({ path: source }));
      b.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, args => {
        if (args.resolveDir === directory) return;
        return b.resolve(args.path, { resolveDir: directory, kind: args.kind });
      });
    } }]
  });
  dependencies = Object.keys(result.metafile.inputs).map(p => path.resolve(directory, p)).filter(p => !p.includes(`${path.sep}node_modules${path.sep}`));
  cached = { version: await stamp(), js: result.outputFiles.find(f => f.path.endsWith('.js')).contents, css: result.outputFiles.find(f => f.path.endsWith('.css'))?.contents ?? '' };
  return cached;
}
function escapeHTML(value) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
const title = escapeHTML(path.basename(source));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · TSX 预览</title><link rel="stylesheet" href="/preview.css"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
await bundle();
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
  if (!['127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0])) { res.writeHead(403); res.end('Local access only'); return; }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  try {
    const route = new URL(req.url, 'http://127.0.0.1').pathname;
    if (route === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
    else if (route === '/bundle.js' || route === '/bundle.css') {
      const output = await bundle();
      res.setHeader('Content-Type', route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      res.end(route.endsWith('.js') ? output.js : output.css);
    } else if (route === '/preview.css') { res.setHeader('Content-Type', 'text/css; charset=utf-8'); res.end(await readFile(path.join(directory, 'preview.css'))); }
    else if (route === '/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ service: 'local-canvas-preview', pid: process.pid, sourceKey, runtimeVersion: rendererVersion, version: await stamp(), file: path.basename(source) }));
    } else { res.writeHead(404); res.end('Not found'); }
  } catch (error) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(String(error.message)); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  const actualPort = server.address().port;
  const info = { service: 'local-canvas-preview', pid: process.pid, port: actualPort, sourceKey, runtimeVersion: rendererVersion, url: `http://127.0.0.1:${actualPort}/` };
  if (process.env.CANVAS_PREVIEW_READY_FILE) {
    try { await writeFile(process.env.CANVAS_PREVIEW_READY_FILE, JSON.stringify(info), { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { console.error(error.message); server.close(); process.exitCode = 1; return; }
  }
  console.log(`TSX preview: ${info.url}`);
});
