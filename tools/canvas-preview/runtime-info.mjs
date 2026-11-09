import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const directory = path.dirname(fileURLToPath(import.meta.url));
export async function sourceInfo(file) {
  const source = await realpath(path.resolve(file));
  if (!/\.tsx$/i.test(source)) throw new Error('请选择 .tsx 或 .canvas.tsx 文件。');
  const normalized = process.platform === 'win32' ? source.toLowerCase() : source;
  return { source, sourceKey: createHash('sha256').update(normalized).digest('hex') };
}
export async function runtimeVersion() {
  const hash = createHash('sha256');
  for (const file of ['preview-server.mjs', 'entry.tsx', 'canvas-adapter.tsx', 'preview.css', 'runtime-info.mjs', 'package-lock.json']) hash.update(await readFile(path.join(directory, file)));
  return hash.digest('hex').slice(0, 20);
}
