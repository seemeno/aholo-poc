# ModelScope 创空间部署

创空间： https://www.modelscope.cn/studios/seemeno/aholo-poc

## 运行方式

采用 Docker，`node:22-bookworm-slim` 安装 Python 3.11 与普通几何依赖。镜像安装 Node 生产依赖，端口为 `0.0.0.0:7860`，`GET /healthz` 检查服务是否在线。

本地仍使用原局域网配对。云版使用显式公开来源校验，无需注册或电脑配对；本轮不做用户账号或项目隔离，列表、照片和方案为共享 Demo 数据。生成确认处会提示，上传时不要包含私人素材。保留场景版本冲突保护。

首页提供「手机也能直接使用」提示和二维码，帮助菜单保留「手机访问」。`/phone` 提供大二维码、公开网址和复制按钮；`/phone-qr.svg` 在服务端生成配置的公开地址二维码，不使用第三方二维码服务。手机与电脑无需同一 Wi-Fi 或配对码；项目与已保存方案共用，未提交的设备草稿不自动转移，同一空间建议只在一台设备编辑。

## 创空间配置

类型设置为 `docker`；当前已查询到可用的免费配置为 `platform/2v-cpu-8g-mem`。以后迁移空间时应重新核查可用资源，不默认升级付费资源。

普通变量：

```text
PORT=7860
AHOLO_DEPLOYMENT=modelscope
AHOLO_PUBLIC_ORIGIN=https://seemeno-aholo-poc.ms.show
AHOLO_TRUSTED_PROXY_ADDRESSES=21.0.0.1
AHOLO_DATA_DIR=/mnt/workspace/aholo-poc
AHOLO_EFFECTS_ENABLED=0
AHOLO_PERSONAL_EFFECTS_ENABLED=1
AHOLO_PYTHON=/opt/aholo-python/bin/python
```

`AHOLO_API_KEY` 仅配置为服务端密文，代码、镜像、浏览器与 Git 远端地址不包含值。ModelScope 管理令牌不需要注入应用。

项目与原照片在持久目录的 `projects/`，物品及任务跟随项目目录；效果记录在 `effect-renders/`，网络审计在 `network-audit.ndjson`。代码路径不随数据目录改变，Python 脚本仍从应用目录执行。重启后读取原任务编号继续查询，不盲目创建新任务。

云端接受配置来源的 HTTPS 写请求，并支持可信内网代理传入的已配置 Host。拒绝其他 Origin 和 `Origin:null`。共享 Demo 对开始生成入口限制为每分钟最多 12 次，物品任务继续沿用既有队列。此限制不等于日额度或账单上限，只有用户明确确认才开始新生成。

当前 FC 实测代理来源为 `21.0.0.1`，对外请求的 Host 会改为 FC 域名，通过 `X-Forwarded-Host` 保留应用域名；健康检查则使用容器本机 IP。前者通过显式精确代理 IP 配置识别，后者与当前连接的 socket 地址匹配，不将整段 `21.*` 网络设为可信。换平台或代理变更需重新核对配置，拒绝日志只记录路由元数据。

平台网关实测拒绝 HTTP DELETE，因此界面通过 `POST /api/projects/:id/remove` 移到最近删除；旧 DELETE 接口保留供本地兼容，两个入口复用活动检查和软删除，不发起新生成。

## CPU 版本功能

支持上传房间和物品照片、调用 Aholo/Lux3D、提取几何、三维试摆、尺寸核对、比较、保存方案与图片。三维绘制发生在访问者浏览器，不在 CPU 容器中做远程桌面渲染。

本地 Flux 原为 Windows/GPU 环境，CPU 创空间不自动安装它。默认入口改为预生成客厅：直接进入三维试摆、添加前后比较、保存方案与图片，不提交任何生成任务。示例包为现有 Aholo 房间与家具的无损压缩副本，来源与清单见 `assets/showcase/README.md`；体验项目复用已存方案，不静默重置用户摆法。

实时氛围图为可选功能，使用 Qwen-Image-Edit-2511 的 ModelScope API。体验者在「可选 · 个人额度出图」中填写个人 Token，勾选当前截图和家具参考图上传、个人魔粒扣减确认，再点击生成。Token 未配置、失效、额度不足或权限不够时不会使用演示者密钥。配置 Token 和打开出图页本身不提交任务。Aholo/Lux3D 新建房间和物品仍按原账号额度处理，入口单独说明。

Token 只存服务器内存，最长一小时，不写环境变量、项目、磁盘或审计日志；浏览器密码框提交后清空。为兼容创空间 iframe，浏览器标签页只保存随机会话句柄，服务端用该句柄定位个人凭据；同时提供 HttpOnly、Secure、Partitioned cookie。清除 Token 会删除服务端会话，不会取消已提交的模型任务。服务重启、会话过期或清除后需重新配置原 Token；已知 task_id 只恢复查询，提交结果不明时不自动重提，尚未提交的遗留任务需再次确认。其他体验者的 Token 不能接管任务。方案和完成图片仍是共享 Demo 数据，不作项目隔离承诺。

接口：`GET/POST /api/personal-inference/session`、`POST /api/personal-inference/session/clear`；效果提交复用 `/api/effect-renders`，另需 `consent:true` 和个人会话。服务端固定模型和推理域名，不接受客户端自定义端点。结果下载不带个人授权头；图片在离线 Python 中解码，必要时缩放留白保持完整画面，不拉伸。与原三维截图的相机/几何一致性仍需真实出图核查。

## 后续接入 FLUX

