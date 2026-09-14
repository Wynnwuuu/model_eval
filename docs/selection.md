# 当前评测：三模型 × Wynn Prompt 的 30 条音频

沿用此前提交 `0f58256` 的 30 条音频、case ID 和顺序，六类各 5 条，合计 591 秒。固定清单见 `evaluation/cases.csv`，原始选择及哈希证据见 `evaluation/selection_origin.json`。每连续六题覆盖六个大类；没有重新挑选 case，也未依据模型表现筛选音频。

当前只使用 Wynn结构化 Prompt（Schema 2.2），比较 Gemini 3.1 Pro、Gemini 3.8 Flash 与 Qwen3.5-Omni-Plus，完整矩阵为 30 × 3 × 1，共 90 份返回。Wynn 沿用此前提供的版本，只移除最外层 Markdown 围栏，内置全文及来源 SHA-256 随代码保留。

| 模型 | 服务 | 实际调用 ID | 物理目标／配置依据 |
| --- | --- | --- | --- |
| Gemini 3.1 Pro | 聚合 API | `video-caption-opt` | 唯一候选 `gemini-3.1-pro-preview`，目录名称 `Gemini3.1-Pro` |
| Gemini 3.8 Flash | 聚合 API | `gemini-audio-test` | 唯一候选 `google/gemini-3.8-flash` |
| Qwen3.5-Omni-Plus | 百炼 | `qwen3.5-omni-plus` | 沿用此前 Plus 配置 |

2026年9月14日16:51:27（北京时间）已完成批前路由核验，两条 Gemini 路由各只有表中一个物理候选，均已启用且可用。实际 API ID、后续核验时间和路由核验信息随发布报告保存；旧混合路由的探测返回不进入本批评测。重新运行时需再次核验，不能仅凭逻辑路由名称推断底层版本。

本次发布复用 Plus 已有的 30 份 Wynn 返回，为两个 Gemini 新增 60 份返回，共 90 份结果。每一份复用结果均核对音频字节、系统 Prompt、用户消息及有效调用配置，原始响应文件与调用记录原样保留。`reuse_manifest.json` 逐项记录来源、请求哈希及响应文件 SHA-256；发布时只把当前响应文件仍与记录一致的输出计为复用，重跑后不匹配的输出计为新生成。实际完成数量及复用数量以完整导入后的 `evaluation-run.json` 为准。

请求只发送原始 WAV、音频时长/通道数/采样率及 Wynn Prompt，三个模型收到相同系统文本。参考 ASR 和歌词均未提供，不发送类别、文件名、来源字幕或参考 Caption。实际流式输出、token 上限及其他调用参数以 `run_config.json` 为准，因此当前比较的是三个模型 API 在所记录配置下的表现。

模型输出 CSV 路径为 `evaluation/results/gemini_plus_wynn/results.csv`，每行一条音频，共 4 列：音频链接、Wynn Gemini 3.1 Pro、Wynn Gemini 3.8 Flash、Wynn Plus。运行过程中未成功取得的模型输出留空，原因记录在状态文件。只有完整的 90 份成功返回才会导入 `src/data/evaluation.json`；缺失、失败或截断时保留已有页面。正常结束的格式异常结果同样原文保留，不自动修复或重抽；调用状态与格式诊断单独记录。JSON 语法通过不代表内容正确或完整符合 Schema，听音与盲评仍是必要的能力判断。

导入后界面显示匿名 A、B、C，字母与真实方案的对应关系按评审者稳定随机。拖动排名不改变阅读区域的字母与原文对应关系；评价 CSV 保留真实模型、Prompt 和名次。数据集 ID 由内容确定；新增 Gemini 方案产生新的数据集指纹，此前两方案和四方案版本的浏览器评价仍单独保留，不混入本轮导出。`evaluation-run.json` 仅在完整导入时更新，包含 `completedOutputs`、`reusedOutputs`、`newOutputs` 和格式诊断。`totalAttempts` 沿用响应记录累计口径，包含复用源请求与同一任务保留的失败记录，并非本次新增 API 调用次数。

当前使用独立结果目录 `evaluation/results/gemini_plus_wynn`，历史 `evaluation/results/full`、`evaluation/results/round3_wynn_doubao_plus`、`evaluation/results/round4_two_prompts_doubao_plus`、`evaluation/results/wynn_only_doubao_plus`、旧 Git 提交和浏览器标注不覆盖。单题调试结果与正式 30 题任务使用不同目录，避免修改音频矩阵。本批 Pro 首题来自 `evaluation/results/gemini_plus_smoke`，Flash 首题来自单模型路由核验后的 `evaluation/results/gemini_flash_verified_smoke`；旧混合路由目录 `evaluation/results/gemini_flash_smoke` 的探测返回已排除。上述两份有效首题返回计入本轮新生成的 Gemini 60 份，不另行增加题数。复用的 Plus 返回并非本次新生成，解读对比结果时应保留这一区别。

## 导入外部长表

导入器默认要求成功、完整且 JSON 语法有效的矩阵，可用 `--manifest` 指定音频清单。显式使用 `--allow-invalid-json` 时，允许正常完成但格式异常的原文并记录诊断，仍拒绝 API 失败、截断、缺失结果和音频身份不匹配。标准批量结果可直接用 `python3 evaluation/publish_results.py` 更新页面。
