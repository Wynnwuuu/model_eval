# ManuEval 视频输入对接 VidMuse MCP / Aion 说明文档

> 状态：Implemented v1.0，作为 ManuEval dev 新生成预检的输入合同  
> 日期：2026-08-07  
> 适用范围：ManuEval dev 的图片/视频模型批量生成  
> 权威文档：[VidMuse MCP 工具文档](https://j0yswlgboxz.feishu.cn/wiki/Odf8w2SBmicB9skMfAMcDoqxnpd)，读取版本 revision 1813  
> Plugin 规则快照：`general-mv-main-dsl-v2-en-0721`，commit `1029c7970b7069f2e088247cc870992bc65d1424`  
> ManuEval 实现基线：`9f06bca` 之后的 MCP compiler v3；发布提交见本文所在 Git 历史

## 1. 文档目的

ManuEval 的数据集允许一批 case 同时包含文字、单图、双关键帧、多个参考图片、参考视频和参考音频。模型之间的供应商字段、支持组合和限制又不相同。如果只根据“图片有几张”猜测输入意图，会发生最危险的一类错误：请求成功了，但生成方式不是用户希望的方式。

本文要解决以下问题：

1. 明确 ManuEval 中每种输入意图应映射到哪个 VidMuse MCP 字段。
2. 明确每个 case 如何独立推导 Aion `generation_type`。
3. 明确 MCP 字段语义、Aion 实时配置、模型 Adapter 和 ManuEval 产品规则之间的边界与优先级。
4. 明确界面如何让用户表达意图，而不是让程序猜测意图。
5. 明确提交前应展示什么、阻断什么、记录什么，保证付费生成请求可解释、可复核。

本文不规定供应商私有 API 字段。ManuEval 不直接适配各供应商 API，而是构造与 VidMuse MCP 语义一致的标准输入，再调用 Aion Model API，由 Aion Adapter 完成供应商字段转换和最终校验。

## 2. 术语与系统边界

### 2.1 三种不同的“合同”

- **MCP 输入合同**：定义 `prompt`、`image_urls`、`elements`、`audios` 等字段的含义和结构。它回答“用户的素材意图应放在哪里”。
- **Aion 统一请求合同**：在 MCP 语义输入之外增加 `generation_type`、`features`、`extra_params` 等 Aion 执行字段。它回答“ManuEval 最终怎样提交任务”。
- **供应商合同**：各模型真实 API 的字段、互斥关系和特殊限制。由 Aion Adapter 负责转换和最终校验，ManuEval 不复制供应商适配代码。

ManuEval 复用的是 MCP 的**输入语义**，不是直接调用 MCP 工具。MCP 文档中的异步 runner 返回格式、`call_reason` 和 `saved_path` 不等于 ManuEval 调用 Aion Model API 的 HTTP 合同。

### 2.2 用户意图和实际值

- **映射意图**是批次级配置，例如“`人物正面图`列是参考元素 1 的正面图”。
- **实际输入**是 case 级数据，例如某一行该列为空、另一行非空。
- **生成方式**必须根据每一行编译后的非空实际输入决定，而不是只根据批次映射或列名决定。

因此，同一批次使用同一个模型，但不同 case 可以分别成为文生视频、单图生视频、首尾帧生视频或参考生视频。

## 3. 合同来源和优先级

有效合同按下列层次构造：

1. **飞书 MCP 文档 revision 1813**：定义标准字段、数据结构和字段语义。
2. **Aion 实时结构化配置**：定义当前模型实际开放的模式、输入字段、必填项、数量范围、枚举、参数范围和默认值。
3. **Aion Model API / Adapter**：负责把标准输入转换为供应商请求，并执行供应商级最终校验。
4. **经审查的默认 Plugin 机器规则快照**：只产生可审阅建议，不在运行时解析 Markdown，不静默修改请求。
5. **模型 `description`**：用于向用户完整展示能力和限制，但不在运行时解析自然语言形成隐藏规则。
6. **ManuEval 明示的安全策略和人工覆盖**：合同不能确定唯一模式时先停止该 case；操作者可在审计和二次计费确认后覆盖。

关键原则：

- Aion 配置可以缩小 MCP 能力，但不能改变 MCP 字段语义。
- 例如，即使某模型配置把 `image_urls_count_range` 写成 1 到 9，MCP 视频合同中的 `image_urls` 仍然只承载 1 张单图驱动或 2 张双帧输入；普通多图参考必须进入 `elements`。
- `description` 会影响界面说明、风险提示和人工判断，但不能通过关键词或正则自动生成请求规则。自然语言会变化、可能过期，也可能与结构化配置冲突。
- 如结构化配置与描述明显冲突，预检应展示“模型合同冲突”。在冲突影响输入语义、费用或生成方式时，应阻止付费提交，等待配置或 Adapter 合同确认；不得静默任选一方。

## 4. `generate_video` 字段逐项对接

下表中的“文档事实”来自 revision 1813；“ManuEval 入口”是本文建议的产品设计。

| MCP 字段 | 文档类型 | 文档事实 | ManuEval 入口与处理 |
| --- | --- | --- | --- |
| `model_name` | `string`，必填 | 精确模型标识，不能猜测 | 批次模型选择器；不允许从数据集映射，同批统一模型 |
| `prompt` | `string \| VideoMultiPromptItem[] \| null` | 普通文本或多镜头数组；子项包含 `prompt`、`duration` | 必选来源列，并明确选择“普通文本 / 多镜头 JSON / 保留 JSON 类型”；不按字符串首字符自动猜测 |
| `call_reason` | `string \| null` | MCP 调用原因元数据 | ManuEval 直连 Aion，无需展示或发送 |
| `image_urls` | `string[] \| null` | 文档写作“input reference images”，紧接着明确：1 张用于 image-to-video，2 张用于 dual-frame | 专用“单图/双关键帧”入口；不作为普通多图参考入口；视频中最多 2 张 |
| `elements` | `MCPVideoElement[] \| null` | reference-to-video 的参考元素列表 | “参考元素编排器”或完整 `elements` JSON 数组列；支持多个有序元素 |
| `audios` | `MCPVideoAudioInput[] \| null` | 参考音频列表；每项包含 `url` 和可选 `range` | “参考音频编排器”或完整 `audios` JSON 数组列；保持顺序和小数精度 |
| `duration` | `number \| null` | 视频时长；模型支持时可为小数 | 生成参数：统一值、数据集列或跟随参考音频；最终受实时配置约束 |
| `aspect_ratio` | `string \| null` | 如 `16:9`、`9:16` | 生成参数；选项取实时配置，不自由猜测 |
| `resolution` | `string \| null` | 文档列出 `540p/720p/1080p/1440p/2160p` | 生成参数；MCP 列表与实时模型选项取有效交集 |
| `generate_audio` | `boolean`，默认 `false` | 是否由视频模型生成音频 | 布尔生成参数；不是参考音频，不参与生成方式推导 |
| `negative_prompt` | `string \| null` | 模型支持时使用 | 仅实时配置声明支持时展示和发送 |

### 4.1 `image_urls` 的准确语义

MCP 文档在描述中使用了“reference images”一词，但同一句对数量对应的生成方式有明确限定：

- 1 张：image-to-video 的单图输入。
- 2 张：dual-frame 的双帧输入，顺序为第一帧、最后一帧。

因此界面不应把 `image_urls` 命名成没有边界的“参考图”。建议命名为：

- “单图 / 双关键帧输入”作为分组名。
- 第一列标为“驱动图 / 首帧”。
- 第二列标为“尾帧，仅双帧模式使用”。
- 数组列标为“`image_urls` 数组列，仅允许 1 或 2 张”。

单图可以俗称“首帧图”，但审计中应准确记录为“single-image image-to-video”。它不同于 `elements` 中用于主体、角色或风格参考的图片。

两张普通参考图片不得放入 `image_urls`。否则请求会被解释为首尾帧约束，这正是本次必须消除的错误。

### 4.2 `elements` 的准确语义

MCP `MCPVideoElement` 包含以下可选字段：

```ts
type MCPVideoElement = {
  reference_image_urls?: string[];
  frontal_image_url?: string;
  video_url?: string;
  element_id?: number;
};
```

文档原始 schema 没有声明 JSON Schema `oneOf`，所以“图片 / 视频 / element ID 完全互斥”不是 MCP 明文事实。为避免把用户意图混进一个结构后由 Adapter 静默丢字段，ManuEval 建议采用保守的元素主类型：

- **图片元素**：可同时包含一个 `frontal_image_url` 和多个有序 `reference_image_urls`。同一个人物或对象的正面图、多视角图应放在同一个元素中。
- **视频元素**：包含一个 `video_url`。
- **已有元素**：包含一个整数 `element_id`。文档描述该 ID 为已有 Kling element binding ID，因此是否对其他模型有效必须由实时配置或 Adapter 明确支持。

不同人物或对象应建立不同元素。所有元素保持用户排序；某 case 中完全为空的元素省略，剩余元素紧凑编号为 `Element1...N`。

示例：两张图片代表两个独立参考对象：

```json
{
  "elements": [
    { "frontal_image_url": "https://example.com/reference-a.png" },
    { "frontal_image_url": "https://example.com/reference-b.png" }
  ]
}
```

示例：三张图片代表同一个人物的正面和其他视角：

```json
{
  "elements": [
    {
      "frontal_image_url": "https://example.com/front.png",
      "reference_image_urls": [
        "https://example.com/left.png",
        "https://example.com/right.png"
      ]
    }
  ]
}
```

### 4.3 `audios` 的准确语义

标准结构为：

```ts
type MCPVideoAudioInput = {
  url: string;
  range?: [number, number];
};
```

规则：

- `range` 必须恰好有两个有限数字，且 `0 <= start < end`。
- 保留输入的小数精度，不自行四舍五入。
- 多个音频保持用户排序。
- `audios` 是参考音频素材；`generate_audio` 是模型是否生成声音的开关，两者不得混为一项。
- MCP 文档没有承诺“只有音频、没有图片或元素”对所有模型都成立。音频单独输入只在实时结构化配置明确支持时允许，否则该 case 预检失败。

### 4.4 `prompt` 的准确语义

普通 Prompt 和多镜头 Prompt 是不同的数据类型，不能靠字符串内容猜测：

```json
[
  { "prompt": "镜头一的描述", "duration": 2.5 },
  { "prompt": "镜头二的描述", "duration": 3 }
]
```

建议提供三种明确格式：

- **普通文本**：单元格始终按字符串发送，即使文本以 `[` 开头。
- **多镜头 JSON**：单元格必须解析成数组，每项必须有非空 `prompt` 和正有限数 `duration`。
- **保留 JSON 数据类型**：用于 JSON 数据集已经存储字符串或对象数组的场景；类型不匹配时失败，不做含糊转换。

MCP 允许多镜头子项时长为数字；是否允许小数、总时长范围和镜头数量继续由 Aion 实时配置收窄。

## 5. ManuEval 输入映射界面

新任务只展示一套内容映射，不再展示“VidMuse MCP”和“辅助映射”两套容易重复的入口。

### 5.1 内容输入区

1. **Prompt**
   - 来源列。
   - 格式：普通文本、多镜头 JSON、保留 JSON 类型。
2. **单图 / 双关键帧**
   - 不使用。
   - 驱动图/首帧列 + 可选尾帧列。
   - `image_urls` 数组列，逐 case 只允许 1 或 2 项。
3. **参考元素**
   - 不使用。
   - 元素编排器：可增加、删除、排序多个图片、视频或已有 ID 元素。
   - `elements` JSON 数组列：适合已有精确分组或复杂结构的数据集。
4. **参考音频**
   - 不使用。
   - 音频编排器：每项映射 URL 和可选区间。
   - `audios` JSON 数组列。

默认情况下只自动映射 Prompt。唯一例外是精确匹配下列字段的“VidMuse 评测集预设”，它会形成**仍可编辑的草案**，不做相似列名推断：

`case_id, modality, prompt, duration, aspect_ratio, resolution, generate_audio, audio_url, image_urls, elements`

导入后，ManuEval 可以按数据集 schema 的 `sourceKey` 将这些原始列名解析为内部存储键。例如附件中的 `prompt`、`audio_url`、`case_id` 在界面可能显示为已有中文业务列 `完整Prompt`、`音频_URL`、`用例ID`。预设只在 `sourceKey` 精确相等时生效，不把中文显示名或相似列名反向猜成 MCP 字段；预检审计同时保留原始来源列和实际读取键。

- 视频：`image_urls` 保持关键帧通道，`elements` 保持元素数组，`audio_url` 构造成一个 `audios` 项。
- 图片：`image_urls` 编译成 `generate_image.images`；不读取视频元素和音频。
- `duration/aspect_ratio/resolution/generate_audio` 仅在实时模型配置声明对应控制时采用数据集列来源。
- `effects/intent/variant_label/source_*` 等列完整保留，但不会改变输入或发送给模型。
- `modality` 只用于让图片模型选择 image case、视频模型选择 video case，不发送给 Aion。

附件实测为 188 行（164 video、24 image）；76 个 `image_urls` 和 74 个 `elements` 非空单元格均为合法数组。完整附件不进入测试仓库，只提交覆盖相同列结构和风险形态的精简 fixture。

### 5.2 生成参数区

生成参数和素材输入必须分开。每个参数只有一个来源：

- 统一值。
- 数据集列。
- 不使用，仅适用于可选参数。

数据集列模式中，某 case 单元格为空或格式错误时，该 case 失败，不回退到统一值。`false` 和 `0` 是有效值，不能被压缩逻辑删除。

标准 MCP 参数包括 `duration`、`aspect_ratio`、`resolution`、`generate_audio`、`negative_prompt`。`seed`、`watermark`、`480p` 不在本次读取的 MCP `generate_video` 字段中，只能在 Aion 实时配置明确声明时作为“Aion 模型扩展参数”展示和发送，不能标成 MCP 标准输入。

已知不应作为新任务顶层入口的字段：

- `reference_image_urls`：应位于 `elements[].reference_image_urls`。
- `reference_video_urls`：应转换为多个 `elements[].video_url`。
- `audio_url`：附件预设只把该列编译成 `audios=[{"url": value}]`。ManuEval compiler v3 不再静默降级为顶层 `audio_url`；实时配置只声明旧字段时明确预检失败。
- `multi_shots`：应使用数组形式的 `prompt`。
- `model_name`、`generation_type`：保留字段，不允许从数据集映射。

### 5.3 模型描述的展示

选择模型后，界面应完整显示实时配置中的 `description`，并在预检中保存快照。描述用于说明模型特有限制，例如总媒体数、音频互斥、提示词长度或特殊分辨率。

系统不自动解析描述来生成字段、默认值或互斥规则。可执行校验必须来自结构化配置或经代码和 Adapter 合同验证的版本化规则。这样既使用了描述提供的信息，又不会因文案修改而改变请求行为。

## 6. 每个 case 的生成方式推导

`generation_type` 不是 MCP 输入字段，也不由用户填写。它是 ManuEval 编译 MCP 语义输入后，为 Aion Model API 生成的桥接字段。

| 该 case 编译后的非空媒体 | MCP 内容 | ManuEval 请求模式 |
| --- | --- | --- |
| 无媒体 | 不发送媒体字段 | `text_to_video` |
| 1 张 `image_urls` | `image_urls=[image]` | `image_to_video` |
| 2 张 `image_urls` | `image_urls=[first,last]` | `images_to_video` |
| 一个或多个 `elements` | `elements=[...]` | `reference_to_video` |
| `elements` + `audios` | 两个字段均发送 | `reference_to_video` |
| 只有 `audios` | `audios=[...]` | 仅在实时配置明确支持时为 `reference_to_video`，否则无效 |
| `image_urls` + `elements/audios` | MCP 无唯一通用模式 | 进入合同审阅；接受近似转换或人工配置，不直接提交 |
| 只有尾帧 | 意图不完整 | 不提交该 case |
| `image_urls` 超过 2 张 | 违反 MCP 通道语义 | 不提交该 case |

### 6.1 为什么混合输入先进入审阅

MCP schema 同时列出了 `image_urls`、`elements` 和 `audios`，但读取到的文档没有定义“关键帧 + 参考元素/音频”的跨模型统一生成方式。不同供应商可能支持不同组合，也可能把字段解释成不同任务。

因此，compiler v3 不会为混合输入直接选择 generation type。该 case 先以 `manual_review` 展示并阻止提交，这是 ManuEval 的安全设计，不是 MCP 原文中的显式互斥条款。

固定 Plugin 快照可提出“把关键帧追加成普通图片元素”的近似方案，并展示转换后的 Prompt 和请求；只有用户明确接受后才应用，审计会标记已失去真实首尾帧约束。拒绝建议后仍可编辑最终 Aion JSON 并强制提交，但必须填写原因和确认重复计费风险。

### 6.2 同批不同生成方式示例

假设批次映射了 `首帧_URL`、`尾帧_URL` 和 `elements_json` 三列：

| case | 首帧 | 尾帧 | elements | 结果 |
| --- | --- | --- | --- | --- |
| A | 空 | 空 | 空 | `text_to_video` |
| B | 有 | 空 | 空 | `image_to_video` |
| C | 有 | 有 | 空 | `images_to_video` |
| D | 空 | 空 | 有 | `reference_to_video` |
| E | 有 | 空 | 有 | 仅 E 进入审阅；A-D 正常推导 |

映射配置在批次级保持一致，但每行空值经过规范化后单独推导模式。E 的失败不阻止 A-D 继续形成有效预检结果。

### 6.3 Aion 模式归一化边界

ManuEval v3 始终按 MCP 语义把双帧请求发送为 `images_to_video`，不再根据 H3、Wan、Seedance 或其他模型名猜测 Adapter 所需模式。若某个 Adapter 需要另一种表示，应由 Aion 自己规范化，或由其结构化配置明确暴露；不能在 ManuEval 中新增隐藏的模型名分支。

预检展示语义模式、最终 Aion 请求以及 `[first, last]` 的字段顺序。实时配置与 MCP 语义冲突时，该 case 进入人工审阅，而不是被改标为普通参考生成。

## 7. 从数据集到实际生成的完整链路

```mermaid
flowchart LR
    DATA["CSV / JSON 数据集"] --> INTENT["批次级输入意图映射"]
    INTENT --> ROW["逐 case 提取非空值"]
    ROW --> NORM["MCP 语义规范化"]
    NORM --> MCPV["MCP 结构与意图校验"]
    MCPV --> RULE["Plugin 建议与人工审阅"]
    RULE --> MODE["逐 case 推导 generation_type"]
    MODE --> CFG["Aion 实时配置校验"]
    CFG --> REQ["构造最终 Aion 请求"]
    REQ --> ADAPTER["Aion Adapter 转供应商字段"]
    ADAPTER --> PROVIDER["供应商生成任务"]
    PROVIDER --> RESULT["轮询、资产链接、数据集回填"]
```

### 7.1 打开生成弹窗

1. ManuEval 后端实时读取 Aion 模型配置。
2. 前端只展示启用且符合当前输出模态的模型。
3. 保存配置快照和指纹。
4. 根据结构化 `capabilities`、`input_schema`、`supported_params` 和 `options` 构造可选参数；模型描述作为完整说明展示。

### 7.2 建立输入意图

用户明确选择 Prompt、关键帧、元素、音频及参数各自的来源。精确命中 VidMuse 评测集预设时自动形成映射草案，用户仍能逐项修改。其他数据集不根据相似列名或媒体数量跨通道猜测。

### 7.3 逐 case 编译

对每一行依次执行：

1. 读取原始单元格，保留原始值用于审计。
2. 解析所选列，空值按“该 case 未提供该素材”处理。
3. 按用户映射构建 `prompt`、`image_urls`、`elements` 和 `audios`。
4. 保持数组、编排器和单元格内部顺序。
5. 省略空元素并重新形成紧凑序号。
6. 执行 MCP 类型、URL、结构、范围和意图校验。
7. 生成 Plugin 建议；未确认建议、混合输入和相对素材停在审阅状态。
8. 在输入意图唯一后，根据实际非空字段推导该 case 的 `generation_type`。
9. 解析参数的唯一来源并合并到规范输入。

### 7.4 Aion 实时配置校验

对编译结果校验：

- 该模型是否支持推导出的生成方式。
- `supported_inputs` / `unsupported_inputs`。
- `required_inputs` / `required_one_of_inputs`。
- `image_urls`、`elements`、`audios` 及元素子字段数量范围。
- Prompt 长度和结构。
- 时长、宽高比、分辨率、布尔值和其他参数枚举/范围。
- MCP 标准参数与模型扩展参数是否放在正确位置。

MCP 和实时配置取交集。例如 `image_urls` 的数量上限始终不超过 2；模型只支持 1 张时，双帧 case 无效。

### 7.5 请求预览和提交

预检对每个 case 展示：

- 用户输入意图。
- 原始来源列和非空值摘要。
- 图片、元素和音频的最终顺序及编号。
- 规范化 MCP 输入。
- 推导出的 ManuEval 生成方式。
- 最终 Aion 请求体，隐藏账号凭据和服务器本地路径。
- 参数来源、模型配置快照/指纹和完整 description。
- 所有错误、警告和已应用的模型专项规则。

批次提交前重新读取 Aion 配置并比较指纹。配置变化时要求重新预检，不能用旧快照直接付费提交。

### 7.6 Worker 和结果链路

Worker 使用预检中保存的 resolved case；人工覆盖时直接使用已验证并审计的最终请求快照。执行阶段不重新猜测输入意图。Aion Adapter 转换供应商字段并返回任务 ID；ManuEval 轮询任务、提取 VidMuse 稳定资产或临时回退地址，并回填新数据集版本。该部分不改变输入语义。

## 8. 校验分层

### 8.1 MCP 基础合同校验

- Prompt 类型正确，多镜头数组每项结构正确。
- `image_urls` 为 URL 数组，视频任务只允许 1 或 2 张。
- `elements` 为对象数组，只包含 MCP 声明字段。
- 图片元素、视频元素和已有 ID 元素的主类型明确。
- `audios` 为对象数组，URL 和 range 合法。
- URL、数组、有限数字、空值和未知字段逐项校验。
- `model_name`、`generation_type` 不能由数据集提供。

### 8.2 Aion 实时结构化配置校验

- 模式、字段支持、必填项和 one-of 要求。
- 数量范围、枚举、数值范围和必填参数。
- 只发送配置声明支持的模型扩展字段。
- 不自动调整评测时长，继续发送 `features.auto_adjust_duration_to_supported=false`。

### 8.3 ManuEval 安全策略

- 两张普通参考图必须进入 `elements`，不能自动放入 `image_urls`。
- 关键帧与参考元素/音频同时出现时进入审阅，未解决前阻断。
- 只有尾帧、关键帧超过两张、元素意图不清时阻断。
- 新模型没有 ManuEval 专项规则时，不因“未知模型”本身阻断；它仍须通过 MCP 合同和实时配置。复杂但结构化配置未明确的组合应显示“尚未专项验证”警告。

### 8.4 Adapter 最终校验

Aion Adapter 负责供应商私有字段、role、最终互斥和供应商错误。ManuEval 不能把 Adapter 当成唯一防线，因为供应商可能接受一个语义错误但格式合法的请求；因此用户意图必须在进入 Aion 前已经确定。

## 9. Prompt 中素材编号

素材顺序会影响模型专项占位符的对应关系，因此预检展示 `image_urls[1]`、`elements[1]`、`audios[1]` 等字段索引。当前读取到的 `generate_video` 字段 schema 本身没有定义 Prompt 中 `@imageN`、`@ElementN` 或 `@audioN` 的通用语法。

因此：

- `@imageN`、`@ElementN` 的校验只能作为 VidMuse/Aion 或模型结构化合同，不能标记成 MCP schema 明文规则。
- compiler v3 只有在 Aion 实时 `supported_inputs` 或 `supported_params` 明确声明相应素材通道时，才启用该通道的编号审计；不解析模型名或 `description`。
- 已确认通道中，引用越界阻断，素材存在但未引用只警告；相同错误在单 case 内去重展示。
- `@audioN` 在本次权威字段文档中未被确认；只有实时结构化配置明确声明 `audios` 通道时才进行编号审计，不能作为所有模型的通用 MCP token 自动校验。
- token 大小写规则必须来自对应 Adapter/产品合同；不能仅凭现有实现推定。

默认 Plugin 快照只提供可审阅的通道错位建议：来源通道唯一且编号一一对应时，可建议 `@imageN <-> @ElementN`；用户接受后才改写本批次 Prompt，原评测集不变。合同未知或编号无法对应时不自动改写。

## 10. 请求示例

### 10.1 文生视频

```json
{
  "generation_type": "text_to_video",
  "model_name": "selected-model",
  "prompt": "一名角色沿着街道向前走",
  "duration": 5,
  "resolution": "1080p",
  "features": {
    "auto_adjust_duration_to_supported": false
  }
}
```

### 10.2 单图驱动视频

```json
{
  "generation_type": "image_to_video",
  "model_name": "selected-model",
  "prompt": "角色转头看向镜头",
  "image_urls": ["https://example.com/driver.png"]
}
```

### 10.3 首尾帧视频

```json
{
  "generation_type": "images_to_video",
  "model_name": "selected-model",
  "prompt": "从室内平滑移动到室外",
  "image_urls": [
    "https://example.com/first.png",
    "https://example.com/last.png"
  ]
}
```

### 10.4 两个普通图片参考元素

```json
{
  "generation_type": "reference_to_video",
  "model_name": "selected-model",
  "prompt": "让两个参考角色在场景中互动",
  "elements": [
    { "frontal_image_url": "https://example.com/character-a.png" },
    { "frontal_image_url": "https://example.com/character-b.png" }
  ]
}
```

这里不能使用双项 `image_urls`，否则语义会变成首尾帧。

### 10.5 参考元素和参考音频

```json
{
  "generation_type": "reference_to_video",
  "model_name": "selected-model",
  "prompt": "角色根据参考音频完成表演",
  "elements": [
    { "video_url": "https://example.com/performance.mp4" }
  ],
  "audios": [
    {
      "url": "https://example.com/dialogue.wav",
      "range": [1.25, 6.75]
    }
  ]
}
```

以上示例只表达字段和生成方式关系。具体模型是否支持该组合，仍由实时配置和 Adapter 决定。

## 11. 审计与持久化

每个 case 的预检快照至少应保存：

- 编译器/合同版本。
- 原始单元格值。
- 用户映射意图和编排顺序。
- 规范化 MCP 输入。
- ManuEval 推导的 generation type。
- 最终 Aion 请求。
- 如存在 Adapter 模式归一化，保存请求模式和已知有效模式。
- 参数来源和规范化值。
- 模型配置快照、指纹和 description。
- 应用的规则、错误和警告。
- Plugin 快照名称、commit、规则 ID、建议内容以及接受/拒绝结果。
- 人工覆盖的操作者、时间、原因、原请求、最终请求、绕过规则和配置指纹。

不得在 API、预检展示或数据集伴随列中泄露服务器本地路径、专用用户凭据或内部鉴权信息。

## 12. 历史任务兼容

- 新任务使用版本化的内容映射合同，例如 `GenerationContentMappingV2`。
- 已保存的历史预检、运行中批次和旧 `GenerationInputMapping` 继续使用原快照与旧编译器，不在恢复时套用新语义。
- 历史兼容逻辑可以保留在服务端，但新任务界面不再提供会改变素材意图的 `reference_fallback`。
- 数据库 JSONB 足以保存版本化映射和审计数据，不要求为本输入规范单独迁移表结构。
- Worker、任务租约、重试、资产链接、数据集回填和人工评测链路不因本规范改变。

## 13. 实际实现位置

| 职责 | 源码 |
| --- | --- |
| 附件精确列预设、modality 选择 | `src/features/generation/inputMapping.ts`、`GenerationCaseSelector.tsx` |
| 内容映射与元素/音频编排 | `server/generation/generationContentMapping.ts` |
| MCP compiler v1/v2/v3 | `src/features/generation/vidmuseInputContract.ts` |
| 固定 Plugin 规则快照 | `src/features/generation/vidmusePluginContracts.ts` |
| 实时配置校验、请求构造 | `server/generation/generationPlanning.ts` |
| case 审阅、强制覆盖、安全校验 | `server/generation/generationPreflightService.ts` |
| 审阅 UI 与请求预览 | `DatasetGenerationExecutionModal.tsx` |
| Worker 执行与素材准备 | `server/generation/generationWorker.ts` |

新预检在 `GenerationContentMappingV2` 上使用 compiler v3。v3 不调用模型名 profile，不产生 H3/Wan/Seedance 特判；历史 compiler v1/v2 代码保留，仅用于历史快照与回归。数据库继续使用既有 JSONB，无迁移。

## 14. 审阅和人工覆盖规范

### 14.1 普通建议

- Plugin 通道错位和近似转换均保存为 finding。
- 用户可逐 case 接受、拒绝，或按相同 rule ID 批量接受。
- Prompt 可逐 case 任意编辑；修改只进入本次预检和批次快照。
- 审阅变化后必须重新预检；新的规范输入和最终请求产生新的请求哈希。

### 14.2 强制覆盖

相对 `online-mining/...` 素材、未知音频单独模式、实时配置不支持的组合或最终 Aion JSON 编辑，需要填写原因并确认重复计费风险。覆盖后标记为“不再保证 MCP 对齐”。

无论是否强制，以下内容不可覆盖：

- Aion endpoint、专用账号和选中模型。
- `features.auto_adjust_duration_to_supported=false`。
- `result_file_dir`、`preview_file_dir`、callback/webhook。
- 鉴权、token、secret、credential、API/access/private key。
- `file://`、路径穿越和危险对象键。

Worker 不自动重发生成 POST；`submission_unknown` 仍需用户明确手动重试。人工覆盖请求会把最终 body 固定在审计快照中，执行阶段只做已批准的素材 URL 准备。

### 14.3 新模型接入

1. Aion 配置必须声明 output modality、capabilities、输入 schema、支持参数和范围。
2. ManuEval 先使用 MCP revision 1813 基础合同和实时配置，不新增模型名判断。
3. 普通文字、单图、双帧和元素参考可在结构化合同足够时直接预检。
4. 音频单独或跨通道组合只有结构化合同能确定唯一模式时自动成立，否则进入人工配置。
5. 若需要模型专用 Prompt token 或互斥建议，应在 Plugin 仓库提供版本化机器合同；更新 ManuEval 固定快照并补测试后才能生效。
6. `description` 始终展示，但不转成运行时规则。

## 15. 验收标准

实现最终按本文 review 版本调整后，至少验证：

- 文字、单图、首尾帧、多个参考图片、多视角同元素、参考视频、已有 element ID、参考音频及多媒体参考。
- 同一批次中不同 case 产生不同 generation type。
- 两张参考图只进入 `elements`；两张关键帧只进入 `image_urls` 且顺序稳定。
- 关键帧和参考素材冲突、尾帧缺首帧、关键帧超过两张、元素结构不明确、音频区间错误均只使对应 case 失败。
- 多镜头小数时长和音频小数区间不被擅自取整。
- Aion 实时配置缩小 MCP 能力时正确阻断，不把配置中的大数量范围误用到 `image_urls`。
- 未知模型通过 MCP 基础合同和实时配置后可使用，不因缺少 ManuEval 专项 profile 被无条件阻断。
- 预检准确展示规范化 MCP 输入、最终 Aion 请求、模式、顺序、配置快照和 description。
- 历史映射、运行中任务、Worker 恢复、稳定资产、回填和人工评测不回归。
- 最终 dev 付费验收应分别执行“双参考图”和“双关键帧”case；执行前单独确认，禁止因测试失败自动重提付费请求。

## 16. 本轮结论

最重要的边界不是“传几张图片”，而是“用户将图片声明为什么角色”：

- 单图驱动或首尾帧约束进入 `image_urls`。
- 普通参考图片、参考视频和已有元素进入 `elements`。
- 参考音频进入 `audios`。
- 每个 case 根据实际非空输入推导模式。
- 实时配置只负责判断选定模型能不能做，不能替用户重新解释素材角色。

在这套链路下，两张普通参考图不会再因为数量为 2 被误当成首尾帧；只有用户明确把它们映射到双关键帧通道时，才会生成 dual-frame 请求。
