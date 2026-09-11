# 30 条均衡评测样本

数据集 ID：`audio-eval-30-2ed529f8f2de91a1`。共 30 条音频、5 个方案、150 份分析。

| 类别 | 简单 | 中等 | 困难 | 合计 |
| --- | ---: | ---: | ---: | ---: |
| 人声、乐器单轨 | 2 | 2 | 1 | 5 |
| 动作表演 | 1 | 2 | 2 | 5 |
| 情绪表演类 | 2 | 1 | 2 | 5 |
| 角色对白、旁白 | 2 | 2 | 1 | 5 |
| 音乐 | 1 | 2 | 2 | 5 |
| 音效 | 2 | 1 | 2 | 5 |

简单、中等、困难各 10 条；总音频时长 591 秒（9 分 51 秒）。单轨大类包含 3 条乐器、2 条人声。

## 选择规则

先依据原音频 manifest 冻结样本成员，再读取模型分析。按 `category_zh` 六大类每类选择 5 条；类内按 `simple/medium/hard` 分配 2/2/1，并在类别间轮换获得全局 10/10/10。满足配额的组合依次优先覆盖不同细分类、语言及 composition 类型，用固定种子 `audio-eval-balanced-v1` 的 SHA-256 决定同分次序。没有按模型结果质量筛选，也没有改写分析原文。

页面按六个大类轮流交错，每连续六题覆盖各类各一条。五份结果对每位评审、每条音频稳定匿名打乱；改变排名不会改变阅读卡片的字母映射。

逐条选择、难度和源清单 QA 字段见 [selection.csv](selection.csv)，音频来源和授权字段见 [audio-sources.csv](audio-sources.csv)。音频按源 SHA-256 验证，文件本体未修改。

## 可复现生成

此步骤只供更换样本的开发者使用；普通评审无需原始 100 条文件或 Python。准备 Python 3.10+、原始 results.csv、包含 manifest.csv / manifest.jsonl / clips 的原音频包，在项目目录运行：

```sh
python3 scripts/select-audio-evaluation-subset.py --results-csv /path/to/results.csv --audio-dir /path/to/clip-pack-100 --output-dir /path/to/new-subset --app-data src/data/evaluation.json --app-audio-dir public/audio --source-attribution docs/audio-sources.csv
```

输出目录必须为空。更换样本集合时为音频指定新的空目录，再替换 `public/audio/`，以免旧文件混入。数据 ID 由完整分析、方案、音频哈希、呈现顺序和种子生成；改变数据后会使用独立的评审记录。
