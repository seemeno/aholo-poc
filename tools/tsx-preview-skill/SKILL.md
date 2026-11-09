---
name: tsx-preview
description: Preview a local standalone React .tsx or .canvas.tsx file in the Codex built-in browser. Use when the user asks to open, view, render, or preview a TSX/Canvas file, including “预览这个 TSX”, “打开 Canvas”, or “查看 tsx 效果”. Uses an installed local runtime across projects and chats; does not replace an existing application's own development server.
---

# TSX preview

Open the user's original component in the current chat's built-in browser. The runtime is bundled in `runtime/` beside this skill and is independent of any project checkout. Resolve that directory from this SKILL.md's actual location, not the chat's working directory.

1. Resolve the requested `.tsx` file to an absolute path using the user's attachment/path or known current artifact. If multiple plausible files remain, ask which one. Do not search unrelated projects or change the source just to make it previewable.
2. Inspect the file's imports and default export. The runtime supports default-exported standalone React components, local relative imports/CSS, installed project dependencies, and a limited `cursor/canvas` adapter. A component requiring application providers, required props, routing, framework services, or other setup may need its app's own dev server. Explain concrete missing prerequisites instead of claiming all TSX files work.
3. Run `node "<skill-directory>/runtime/open.mjs" "<absolute-source.tsx>"`. This returns JSON with `url`, `reused`, and source/session information. It starts a hidden local process automatically, selects a free loopback port, and reuses a healthy session for the same file. Different files have independent sessions. Do not assume port 4317 or use another chat's fixed report link.
4. If the sandbox prevents local browser access, use the available normal permission mechanism to run this same launcher on the host. Do not alter firewall, proxy, or Codex security settings. If dependencies are absent, run `npm ci --no-audit --no-fund` only in the skill's runtime directory.
5. Use the discovered Codex `open_in_codex` tool with `target: {type: "browser", url: <returned-url>}` to show the preview in this chat. If it is queued, use the available built-in browser tools to open the returned URL. Verify rendering and the important visible interaction when browser tools are available; do not report a queued open as a verified render. Keep a user-facing browser tab marked as a deliverable when the browser API requires it.
6. Return the rendered link using the source filename as its label, for example `[report.canvas.tsx](http://127.0.0.1:12345/)`, followed by a separate `[源码](<absolute-source-path>)` link. This lets the user click the TSX filename in chat to see the preview. Make clear that this preview link is a browser URL, not a change to Codex's native source-file handler. Mention a material unsupported dependency or SDK feature if one remains. Saving the source or its imported modules triggers a refresh; the preview preserves the report's original claims and dates and does not re-run its analysis.

## Session management

- List running previews: `node "<skill-directory>/runtime/open.mjs" --list`.
- Stop only the requested file's preview: `node "<skill-directory>/runtime/open.mjs" --stop "<absolute-source.tsx>"`.
- Other chats may be using existing sessions. Do not stop them merely to clean up the current chat.

## Boundaries

This is a personal Codex skill, not a native file-viewer extension. Clicking a normal `.tsx` file link can still open its source. Invoke `$tsx-preview` with a path, or ask to preview the file in natural language. Use it for files on this computer; cloud/remote chats need their own runtime and access to the source.

Run only the file the user selected and its imports. The service binds to `127.0.0.1`; do not expose it on the LAN or upload the component. Browser code has external network requests disabled by the preview's CSP. Preserve this boundary unless the user explicitly requests a different integration.

The adapter supports the layout, text, pills, tables and cards used by the installed report. It is not the full proprietary Canvas SDK. Missing exports must be reported or implemented from the actual SDK declaration, not silently replaced with empty placeholders.
