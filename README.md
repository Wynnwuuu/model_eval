# model_eval · 音频分析盲评

只保留一个流程：**播放音频 → 阅读匿名分析 → 拖动排序 → 保存评价**。

当前内置 `promt测试.csv` 中的 **3 条音频、每条 2 份分析，共 6 份结果**，无需上传文件、配置账号、连接数据库或调用模型。源文件中的模型均为 `qwen3.5-omni-plus`，两个比较方案分别使用 Prompt“原版”和“2.2”。原始分析全文原样保留。

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

1. 试听当前音频，阅读 A/B 两份分析；可切换整体描述、环境与声源、时间变化和完整原文。
2. 在排序区拖动 A/B，从最准确排到最不准确；也可用上下移动按钮。
3. 确认排序，保存评价并进入下一条。可以跳过暂时无法判断的条目，再回来补评。
4. 通过导出按钮下载结果 CSV，交给发起评测的人。

播放器固定在页面左侧，阅读长分析时也可随时暂停、拖动进度或从头播放。点击箭头收起，点击耳机图标展开；收起后仍可播放或暂停，播放进度不会丢失。手机默认显示左下角的小入口。切换音频时会停止上一条，并从头开始新一条。

模型及 Prompt 的名称在评测界面隐藏，导出文件保留真实方案、音频、评审者和名次，便于汇总。同一模型的两个 Prompt 是独立方案，保存和导出时会分别记录。界面支持内置数据定义的 2–5 个方案。

## 当前评测数据

完整使用新 CSV 的全部结果，按文件首次出现顺序展示：

| 音频 | 类别 | 时长 | 分析数 |
| --- | --- | ---: | ---: |
| MUS-001 | 音乐 | 15 秒 | 2 |
| SFX-004 | 环境音 | 15 秒 | 2 |
| EMO-001 | 情绪类 | 15 秒 | 2 |

`src/data/evaluation.json` 保存分析，`public/audio/` 保存对应音频，均随 Git 分发。数据导入说明见 [selection.md](docs/selection.md)，来源见 [audio-sources.csv](docs/audio-sources.csv)。原始 CSV 和桌面音频包未修改。

替换模型结果或音频会生成新的数据集 ID。新一轮从未评状态开始，之前 30 条评测的浏览器记录保留在旧数据集下，不会混入本轮导出。需要回收旧评价时，应在更新前导出；已经更新的开发者可使用上一版代码访问旧数据集。

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
