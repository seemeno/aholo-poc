# 仓库维护说明

## 代码组织

根目录保留现有服务和浏览器模块的相对路径，避免为了移动目录改写整个页面加载机制。

- `structure_server.mjs`：当前 Node HTTP 服务及静态资源白名单。
- `local_projects.mjs`、`project_lifecycle.mjs`：空间存储、生成与删除恢复。
- `object_generation*.mjs`、`lux3d_runtime.mjs`：物品任务和 Lux3D 接入。
- `structure_editor.mjs`、`editor_*.mjs`、`placement.mjs` 等：三维编辑及几何约束。
- `effect_*.mjs`：本地 Flux 任务、工作流、历史与界面。
- `scripts/`：启动和维护工具；`config/flux/`：独立推理环境的安装记录。
- `tests/fixtures/`：小型、独立于运行数据的测试样本。

新业务代码应放在现有职责模块中，避免再次把工具、模型或安装包放进 `output/` 并让正式代码引用它。

## 2026-11-08 整理记录

必要的 Flux 模型、环境和 ComfyUI 从 `output/local_ai_test/` 迁到 `runtime/flux/`。当前示例资源迁到 `assets/demo/`。主程序不再读取旧 `output/`，自动测试不依赖它。

已停用的云渲染、空间理解 PoC、alignment 研究脚本、界面流程原型及其专属测试移出当前源码。当前 Node 回归共 108 项；相较整理前的 116 项，移出了 5 项旧云渲染测试和 5 项旧 USD / DSL 测试，并新增 2 项源码安装缺少可选素材及 GPU 环境时的行为测试。

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
