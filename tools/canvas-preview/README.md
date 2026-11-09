# 在 Codex 中预览原始 Canvas

此工具直接编译并运行原始 `.canvas.tsx`，不复制或转换报告内容。它使用真实 React 和一个最小的 `cursor/canvas` 兼容层，独立于项目的业务依赖。

## 打开

首次在本目录执行 `npm install`。以后双击 `start.cmd`，保持该窗口运行，然后在 Codex 内置浏览器打开 <http://127.0.0.1:4317>。

默认源文件为当前 Windows 用户目录下的 `.cursor/projects/d-workspace/canvases/consumer-try-on-code-audit.canvas.tsx`。修改并保存原文件后，预览会自动刷新；优先级表格中的建议按钮可以切换详细内容。报告中的日期和代码证据保持原文，不会自动重新审查业务代码。

也可以指定其他文件：

```powershell
node server.mjs "C:\完整路径\报告.canvas.tsx"
```

端口默认 4317，可通过环境变量 `CANVAS_PREVIEW_PORT` 调整。服务仅监听 `127.0.0.1`，关闭启动终端或双击 `stop.cmd` 即可停止；后台启动的服务也可用 `stop.cmd` 停止。

## 支持范围

这不是 Codex 官方 Canvas 插件。兼容层覆盖当前文件使用的布局、标题、文字、标签按钮、表格、卡片、分隔线、链接以及 React hooks；支持系统深浅主题。它不包含 Cursor 的聊天关联、元素批注、分享或完整 Canvas SDK。其他文件若使用额外 SDK 组件，需要补充适配。画面排版可能与 Cursor 原生视图略有差别。

## 跨对话使用

相邻的 `../tsx-preview-skill/install.ps1` 可将技能与运行时一起安装到当前用户的 Codex skills 目录。安装后新对话可调用 `$tsx-preview` 并提供 TSX 路径；运行时不再依赖本项目路径。

`node open.mjs "完整路径.tsx"` 会自动启动后台进程、分配可用端口并返回 JSON 链接；同文件重用健康会话，不同文件独立运行。`node open.mjs --list` 列出会话，`node open.mjs --stop "完整路径.tsx"` 停止对应会话。原来的 `start.cmd` 与 4317 地址仍可用于这份报告。

普通 TSX 必须默认导出可独立挂载的 React 组件。支持本地相对模块、CSS 和可解析的项目依赖；依赖整个应用上下文的页面需使用其应用开发环境。源文件及导入文件保存后刷新；编译错误显示在预览中，修复后恢复。
