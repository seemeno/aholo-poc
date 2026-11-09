$ErrorActionPreference = 'Stop'
$skillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex\skills' }
$target = Join-Path $skillRoot 'tsx-preview'
if (Test-Path -LiteralPath $target) { throw "目标已存在，未覆盖：$target" }
$runtimeSource = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\canvas-preview'))
if (-not (Test-Path -LiteralPath (Join-Path $runtimeSource 'node_modules\react\package.json'))) { throw '请先在 tools/canvas-preview 中安装依赖。' }
New-Item -ItemType Directory -Path (Join-Path $target 'agents') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $target 'runtime') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'SKILL.md') -Destination (Join-Path $target 'SKILL.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'agents\openai.yaml') -Destination (Join-Path $target 'agents\openai.yaml')
foreach ($name in @('preview-server.mjs', 'open.mjs', 'runtime-info.mjs', 'entry.tsx', 'canvas-adapter.tsx', 'preview.css', 'package.json', 'package-lock.json')) {
  Copy-Item -LiteralPath (Join-Path $runtimeSource $name) -Destination (Join-Path $target "runtime\$name")
}
Copy-Item -LiteralPath (Join-Path $runtimeSource 'node_modules') -Destination (Join-Path $target 'runtime\node_modules') -Recurse
Write-Output "Installed: $target"
