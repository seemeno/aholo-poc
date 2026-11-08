$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'runtime/flux'
$fluxMutex = New-Object System.Threading.Mutex($false, 'Local\AholoFlux8190')
if (-not $fluxMutex.WaitOne(0)) { $fluxMutex.Dispose(); exit 0 }
try {
  try {
    $fluxReady = Invoke-RestMethod -Uri 'http://127.0.0.1:8190/system_stats' -TimeoutSec 3
    if ($fluxReady) { exit 0 }
  } catch {}
  $pythonExecutable = Join-Path $runtimeRoot 'venv/Scripts/python.exe'
  $comfyScript = Join-Path $runtimeRoot 'ComfyUI/main.py'
  foreach ($file in @($pythonExecutable, $comfyScript)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "本地推理环境缺失：$file。请按 docs/FLUX_EFFECT_RENDER.md 安装。" }
  }
  foreach ($folder in @('inputs','generated','user')) {
    New-Item -ItemType Directory -Path (Join-Path $runtimeRoot $folder) -Force | Out-Null
  }
  $modelsPath = (Join-Path $runtimeRoot 'models').Replace('\','/')
  $modelConfig = Join-Path $runtimeRoot 'model-paths.yaml'
  @"
local_flux:
  base_path: '$($modelsPath.Replace("'", "''"))'
  diffusion_models: diffusion_models
  text_encoders: text_encoders
  vae: vae
"@ | Set-Content -LiteralPath $modelConfig -Encoding utf8
  $env:HF_HUB_OFFLINE = '1'
  $env:TRANSFORMERS_OFFLINE = '1'
  $env:HF_HUB_DISABLE_TELEMETRY = '1'
  & $pythonExecutable $comfyScript `
    --listen 127.0.0.1 --port 8190 --offline --disable-auto-launch `
    --disable-all-custom-nodes --cache-none --reserve-vram 1.5 `
    --fp8_e4m3fn-text-enc --preview-method none `
    --extra-model-paths-config $modelConfig `
    --input-directory "$runtimeRoot/inputs" --output-directory "$runtimeRoot/generated" `
    --user-directory "$runtimeRoot/user"
  if ($LASTEXITCODE -ne 0) { throw '本地 Flux 服务退出，请检查终端输出。' }
} finally { $fluxMutex.ReleaseMutex(); $fluxMutex.Dispose() }
