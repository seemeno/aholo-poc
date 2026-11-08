# 测试样本

`image.png` 和 `cabinet.glb` 为程序生成的 128×128 色块图及长方体模型，不含用户素材。
运行 `node tests/fixtures/generate.mjs` 可确定性重建。

`room-structure.json` 是去除来源及诊断文本后的历史结构回归样本，只保留几何和兼容性测试字段；它不是用户空间备份。
全部测试直接读取这里的小型样本，不依赖 `output/`、可选示例素材或模型权重。
