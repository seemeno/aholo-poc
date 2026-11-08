$ErrorActionPreference='Stop'
Push-Location -LiteralPath $PSScriptRoot
try{
 $taskPython=$env:AHOLO_PYTHON
 if(-not $taskPython){$taskPython=& node --input-type=module -e "import {findPython} from './python_runtime.mjs'; console.log(await findPython());"}
 if(-not (Test-Path -LiteralPath $taskPython)){throw '请先配置 AHOLO_PYTHON，指向 Python 3.11+ 的 python.exe。'}
 & npm ci --ignore-scripts --no-audit --no-fund
 if($LASTEXITCODE -ne 0){throw 'Node dependencies installation failed'}
 & $taskPython -m pip install --target (Join-Path $PSScriptRoot '.local-python') -r requirements.txt
 if($LASTEXITCODE -ne 0){throw 'Local Python dependencies installation failed'}
 Write-Output '依赖已安装到项目中。运行 启动本地Demo.cmd 或 npm start。'
}finally{Pop-Location}
