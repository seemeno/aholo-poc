const port = Number(process.env.CANVAS_PREVIEW_PORT || 4317);
try {
  const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
  const data = await response.json();
  if (data.service !== 'local-canvas-preview' || !Number.isSafeInteger(data.pid) || data.pid <= 0) {
    throw new Error('该端口不是 Canvas 预览服务，未停止任何进程。');
  }
  process.kill(data.pid);
  console.log('Canvas 预览服务已停止。');
} catch (error) {
  console.error(`无法停止：${error.message}。服务可能尚未启动。`);
  process.exitCode = 1;
}
