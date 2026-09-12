# 两模型 × 两版 Prompt 的 30 条音频评测

沿用此前提交 `0f58256` 的 30 条音频、case ID 和顺序，六类各 5 条，合计 591 秒。固定清单见 `evaluation/cases.csv`，原始选择及哈希证据见 `evaluation/selection_origin.json`。每连续六题覆盖六个大类；没有重新挑选 case，也未依据模型表现筛选音频。

本轮在最新代码 `a808097` 基础上生成两模型 × 两 Prompt 共 120 个返回：结构化与 Wynn结构化各对应 Qwen3.8-0mni-Flash、Qwen3.5-Omni-Plus。前者调用公司聚合 API 的 `audio-cap`，后者调用百炼的 `qwen3.5-omni-plus`。Prompt 使用本次提供的桌面文件，内置全文及来源 SHA-256 随代码保留。

只发送原始 WAV、音频时长/通道数/采样率及相同 Prompt。参考 ASR 和歌词均未提供，不发送类别、文件名、来源字幕或参考 Caption。两个接口均使用文本流式输出；输出 token 上限为 16384，其余采样/推理参数使用各服务默认值，因此这轮比较的是这两个 API 配置下的表现。

每个 case 的四份结果原文保存在 `src/data/evaluation.json`。正常结束的格式异常结果同样原文保留，不自动修复或重抽；调用状态与格式诊断单独记录。JSON 语法通过不代表内容正确或完整符合 Schema，听音与盲评仍是必要的能力判断。

界面显示匿名 A–D，拖动排名不改变阅读区域的字母与原文对应关系；评价 CSV 保留真实模型、Prompt 和名次。新数据集 ID 与旧版本隔离，保留各自历史记录。验证统计见 `evaluation-run.json`。

## 导入外部长表

导入器默认要求成功、完整且 JSON 语法有效的矩阵，可用 `--manifest` 指定音频清单。显式使用 `--allow-invalid-json` 时，允许正常完成但格式异常的原文并记录诊断，仍拒绝 API 失败、截断、缺失结果和音频身份不匹配。标准批量结果可直接用 `python3 evaluation/publish_results.py` 更新页面。
