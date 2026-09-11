# Prompt 对比评测数据

本轮使用 `promt测试.csv` 的全部 6 行模型结果，按音频合并成 3 题，每题 2 个方案。源 CSV 的“模型”字段均为 `qwen3.5-omni-plus`，Prompt 版本分别为“原版”和“2.2”。

| 音频 ID | CSV 类别 | 时长 | 分析数 |
| --- | --- | ---: | ---: |
| MUS-001 | 音乐 | 15 秒 | 2 |
| SFX-004 | 环境音 | 15 秒 | 2 |
| EMO-001 | 情绪类 | 15 秒 | 2 |

总音频时长 45 秒。保留文件中音频首次出现的顺序，不补入旧的 30 条样本、不重新抽样、不修改模型分析全文。CSV 类别标签保留原样；音频清单中的对应类别名称可能不同，音频身份按 case ID、路径、时长及 SHA-256 校验。

音频随源码保存在 `public/audio/`，完整分析保存在 `src/data/evaluation.json`。每位评审看到稳定随机的 A/B 顺序，拖动排名不会改变阅读区域的字母对应关系。原始 JSON 的展示分区仅供阅读，“完整原文”仍可查看原始返回。

方案身份由模型和 Prompt 共同决定；导出 CSV 会保留两者及实际名次。同一模型的两个 Prompt 不会合并统计成一条结果。新数据集使用新的 ID，旧评测的浏览器记录不会覆盖或混入本轮。

文件的 `id` 和 `fingerprint` 标识评测内容版本，`sourceCsvSha256` 记录输入文件版本。请求 ID、原电脑绝对路径等运行元数据不用于评测内容指纹，也不会出现在页面内置的数据中。选择明细见 [selection.csv](selection.csv)，音频来源见 [audio-sources.csv](audio-sources.csv)。

## 更新这类长表 CSV

仅维护者更新数据时需要 Python 3.10+；普通评审只需启动 Node 项目。

CSV 每行表示一个音频在一个模型、一个 Prompt 下的结果。需要保留这些列：`类别`、`case_id`、`音频链接`、`时长_秒`、`模型`、`Prompt版本`、`模型输出全文`、`调用状态`、`JSON语法有效`、`结束原因`、`请求ID`。导入器检查重复、缺失、不成功或截断结果以及音频元数据冲突；请求 ID 仅用于检查，不写入应用数据。源文件的原文及原音频包保持不变。

```sh
python3 scripts/import-audio-evaluation.py --results-csv /path/to/promt测试.csv --audio-dir /path/to/clip-pack-100 --app-data src/data/evaluation.json --app-audio-dir public/audio --source-attribution docs/audio-sources.csv --selection-csv docs/selection.csv --report /path/to/import-report.json
```

所有输入通过校验后，导入器更新静态 JSON、配套音频及来源清单。提交前运行 `python3 scripts/test-import-audio-evaluation.py`、`npm test`、`npm run build` 和 `npm run test:e2e`。不要把原电脑路径、请求 ID 或个人浏览器评价一并提交。
