# model_eval · 音频分析盲评

只保留一个流程：**播放音频 → 阅读 5 份匿名分析 → 拖动排序 → 保存评价**。

30 条音频和 150 份分析已包含在源码中，无需上传文件、配置账号、连接数据库或调用模型。原始分析内容原样保留。

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

1. 试听当前音频，阅读 A–E 五份分析；可切换整体描述、环境与声源、时间变化和完整原文。
2. 在排序区拖动 A–E，从最准确排到最不准确；也可用上下移动按钮。
3. 确认排序，保存评价并进入下一条。可以跳过暂时无法判断的条目，再回来补评。
4. 通过导出按钮下载结果 CSV，交给发起评测的人。

模型及 Prompt 的名称在评测界面隐藏，导出文件保留真实方案、音频、评审者和名次，便于汇总。相同模型的不同 Prompt 是独立方案：Qwen Plus 两份、Qwen Flash 两份、Qwen3 Captioner 固定基线一份。

## 30 条音频如何选择

按音频包的六个大类各取 5 条：动作表演、情绪表演、音乐、角色对白/旁白、音效、人声/乐器单轨。兼顾难度，人声和乐器单轨的两种子类均覆盖；选择只使用音频清单属性，不按模型结果好坏筛选。

`src/data/evaluation.json` 保存对应的五方案分析，`public/audio/` 保存音频。页面按六类交错排列，每连续六题覆盖所有大类。具体抽样规则见 [selection.md](docs/selection.md)，音频来源见 [audio-sources.csv](docs/audio-sources.csv)；原始 100 条数据未修改。

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
