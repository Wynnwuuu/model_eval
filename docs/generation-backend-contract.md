# 评测集批量生产后端接口约定

前端通过 `VITE_GENERATION_BACKEND_URL` 接入真实生成后端；未配置时使用内置 mock adapter。

## Endpoints

- `GET /api/generation/models`
  - 返回 `{ models: GenerationModelConfig[] }` 或直接返回数组。
- `POST /api/generation/batches`
  - 创建批量生成任务，返回 `{ id }` 或 `{ batchId }`。
- `GET /api/generation/batches/:id`
  - 轮询批次状态，返回 `{ status, items }`。
- `POST /api/generation/batches/:id/cancel`
  - 取消批次，当前前端已预留本地取消状态，后端接入后可补充真实取消。
- `POST /api/generation/batches/:id/retry`
  - 可选；当前前端通过新建只含失败 case 的 batch 完成重试。

## Batch Request

每个 case 会包含：

- `caseId`, `rowIndex`, `idempotencyKey`
- `prompt`
- `referenceImageUrls[]`, `referenceAudioUrls[]`
- `startImageUrl`, `endImageUrl`
- `lyricsOrDialogue`
- `controls`
- `seed`

## Case Result

每个 case 返回：

- `caseId`, `rowIndex`, `status`
- `requestId`, `providerJobId`
- `resultUrl` 或 `resultText`
- `mediaType`: `image | video | audio | text | link`
- `seed`, `resolvedControls`
- `errorCode`, `errorMessage`

要求输出 URL 可被浏览器直接预览；视频资源需要支持 Range 请求。

