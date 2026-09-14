# model_eval · 音频分析盲评

只保留一个流程：**播放音频 → 阅读匿名分析 → 拖动排序 → 保存评价**。

当前内置第三轮 **原 30 条音频 × 2 个模型 × Wynn结构化 Prompt（Schema 2.2）**：Doubao Seed 2.0 Lite(260428) 与 Qwen3.5-Omni-Plus，每条对应两份分析，完整矩阵共 60 份结果。普通评审无需 API 账号，导入后的原始分析全文随代码提供。

本轮为 Doubao 新生成 30 份返回；Plus 复用上一轮 30 份 Wynn 返回，音频、系统 Prompt、用户消息及有效模型配置的请求哈希均已逐项核对。只有两模型全部正常完成，才会把完整结果导入盲评页面。实际完成数、复用数及格式诊断以 `docs/evaluation-run.json` 的发布记录为准。

## 本地启动

准备 Node.js 22 或更新版本（含 npm）和 Git。首次使用：

```sh
git clone https://github.com/Wynnwuuu/model_eval.git
cd model_eval
npm ci
npm run dev:local
```

仓库公开，无需登录即可通过 HTTPS 克隆，或从 [GitHub 仓库页面](https://github.com/Wynnwuuu/model_eval) 下载源码 ZIP。解压源码 ZIP 的用户直接在 `model_eval` 目录从 `npm ci` 开始。

打开 **http://127.0.0.1:3010**，保持终端运行。下次使用只需 `npm run dev:local`。结束时按 `Ctrl+C`。

macOS、Windows、Linux 使用相同命令。首次安装依赖需要联网；评测时音频和分析均从本机加载。3010 端口被占用时不会自动切换端口。

已克隆过的同事可在项目目录运行 `git pull --ff-only origin main` 更新，再执行 `npm ci` 和 `npm run dev:local`。本版本的音频、分析和稳定数据 ID 都随 Git 保存；同一数据集更新界面代码不会清除已保存的评价。

## 如何评测

1. 试听当前音频，阅读匿名 A、B 两份分析。可切换整体描述、环境与声源、时间变化和完整原文。
2. 在排序区拖动方案字母，从最准确排到最不准确；也可用上下移动按钮。
3. 确认排序，保存评价并进入下一条。可以跳过暂时无法判断的条目，再回来补评。
4. 通过导出按钮下载结果 CSV，交给发起评测的人。

播放器固定在页面左侧，阅读长分析时也可随时暂停、拖动进度或从头播放。点击箭头收起，点击耳机图标展开；收起后仍可播放或暂停，播放进度不会丢失。手机默认显示左下角的小入口。切换音频时会停止上一条，并从头开始新一条。

模型及 Prompt 的名称在评测界面隐藏，导出文件保留真实方案、音频、评审者和名次，便于汇总。每个模型与 Prompt 的组合是独立方案，保存和导出时会分别记录。界面支持内置数据定义的 2–5 个方案。

## 当前评测数据

恢复原先 30 条音频及其六类交错顺序，六个大类各 5 条，音频总长 591 秒。case ID、顺序及每个 WAV 的 SHA-256 均与原 30 条版本核对一致，没有重新抽样。

第三轮仅比较以下两个方案，音频清单保持原样：

| Prompt | 模型 1 | 模型 2 |
| --- | --- | --- |
| Wynn结构化（Schema 2.2） | Doubao Seed 2.0 Lite(260428) | Qwen3.5-Omni-Plus |

`src/data/evaluation.json` 已保存本轮 60 份分析，`public/audio/` 保存原 30 条音频。本轮使用新的数据集 ID；旧轮次评测记录仍保留在各自浏览器存储中，不混入新一轮导出。悬浮播放器、匿名排序、保存及 CSV 导出沿用现有界面。

数据与调用说明见 [selection.md](docs/selection.md)，音频来源见 [audio-sources.csv](docs/audio-sources.csv)。

## 重新运行模型（维护者）

模型调用、Prompt、校验和导出全部使用 Python 3.10+ 标准库，无需安装 Python 依赖。网页仍使用现有 Node/React 项目。

先核实聚合 API 的模型及音频能力，再运行批量请求。`publish_results.py` 只接受完整、成功的 60 份结果；请求失败、缺失或截断时保留已有页面，补跑完成后才能导入。

```sh
python3 evaluation/setup_credentials.py
python3 evaluation/run_eval.py --check-api
python3 evaluation/run_eval.py --output-dir evaluation/results/round3_wynn_doubao_plus --workers 12 --per-model-workers 6 --rpm 20 --timeout 300
python3 evaluation/publish_results.py --run-dir evaluation/results/round3_wynn_doubao_plus
```

也可设置环境变量 `AGGREGATE_API_KEY` 与 `DASHSCOPE_API_KEY`；它们优先于本机凭证文件。模型实际调用 ID 由 `evaluation/config.py` 配置，Doubao 聚合 API 使用 `audio-seed_lite`，需通过当前凭证的模型目录核实模型及音频输入能力；百炼使用 `qwen3.5-omni-plus`。实际 ID 与目录核验信息写入本轮运行报告。如果运行环境需要额外可信 CA，可用 `SSL_CERT_FILE` 指定证书包。

- `evaluation/prompts.py` 内置本轮 Wynn结构化（Schema 2.2）完整 Prompt，`prompt_sources.json` 记录原文件哈希。Wynn 文件只移除最外层 Markdown 围栏，参考文本占位符填“未提供”。两模型收到相同的系统文本、音频字节及实测音频元数据，不发送来源字幕或参考答案。
- 默认使用 `evaluation/cases.csv` 的固定 30 条，结果目录为 `evaluation/results/round3_wynn_doubao_plus`。先试一条可加 `--limit 1 --output-dir evaluation/results/round3_smoke`；预览使用 `--dry-run`，真实任务与预览使用不同目录。
- 第三轮 `evaluation/results/round3_wynn_doubao_plus/results.csv` 每行一条音频，共 3 列：音频链接、Wynn Doubao、Wynn Plus。尚未成功返回的模型单元格为空，原因单独写入状态文件；CSV 保留已有模型完整返回。第三轮导入后，匿名 A、B 顺序按评审者稳定随机，导出保留真实模型与 Prompt 对应关系。
- 相同命令默认断点续跑；缓存同时校验音频、Prompt、模型配置。只有临时 API 故障会自动重试；非 JSON 原文不修复、不因为格式差而重新抽样。`--rerun` 会重新调用成功项。
- `publish_results.py` 默认读取本轮独立目录，校验完整 30×2 矩阵、Wynn Prompt、模型顺序及音频哈希后更新本地页面；失败或截断时停止更新。正常结束但 JSON 格式异常的返回会原样进入评测，异常单独写入报告。
- 历史 `evaluation/results/full` 目录保留，不用于本轮输出。旧模型全文还可从 Git 历史提交读取。复用旧返回时，必须逐项匹配音频、Prompt 和有效调用配置的请求哈希，并保留原文及调用记录。`reuse_manifest.json` 记录复用来源与响应文件 SHA-256；发布时再次校验当前文件，重跑后不再匹配的返回不计为复用。
- 发布报告的 `reusedOutputs`、`newOutputs` 区分旧结果复用与本轮生成。`totalAttempts` 包含复用源响应携带的请求次数及本轮同一任务已保留的失败记录，不能视为本轮新增 API 调用量。

运行记录、请求 ID、token 和 CA 存在被 Git 忽略的 `evaluation/results/` 或 `evaluation/.local/` 中。模型输出 CSV 用于查看模型全文；页面“导出评价 CSV”用于收集评审排序，两者用途不同。

## 保存与分享

评价保存在**当前浏览器、当前网址**。重启服务或刷新页面后可以继续；换电脑、换浏览器、换端口或改成 `localhost` 会使用另一份记录。清除浏览器网站数据会删除本机评价，请及时导出。

同事从 GitHub 拉取代码，或解压完整源码 ZIP，按相同步骤启动即可；**各人的结果不会自动回传给你**。请让他们导出 CSV 发回，文件包含评审者标识，方便区分。公网共享及集中保存尚未部署。

## 开发与文件

```sh
npm test
npm run build
npm run test:e2e
```

浏览器测试首次运行前需要 `npx playwright install chromium`。`npm run build` 生成静态产物 `dist/`。音频和分析会随构建一起复制；直接双击 HTML 不能替代本地服务。

主要代码是 `src/components/SimpleAudioEvaluation.tsx`、`src/simpleEvaluation.ts` 与 `src/components/AudioAnalysisContent.tsx`。项目从 [ManuEval](https://github.com/world-sim-dev/ManuEval) 改造，已移除与本次音频评测无关的任务平台、生产生成、数据库和部署代码。
