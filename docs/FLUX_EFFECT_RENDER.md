# 本地 Flux 效果图

主程序端口为 8787，本地 ComfyUI 固定监听 `127.0.0.1:8190`。手机通过主程序访问效果任务，不直接访问推理端口。空间和家具生成仍使用 AHOLO / Lux3D；效果图只使用本地 GPU。

## 本机目录

```text
runtime/flux/
  ComfyUI/main.py
  venv/Scripts/python.exe
  models/
    diffusion_models/flux-2-klein-4b-fp8.safetensors
    text_encoders/qwen_3_4b.safetensors
    vae/flux2-vae.safetensors
  inputs/
  generated/
  user/
```

`runtime/` 整体不提交 Git。此电脑的既有环境已迁到这里，模型不用重新下载。环境目录不是可随意复制到其他电脑的便携安装包。

## 新电脑安装

1. 准备兼容 NVIDIA GPU 的 Python / PyTorch / CUDA 环境，以及供自动启动使用的 PowerShell 7（`pwsh.exe`）。主程序的 `requirements.txt` 不包含 GPU 依赖。
2. 将 ComfyUI 源码安装到 `runtime/flux/ComfyUI/`，在 `runtime/flux/venv/` 建立独立 Python 虚拟环境。版本记录见 [comfyui-version.json](../config/flux/comfyui-version.json)，当前验证的标签为 `v0.44.0`。
3. 先按硬件安装合适的 PyTorch，再在该虚拟环境安装 [config/flux/requirements.txt](../config/flux/requirements.txt) 的依赖。此清单记录当前集成需要的依赖约束，不是所有硬件通用的完整锁文件。
4. 从模型官方发布处取得上述三个权重，按目录放置。模型权重不随项目源码分发；按各自模型许可使用。
5. 运行 `./scripts/start-local-ai.ps1` 验证服务。主程序启动后也会检查并自动启动已安装的环境。

参考安装命令（在项目根目录；先完成适合硬件的 PyTorch 安装）：

```powershell
python -m venv runtime/flux/venv
& ./runtime/flux/venv/Scripts/python.exe -m pip install -r config/flux/requirements.txt
./scripts/start-local-ai.ps1
```

ComfyUI 源码和模型需另外准备，以上 pip 命令不会下载它们。启动脚本根据实际项目路径生成 `model-paths.yaml`，无需硬编码磁盘位置。它设置离线模式、禁用自定义节点，运行时不自动下载权重。

其他系统可手动使用上述目录中的 ComfyUI，以相同模型配置启动在 `127.0.0.1:8190`；Windows 自动启动脚本尚未适配其他系统。

## 使用与恢复

摆放完成后点击「3 看效果」，调整当前三维机位，选择横图 16:9、竖图 3:4 或窗口画幅，再点击渲染。生成前自动保存；保存失败不会提交推理。

配方为 `klein4b-fp8-preserve-layout-v3`：Euler、CFG 1，4 步时间表只执行后 2 步，以当前摆放截图的 VAE latent 初始化；最长边 1024，尺寸为 16 的倍数。最多追加一张参考照片，优先选家具原照片。

首次任务需要加载模型，服务在线不代表模型已常驻显存。生成期间可以离开页面；下次读取持久化任务继续显示。提交结果不明时不会悄悄再建同一任务。

应用层快照、任务和结果在 `local-data/effect-renders/`；ComfyUI 另在 `runtime/flux/inputs/`、`generated/` 保存推理副本。清理某个空间全部图片时，也应按对应任务编号处理这些副本；不要删除模型或虚拟环境。

结果用于展示空间氛围，可能改变局部材质、商品细节或结构。可切换当时的真实摆放预览核对，不能作为型号或尺寸保真凭据。
