# 仓库维护说明

## 代码组织

根目录保留现有服务和浏览器模块的相对路径，避免为了移动目录改写整个页面加载机制。

- `structure_server.mjs`：当前 Node HTTP 服务及静态资源白名单。
- `local_projects.mjs`、`project_lifecycle.mjs`：空间存储、生成与删除恢复。
- `object_generation*.mjs`、`lux3d_runtime.mjs`：物品任务和 Lux3D 接入。
- `structure_editor.mjs`、`editor_*.mjs`、`placement.mjs` 等：三维编辑及几何约束。
- `try_on.mjs`、`simple_gesture.mjs`、`comparison_view.mjs`、`consumer_editor.mjs`：消费者快捷初始化、交互与比较；设计见 [消费者试摆](CONSUMER_TRY_ON.md)。
- `viewer_activity.mjs`：根据页面可见性、三维视图和图形上下文状态控制绘制暂停与恢复。
- `effect_*.mjs`：本地 Flux 任务、工作流、历史与界面。
- `scripts/`：启动和维护工具；`config/flux/`：独立推理环境的安装记录。
- `tests/fixtures/`：小型、独立于运行数据的测试样本。

新业务代码应放在现有职责模块中，避免再次把工具、模型或安装包放进 `output/` 并让正式代码引用它。

### 编辑器模块边界（2026-11-09）

- `structure_editor.mjs`：组装模块、场景对象与二维校正，保留统一场景状态，不复制相机或保存状态。
- `editor_persistence.mjs`：保存队列、版本号、自动保存、冲突处理、本机副本及离开提示。保存接口和场景格式沿用原有约定。
- `editor_viewport.mjs`：Three / Spark 加载、相机、逻辑画幅、上下文恢复和绘制生命周期；物品变换通过回调交给场景编辑。
- `editor_ui.mjs`：面板、工具栏、横竖屏按钮、帮助与状态提示。工具栏挂载和界面事件绑定有重复调用保护。
- `editor_capture.mjs`：当前视角截图与输出留边，统一锁定输入并在失败时恢复相机画幅、物品可见性和渲染尺寸。
- `consumer_editor.mjs`、`simple_gesture.mjs`、`uniform_scale.mjs`：继续负责直接拖动、触摸事务和等比缩放，不把这些规则放回 UI 模块。

CSS 按职责维护：`app.css` 为公共基础；`consumer.css` 为首页、房间详情与共享照片弹窗；`editor.css` 为编辑器组件、响应布局及应用内方向；`effect_ui.css` 为效果图界面。保留媒体条件与方向属性下的必要适配，避免在文件末尾重复追加同条件、同选择器、同属性的覆盖。

本轮合并了 118 处被覆盖的声明，保持每个精确选择器及条件的最终声明一致；`scripts/css-rules.mjs` 和对应测试检查此范围，不能替代实际浏览器的布局验收。入口从 609 行减少到 427 行。完整 Node 回归 178 项通过，Python 4 项通过、1 项可选真实高斯样本未配置而跳过；仓库检查通过。

## 2026-11-08 整理记录

必要的 Flux 模型、环境和 ComfyUI 从 `output/local_ai_test/` 迁到 `runtime/flux/`。当前示例资源迁到 `assets/demo/`。主程序不再读取旧 `output/`，自动测试不依赖它。

已停用的云渲染、空间理解 PoC、alignment 研究脚本、界面流程原型及其专属测试移出当前源码。整理完成时 Node 回归共 108 项；相较整理前的 116 项，移出了 5 项旧云渲染测试和 5 项旧 USD / DSL 测试，并新增 2 项源码安装缺少可选素材及 GPU 环境时的行为测试。

历史代码、报告、原始视频和测试输出归档到项目外：

```text
D:\workspace\aholo-poc-archive-20261108\
  legacy-source/
  docs/
  tests/
  assets/
  output/
  flux-history/
  cleanup-manifest.json
```

这些是历史追溯资料，不属于当前应用或上传范围。归档中的旧代码仍使用旧目录结构，不能直接当作当前运行入口。若要恢复某项研究，应单独建立研究目录并准备相应依赖。

永久清理的是已退役实验的浏览器缓存、下载残片、可重装工具依赖和 Python 字节码。迁移清单保存在归档根目录，以及本机 `local-data/repository-cleanup.json`。

已有 Git 元数据、用户环境变量和当前主程序依赖未重置。没有执行 `git add`、`commit` 或 `push`。

## 依赖与数据规则

主程序 Python 依赖只在根目录 `requirements.txt` 维护；`requirements-local.txt` 引用它。GPU 推理独立使用 `config/flux/requirements.txt`，不要把 PyTorch 塞进普通照片检查的安装环境。

用户项目保存在 `local-data/`，推理服务另有 `runtime/flux/inputs/`、`generated/` 副本。忽略规则意味着不提交 Git，并不意味着不需要备份。

新增文件前可运行 `npm run check:repo` 查看 GitHub 实际候选范围。任何时候都应提交锁文件及小型测试样本，排除模型、环境、用户素材和临时产物。

消费者试摆第一轮改造后，完整 Node 回归为 124 项通过；Python 3 项通过、1 项可选真实样本未配置而跳过。新增尺寸推算、首次初始化并发、手势事务、比较恢复与静态模块访问验证，详见 [本轮设计与实现](CONSUMER_TRY_ON.md)。

2026-11-09 手机功能优化：完整 Node 回归 130 项通过，Python 3 项通过、1 项可选真实样本跳过；仓库检查通过。新增尺寸修改原子校验、对照排版、绘制生命周期及照片解码回退测试。浏览器授权被拒绝，本轮可视化和真机验收待补；未进行创空间部署。
