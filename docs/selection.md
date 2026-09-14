# 第四轮：两模型 × 两版 Prompt 的 30 条音频评测

沿用此前提交 `0f58256` 的 30 条音频、case ID 和顺序，六类各 5 条，合计 591 秒。固定清单见 `evaluation/cases.csv`，原始选择及哈希证据见 `evaluation/selection_origin.json`。每连续六题覆盖六个大类；没有重新挑选 case，也未依据模型表现筛选音频。

本轮在代码 `14d90fb` 基础上比较 Doubao Seed 2.0 Lite(260428) 与 Qwen3.5-Omni-Plus，分别使用结构化和 Wynn结构化 Prompt（Schema 2.2），完整矩阵为 30 × 2 × 2，共 120 份返回。Doubao 使用聚合 API 的 `audio-seed_lite`，Plus 使用百炼的 `qwen3.5-omni-plus`；实际 API ID 和目录核验信息随运行报告保存。两版 Prompt 沿用此前提供的版本，结构化正文完整保留，Wynn 只移除最外层 Markdown 围栏，内置全文及来源 SHA-256 随代码保留。

本轮只补跑缺少的组合，复用已完成且请求哈希完全一致的返回。每一份复用结果均核对音频字节、系统 Prompt、用户消息及有效调用配置，原始响应文件与调用记录原样保留。`reuse_manifest.json` 逐项记录来源、请求哈希及响应文件 SHA-256；发布时只把当前响应文件仍与记录一致的输出计为复用，重跑后不匹配的输出计为新生成。实际完成数量及复用数量以完整导入后的 `evaluation-run.json` 为准。

只发送原始 WAV、音频时长/通道数/采样率及所选 Prompt，每个 Prompt 组内两模型收到相同系统文本。参考 ASR 和歌词均未提供，不发送类别、文件名、来源字幕或参考 Caption。实际流式输出、token 上限及其他调用参数以本轮 `run_config.json` 为准，因此这轮比较的是两个 API 在所记录配置下的表现。

模型输出 CSV 路径为 `evaluation/results/round4_two_prompts_doubao_plus/results.csv`，每行一条音频，共 5 列：音频链接、结构化 Doubao、结构化 Plus、Wynn Doubao、Wynn Plus。同一 Prompt 的两个模型相邻。运行过程中未成功取得的模型输出留空，原因记录在状态文件。只有完整的 120 份成功返回才会导入 `src/data/evaluation.json`；缺失、失败或截断时保留已有页面。正常结束的格式异常结果同样原文保留，不自动修复或重抽；调用状态与格式诊断单独记录。JSON 语法通过不代表内容正确或完整符合 Schema，听音与盲评仍是必要的能力判断。

本轮界面显示匿名 A、B、C、D，字母与真实方案的对应关系按评审者稳定随机。拖动排名不改变阅读区域的字母与原文对应关系；评价 CSV 保留真实模型、Prompt 和名次。新数据集 ID 与旧版本隔离，保留各自历史记录。`evaluation-run.json` 仅在完整导入时更新，包含 `completedOutputs`、`reusedOutputs`、`newOutputs` 和格式诊断。`totalAttempts` 沿用响应记录累计口径，包含复用源请求与本轮同一任务保留的失败记录，并非本轮新增 API 调用次数。

本轮使用独立结果目录，历史 `evaluation/results/full`、`evaluation/results/round3_wynn_doubao_plus`、旧 Git 提交和浏览器标注不覆盖。复用的返回并非本轮新生成，解读对比结果时应保留这一区别。

## 导入外部长表

导入器默认要求成功、完整且 JSON 语法有效的矩阵，可用 `--manifest` 指定音频清单。显式使用 `--allow-invalid-json` 时，允许正常完成但格式异常的原文并记录诊断，仍拒绝 API 失败、截断、缺失结果和音频身份不匹配。标准批量结果可直接用 `python3 evaluation/publish_results.py` 更新页面。
