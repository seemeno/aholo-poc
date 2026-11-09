import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory, sourceInfo, runtimeVersion } from './runtime-info.mjs';

const sessions = path.join(directory, '.sessions');
await mkdir(sessions, { recursive: true });
async function readJSON(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
async function health(info) {
  if (!info || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/status`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const h = await r.json();
    return h.service === 'local-canvas-preview' && h.sourceKey === info.sourceKey && h.pid === info.pid ? h : null;
  } catch { return null; }
}
function output(info, extra) { console.log(JSON.stringify({ ...info, ...extra })); }
const args = process.argv.slice(2);
if (args[0] === '--list') {
  const entries = [];
  for (const file of await readdir(sessions)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const info = await readJSON(path.join(sessions, file));
    if (await health(info)) entries.push(info);
  }
  output({ sessions: entries });
} else {
  const stop = args[0] === '--stop';
  const input = stop ? args[1] : args[0];
  if (!input || args.length !== (stop ? 2 : 1)) throw new Error('用法：node open.mjs "完整路径.tsx"，或 --list，或 --stop "完整路径.tsx"');
  const { source, sourceKey } = await sourceInfo(input);
  const sessionFile = path.join(sessions, `${sourceKey}.json`);
  const previous = await readJSON(sessionFile);
  const current = await health(previous);
  if (stop) {
    if (current) process.kill(current.pid);
    output({ source, stopped: Boolean(current) });
  } else if (current?.runtimeVersion === await runtimeVersion()) {
    output(previous, { reused: true });
  } else {
    const readyFile = path.join(sessions, `ready-${randomUUID()}.json`);
    const logFile = path.join(sessions, `${sourceKey}.log`);
    const log = openSync(logFile, 'a');
    const child = spawn(process.execPath, [path.join(directory, 'preview-server.mjs'), source], {
      cwd: directory, detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, CANVAS_PREVIEW_PORT: '0', CANVAS_PREVIEW_READY_FILE: readyFile }
    });
    closeSync(log);
    let launchError;
    child.on('error', error => { launchError = error; });
    child.unref();
    let ready;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      ready = await readJSON(readyFile);
      if (ready && await health(ready)) break;
      if (child.exitCode !== null || child.signalCode) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready || !await health(ready)) {
      if (child.exitCode === null && child.pid) { try { process.kill(child.pid); } catch {} }
      const tail = (await readFile(logFile, 'utf8')).slice(-5000);
      throw new Error(`预览启动失败。请检查默认导出、缺失依赖或不支持的 Canvas 组件。\n${tail}`);
    }
    const info = { ...ready, source };
    await writeFile(sessionFile, JSON.stringify(info), 'utf8');
    output(info, { reused: false });
  }
}
