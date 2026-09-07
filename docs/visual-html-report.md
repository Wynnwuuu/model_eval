# 可视化评测报告 HTML

在结果洞察中选择评测物料、全员汇总或我的结果，按需要应用维度选项筛选，再点击 **可视化报告 HTML**。

下载的是单个 HTML 文件。用浏览器打开即可阅读结论、图表、维度分析和全部案例，不需要运行 ManuEval 或登录平台。正文、图表和统计说明均内嵌；媒体使用原始来源地址，需要联网且该地址仍有效。历史下载文件不会自动升级，应从新版平台重新导出。

## 阅读与范围

- 支持 A/B、Arena-rank、MOS、Rubric 和 Pairwise。各方式沿用平台统计结果，不增加 AI 推断。
- 报告记录项目、物料、评委范围、导出时间、维度 AND 条件和筛选前后 case 数。
- 报告中的案例搜索、结果筛选和维度筛选只影响案例展示，不重新计算顶部统计。
- 平台的胜者、低共识等案例浏览筛选不会缩减导出范围。只有物料、评委范围和已应用的维度选项限定统计范围。
- 全部纳入范围的 case 直接展示。没有有效评审的 case 明确标注，不当作平局。
- 长 Prompt、参考素材和逐评委反馈可展开。缺少原始逐票数据时不从汇总数虚构记录。
- 多值标签的分组可能重叠，不能相加。MOS/Rubric 展示现有评分维度对比，不额外计算平台尚未提供的 case 标签分层估计。

## 媒体和打印

- 图片完整显示且可放大；视频和音频使用原生播放控件，不自动播放。
- 媒体按视口延迟初始化，最多同时初始化 6 个。失败时显示状态、重试和原链接。
- 临时 blob 地址、本机地址或无法还原为可携带地址的代理链接不会导出为播放器。
- 报告保留来源链接中的签名参数，但不能延长签名有效期或绕过来源权限。
- 浏览器打印/另存 PDF 会显示全部案例并展开评审详情，结束后恢复筛选状态。PDF 不包含可播放视频或音频，保留来源链接和已加载的画面。
- 无脚本仍能读图表和正文，并使用原生 details 展开；搜索和图片放大需要脚本。

## 统计解释

- A/B 非平局胜率的分母是 A+B，平局比例的分母是 A+B+Tie。Wilson 区间及二项符号检验沿用当前平台的逐票方法，未新增 case 聚类校正。
- 平均多数共识与 Krippendorff’s Alpha 分开解释。前者描述多数票集中程度，后者校正偶然一致。
- 排名保留并列、平均名次、Borda 与参与记录数。排序拆出的模型关系并非额外独立投票。
- 评分区分原始维度分和平均加权分；标准差不是置信区间。
- Pairwise 保留 Bradley–Terry 区间、实际对战矩阵、覆盖率、连通分量和样本不足提示。无对战不填零胜率。

## 开发和验证

实现位于 `src/reports/`，由两个洞察页面按需加载。复用 `InsightExportRequest`、现有摘要、case evidence 和 Case ID 解析；报告专用元数据不写数据库。

```powershell
npm.cmd run test:insight-html
npm.cmd run test:insight-exports
npm.cmd run test:insights-summary
npm.cmd run test:dimension-options
npm.cmd run test:rank-ties
npm.cmd run test:e2e:insight-html
# 启动本地 Vite 后验证真实组件按钮：
$env:E2E_BASE_URL='http://127.0.0.1:3000'
npm.cmd run test:e2e:insight-html-entry
npm.cmd run lint
npm.cmd run build
npm.cmd run server:build
```

浏览器测试使用合成数据和受控媒体响应，不访问生产数据。覆盖独立文件下载、图片/视频/音频解码、断网、无脚本、恶意文本、窄屏、实际 PDF、打印状态恢复和 240 case 媒体并发限制。

设计参考：[Evidently HTML reports](https://docs.evidentlyai.com/docs/library/output_formats)、[Datawrapper 配色](https://www.datawrapper.de/blog/colors)、[W3C 复杂图表可访问性](https://www.w3.org/WAI/tutorials/images/complex/)。
