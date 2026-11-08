# GitHub 上传范围

本项目的 GitHub 仓库保存可维护的源码、配置、文档和小型测试样本。本机 GPU 环境、模型、用户空间和历史产物不随源码上传。

## 应提交

- 根目录当前使用的 `.mjs`、`.py`、`.html`、`.css`。
- `package.json`、`package-lock.json`，用于固定 Node 依赖。
- `requirements.txt`，以及兼容入口 `requirements-local.txt`。
- `.gitignore`、`.gitattributes`、不含值的 `.env.example`。
- `scripts/` 的启动、检查和测试工具，`setup_local.ps1` 及两个中文启动脚本。
- `config/flux/` 的依赖约束与 ComfyUI 版本记录，不包含第三方源码和模型。
- `tests/` 与 `tests/fixtures/` 的小型样本。
- `assets/ui/` 当前页面使用的展示图片。
- `README.md` 与 `docs/` 当前维护文档。

## 不提交

- `node_modules/`、`.local-python/`：通过依赖清单重新安装。
- `runtime/`：GPU 虚拟环境、ComfyUI、权重、推理照片和成图；单独安装或备份。
- `local-data/`：用户空间、原始照片、生成模型、摆放、任务和服务日志；单独备份。
- `assets/demo/`：本机可选历史示例，不是新建空间或自动测试的前提。
- `output/`、`tmp/`、旧 `scene/`、研究缓存、压缩包、原视频和下载残片。
- `.env`、真实 API Key、私钥和机器相关凭据。
- 项目外的 `aholo-poc-archive-20261108/` 历史归档。

上述本地目录和文件类型已有忽略规则。Git 自身的 `.git/` 由 Git 管理，不作为上传文件，也不要手动删除来整理源码。

## 上传前检查

```powershell
npm test
npm run test:python
npm run check:repo
git status --short
git add --dry-run .
```

检查工具扫描“已跟踪 + 未忽略的未跟踪文件”，因此将来误跟踪大文件后仍能发现问题。若文件已经提交，仅修改 `.gitignore` 不会自动取消跟踪；应核对后使用 `git rm --cached`。已有历史中的敏感信息需另行处理。

本项目将 10 MiB 作为单个源码文件的检查预算。GitHub 普通 Git 对超过 50 MiB 的文件给出警告，并阻止超过 100 MiB 的文件；确需分发的大素材使用独立下载或另行配置 Git LFS，不将 Python 环境或模型目录整体入库。

官方说明：[忽略文件](https://docs.github.com/en/get-started/git-basics/ignoring-files)、[大文件限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。

## 首次上传到空仓库

本节适用于首次连接空仓库。已有远程配置时先用 `git remote -v` 核对地址，已有提交时无需再次创建首次提交。

先在 GitHub 创建空仓库，不额外初始化 README，然后在项目目录运行：

```powershell
git add .
git diff --cached --stat
git commit -m "Prepare Space Workshop source repository"
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

提交前检查暂存清单；仓库地址替换为实际地址。若目标仓库已有内容，先克隆并合并，不直接套用空仓库流程。今后更新使用 `git add .`、`git commit` 和 `git push`。