本项目当前模型是 FLUX.2 Klein 4B FP8，不是 FLUX.2 [flex]。Klein 4B 可以自托管，Apache 2.0 许可证；官方标准显存参考约 13GB，实际随量化、分辨率、参考图和卸载策略变化。云端单任务可从 16GB 显存验证，24GB 更有余量，不保证任意 12GB 环境可用。Klein 9B 官方参考约 24GB，下载权重为非商业许可，商业使用需另核查授权或选择 API。

当前账号在本空间下的 Docker、Gradio 可用资源查询均只返回免费 CPU。免费 xGPU 需要先获得资格；官方资源介绍列出「应用搭子 Lv2」资格，另有 xGPU 乐园申请渠道，具体以账号当前资源配置为准。当前教程说明 xGPU 支持 Gradio/Streamlit，不能承诺现有 Node Docker 直接兼容；可考虑保留 CPU 主站，另做 GPU 图片编辑服务。Notebook GPU 时长不等于创空间在线服务 GPU 权限。

比赛 Demo 优先考虑 CPU 主站调用外部 FLUX 图片编辑 API。Klein 适合低延迟体验，pro 可作为质量对照，flex 可调 steps/guidance、侧重文字与细节，不因名称就优先选用。API 路径无需在创空间购买 GPU，但每次生成另收费。输入继续使用当前摆放截图与家具参考照片；生成图仍为视觉参考，不能保证几何和尺寸严格不变。

现有 `effect_runtime.mjs` 固定本机 ComfyUI 与 Windows 启动脚本。无论切换 Linux GPU 还是外部 API，都需要适配运行后端、任务轮询、失败恢复与提交去重；外部服务还需增加明确的上传确认、服务端密钥和网络来源白名单。仅修改模型文件名或打开 `AHOLO_EFFECTS_ENABLED` 不会完成接入。

参考：[ModelScope 免费资源说明](https://modelscope.cn/posts/1409)、[创空间使用教程](https://modelscope.cn/posts/434564)、[BFL Klein 部署和许可](https://help.bfl.ai/articles/7592221790-how-do-i-generate-quickly-with-flux-2-klein)、[BFL 模型系列](https://help.bfl.ai/articles/4292391522-what-is-flux-2)。

仓库不上传个人项目和可选 `assets/demo/`。仅提交明确列出的 `assets/showcase/` 体验包；未安装体验包和可选示例时仍回退到上传入口，不使用合成验证素材冒充真实生成示例。

## 更新与验收

Git 推送默认 `master`，保留平台 README 的 YAML 元信息与 Git LFS 属性。修改 SDK 或变量后需要重新部署。

先检查构建日志，再检查运行日志与 `/healthz`、`/api/capabilities`、`/api/doctor`。检验静态模块、共享项目保存、重启恢复和 Origin 拒绝；真实云生成须人工确认，不在部署验证中自动消耗额度。ModelScope 可能休眠，唤醒期间显示连接恢复提示。

本地自动化：`npm test`、`npm run test:python`、`npm run check:repo`。构建与线上状态另以本次实际部署记录为准，测试通过不等于已完成镜像构建或真实手机体验。

官方参考：https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/references/docker-templates.md

## 2026-11-09 实际部署记录

- 运行代码版本：`e0af76a`；Docker 镜像构建成功，创空间状态为 `Running`。
- 公开地址：https://seemeno-aholo-poc.ms.show ，无需登录；`/healthz` 返回 200。
- `/api/capabilities` 确认共享模式、CPU 效果图关闭、未预置房间示例；`/api/doctor` 确认服务端密钥、Python、NumPy 与 OpenCV 可用。
- HTTP 检查通过：首页、关键前端模块与 Three.js；合成照片上传并原样读取；草稿保存再读取；POST 软删除；错误 Origin 拒绝；CPU 效果任务提交拒绝。
- 先前的合成项目在重新发布后仍可读取，照片记录保留，持久化目录验证通过。两个合成测试项目均已移到最近删除；没有复制或修改原有项目。
- 本地最终 Node 133 项通过，Python 3 项通过、1 项可选真实 PLY 样本跳过，源码和上传仓库检查通过。
- 未调用收费生成、未开通付费 GPU。以上为构建与 HTTP 验收，未代替浏览器 WebGL、真机触摸和真实云生成画质验收。

### 手机访问入口补充

代码版本 `e85690c` 已发布，状态 `Running`；`/phone`、`/phone-qr.svg`、首页入口模块 HTTP 200，公开网址与无需配对说明检查通过。完整 Node 133 项回归通过。浏览器检查工具超时，未将页面布局、剪贴板交互或真实手机扫码记为已验收。

### 默认体验与个人出图发布

运行版本 `ec26753`，状态 `Running`。默认体验空间 `f2e3f62f-430a-4807-a7f2-edf9a8c41f6a` 已就绪，包含房间、家具、参考图、摆放方案和机位；入口 `/api/example` 仅准备已有素材，不调用生成。云端构建实测通过示例建立、保存与重开测试。

线上 HTTP 验证通过：能力接口开启预生成示例与个人额度模式；真实 PLY/GLB 可用；关键前端模块可读；未提供个人 Token、未确认出图时拒绝提交；两组合成会话的配置、查询与独立清除正常。合成会话已清除，真实推理调用为 0。

ModelScope 网关不允许 HEAD，素材验证使用浏览器实际使用的 GET。房间用 Brotli 无损压缩到 9.83 MiB 后以普通 Git 提交，避免增量构建遗留 LFS 指针。平台针对额外的凭据错误恢复补丁生成了自动回退，最终版本保留该回退；失败或状态不明不会自动重提。

最终 Node 140 项通过，Python 4 项通过、1 项可选样本跳过，仓库检查通过。真实个人额度出图、画质、浏览器 WebGL 和真机触摸仍需体验者实测，未用模拟响应替代。
