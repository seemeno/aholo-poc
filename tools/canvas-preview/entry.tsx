import React, { Component, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Canvas from 'canvas:source';

class ErrorBoundary extends Component<any, any> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <main className="error"><h1>TSX 加载失败</h1><pre>{this.state.error}</pre><button onClick={() => location.reload()}>重新加载</button></main> : this.props.children; }
}
function Preview() {
  const [status, setStatus] = useState('正在读取源文件');
  const [error, setError] = useState('');
  useEffect(() => {
    let previous: string | undefined;
    let disposed = false;
    async function refresh() {
      try {
        const response = await fetch('/status');
        if (!response.ok) throw new Error('源文件读取失败');
        const data = await response.json();
        if (disposed) return;
        setStatus(data.file);
        if (previous && previous !== data.version) {
          const compilation = await fetch('/bundle.js');
          if (!compilation.ok) { setError(await compilation.text()); return; }
          location.reload();
        }
        if (!previous) previous = data.version;
      } catch { if (!disposed) setStatus('预览服务已断开，请重新启动'); }
    }
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => { disposed = true; clearInterval(interval); };
  }, []);
  return <><header className="toolbar"><strong>TSX 预览</strong><span title={status}>{status}</span><button type="button" onClick={() => location.reload()}>重新加载</button></header>{error && <aside className="error" role="alert"><strong>源文件暂时无法编译，修复后会自动刷新</strong><pre>{error}</pre></aside>}<Canvas /></>;
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><Preview /></ErrorBoundary>);
