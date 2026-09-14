# 30 题模型明示比较

此分支将已确认的评审结果保存为可共同查看的页面。默认首页展示固定结果；`?view=blind` 保留独立的个人盲评。

## 数据来源与选择规则

| 题目 | 排名来源 | 完整输出来源 |
| --- | --- | --- |
| 第 1–15 题 | `三个模型评分.csv` 的 45 条 ranked 记录 | 相同数据集 `src/data/evaluation.json` 中对应题目、对应 VariantID 的原始文本 |
| 第 16–30 题 | `audio-eval-30_后15题_模型明示_9f7982fb.zip` 内 `本次排序明细.csv` | ZIP 内以真实模型名和 Prompt 命名的 45 份 JSON 文件，保留逐字文本 |

共同数据集为 `audio-eval-30-9f7982fbfae67788`，三个模型均使用 Wynn结构化 Prompt。排名通过 **SourceID + ModelName + PromptName** 关联到 VariantID；前半 CSV 中的 VariantID 也必须一致。页面先按 Rank 排序，再用该行的 VariantID 同时取得模型名和完整输出，绝不把 A/B/C 或文件顺序当作模型身份。

ZIP 内的排名明细、15 题索引和选项说明一致。后半旧评分 CSV 有 14 题有效排名，这 42 条记录与 ZIP 无冲突。ZIP 新增第 30 题 `STM-V-004` 的具名排名：Qwen3.5-Omni-Plus 第 1、Gemini 3.1 Pro 第 2、Gemini 3.8 Flash 第 3。依据本次要求以后半 ZIP 为准，页面纳入这一题。

后半 45 份输出与原库的 JSON 内容全部相同，但 ZIP 导出时有去除 Markdown 围栏、数字格式与末尾换行的变化。页面后半原文采用 ZIP 文件字节，不再次序列化。原盲评数据保持不变。15 份 ZIP 音频的 SHA-256 与已有音频完全相同，直接复用已有 WAV。

## 汇总

平均名次按全部 30 题等权计算，数值越低越好，同均值并列。

| 模型 | 名次和 | 平均名次 | 第 1 / 2 / 3 名次数 |
| --- | ---: | ---: | --- |
| Qwen3.5-Omni-Plus | 49 | 1.63 | 16 / 9 / 5 |
| Gemini 3.1 Pro | 58 | 1.93 | 12 / 8 / 10 |
| Gemini 3.8 Flash | 73 | 2.43 | 2 / 13 / 15 |

## 可复核记录

- `src/data/model-comparison.json`：完整 30 题、90 份原文、逐题具名排名、音频与输出哈希。
- `docs/comparison-sources/`：前半原始 CSV、ZIP 排名明细与题目索引。
- `docs/comparison-audit.json`：来源文件哈希、每份输出的源位置和 SHA-256，以及交叉核验计数。
- `scripts/import-model-comparison.py`：读取原始附件重新生成数据，先完成全量校验再写入；`--check` 仅验证，不改文件。
- `scripts/test-model-comparison.ts`：校验 90 个“题目—模型—名次—原文”关联、音频字节、总排名、乱序安全、非法数据拒绝和具名 CSV 导出。

重新导入时在仓库根目录运行：

```sh
python3 scripts/import-model-comparison.py \
  --first15 /path/to/三个模型评分.csv \
  --colleague-zip /path/to/audio-eval-30_后15题_模型明示_9f7982fb.zip \
  --previous-second15 '/path/to/audio-evaluation-fc723f1d-2026-09-14 (2).csv' \
  --check
npm test
npm run build
```

公开共享需要将本分支提交并发布，或者向同事提供可运行的源码/构建包。当前本地 URL 只用于本机预览。
