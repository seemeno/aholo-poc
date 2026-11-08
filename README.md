# 空间工坊

轻量化室内装饰与空间试摆。

一个在 Windows 电脑运行、通过浏览器或同一局域网手机访问的空间试摆应用。
当前流程：**准备空间 → 三维试摆 → 本地效果图**。

- 一张房间照片由 AHOLO World 生成可浏览的高斯空间。
- 家具、装饰照片由 Lux3D 生成 GLB；挂画直接以图片摆放。
- 地面和候选墙线在本机提取，可在 2D 平面手工校正。
- 三维编辑支持移动、旋转、缩放、物品管理和保存。
- 效果图由本机 ComfyUI / FLUX.2 Klein 4B 生成。

房间与家具生成需要 AHOLO API 和相应额度。照片先保存到电脑，用户明确确认生成后才提交云端任务；页面刷新不会重复提交已取得编号的任务。效果图服务单独安装，未安装时仍可使用空间和试摆功能。

## 环境要求

- Node.js 22 或更新版本，附带 npm。
- Python 3.11 或更新版本，以及 [requirements.txt](requirements.txt) 中的 NumPy、OpenCV。
- 完整本地效果图功能另需 NVIDIA GPU、兼容的 CUDA / PyTorch、ComfyUI 和模型权重。此电脑使用 RTX 4070 SUPER 12 GB；其他硬件需自行验证。

主程序通过 `AHOLO_PYTHON` 指定解释器；未设置时检测本机 Python，Windows 也兼容既有 Blender 内嵌 Python。无需安装 Blender 才能运行主程序。当前一键启动与 GPU 启动脚本面向 Windows；GPU 自动启动还需要 PowerShell 7（`pwsh.exe`）。

## 安装

在项目根目录打开 PowerShell：

```powershell
npm ci
$env:AHOLO_PYTHON = (Get-Command python.exe).Source
& $env:AHOLO_PYTHON -m pip install --target .local-python -r requirements.txt
```

也可先设置 `AHOLO_PYTHON`，再运行 `./setup_local.ps1` 一次安装 Node 和主程序 Python 依赖。`requirements-local.txt` 是兼容旧命令的入口，引用同一个 `requirements.txt`。

配置 AHOLO 密钥：

```powershell
$env:AHOLO_API_KEY = "替换为自己的 API Key"
```

上述设置仅对当前 PowerShell 及其子进程生效。若通过双击脚本启动，请先在 Windows 用户环境变量中设置 `AHOLO_API_KEY`、`AHOLO_PYTHON`，再重新打开应用。程序也会读取 Windows 用户级 AHOLO 密钥。

[.env.example](.env.example) 仅列出变量名称，应用不会自动加载 `.env` 文件。密钥不写入代码或 Git。

## 启动

```powershell
npm start
```

访问 [本地首页](http://127.0.0.1:8787/)。终端启动方式需要保持进程运行。

- 双击 `启动本地Demo.cmd`：在后台启动或复用服务，并打开首页。
- 双击 `启动手机网页版.cmd`：打开手机连接页面。
- `npm run start:local`：仅监听本机回环地址。
- 可通过 `PORT` 设置 Node 服务端口；双击启动脚本和手机入口默认使用 8787。

手机连接同一受信局域网后，在电脑打开 [连接手机](http://127.0.0.1:8787/phone)，使用页面上的局域网地址和配对码。不要在手机输入 `127.0.0.1`。配对允许访问电脑项目并使用电脑配置的 AHOLO 额度，服务重启后需重新配对。应用不用于直接暴露到公网。

同一空间建议单设备编辑，另一设备刷新后查看；当前没有实时协同合并。

完整操作见 [使用指南](docs/LOCAL_DEMO_GUIDE.md)。GPU 效果图安装、模型目录和启动方式见 [Flux 配置](docs/FLUX_EFFECT_RENDER.md)。

## 目录结构

```text
根目录的 .mjs / .html / .css    当前服务端、页面与共享逻辑
local_geometry.py             本地几何提取
media_check.py                图片 / 视频检查
offline_runner.py             禁止本地处理脚本访问网络和启动子进程
python_runtime.mjs            Python 解释器检测
scripts/                      启动、检查、Python 测试脚本
config/flux/                  Flux 依赖清单与已验证的 ComfyUI 版本记录
tests/                        当前功能测试及小型样本
assets/ui/                    页面使用的展示图片
docs/                         当前使用、安装和仓库说明
```

以下目录保留在本机，已由 `.gitignore` 排除：

```text
runtime/flux/                 ComfyUI、GPU Python 环境、模型及推理临时输入输出
local-data/projects/          用户空间、原照片、场景、物品与摆放
local-data/effect-renders/     效果任务和成图
local-data/service-logs/       后台服务日志
.local-python/                可重新安装的主程序 Python 依赖
node_modules/                 可通过 npm ci 重装的 Node 依赖
assets/demo/                  本机可选历史示例素材，不随源码发布
```

`assets/demo/` 不是正常创建空间的前提。此电脑保留了示例；新克隆未安装示例时，首页“体验已有客厅”会提示上传自己的房间照片。

## 测试与 GitHub 检查

```powershell
npm test
npm run test:python
npm run check:repo
```

Node 测试使用 `tests/fixtures/` 中的小型几何样本和合成图片 / GLB，不依赖历史 `output/`、GPU 权重或付费调用。Python 测试检查合成房间的几何提取与离线限制；可选真实 PLY 回归通过 `AHOLO_REAL_PLY` 配置，未配置时跳过。

`check:repo` 根据 Git 的实际候选文件检查忽略范围、已跟踪但被忽略的文件、文件大小和常见密钥格式，只输出文件路径，不输出密钥值。它不是完整的秘密或素材授权审计。

上传清单和命令见 [GitHub 上传说明](docs/GITHUB_UPLOAD.md)。整理范围与本地归档记录见 [仓库维护说明](docs/REPOSITORY_GUIDE.md)。

## 数据与限制

空间数据保存在电脑。页面删除进入“最近删除”，磁盘素材仍保留；这不是永久清理。备份用户空间应备份 `local-data/`，不能依赖仅包含源码的 GitHub 仓库。

浏览器还有独立的未提交草稿和未保存副本；它们不等同于电脑项目备份。关闭页面不会停止电脑中已运行的任务。结果不明的收费任务应先查询已有编号，避免重复提交。

候选结构、未实测模型尺寸和生成效果均不保证测量级准确。Flux 可能修改材质与细节，原摆放预览仍保留用于核对。
