import type {
  StructuredAuditSeverity,
  StructuredEvaluationIssue,
} from './structuredEvaluationQualityAudit.ts';

type IssueReviewCopy = {
  explanation: string;
  recommendation: string;
};

export type StructuredIssueReviewSummary = IssueReviewCopy & {
  code: string;
  severity: StructuredAuditSeverity;
  count: number;
  fields: string[];
  evidence: string[];
};

const ISSUE_REVIEW_COPY_ZH: Record<string, IssueReviewCopy> = {
  IMPORT_PROVENANCE_MISSING: {
    explanation: '该行缺少飞书 record ID、原始值或来源哈希，无法证明导入内容与来源记录一一对应。',
    recommendation: '从已验证的飞书快照重新导入该 case，并保留完整隐藏溯源字段。',
  },
  MODALITY_INVALID: {
    explanation: 'modality 不是 image 或 video，平台无法选择正确的 MCP 工具和生成接口。',
    recommendation: '在来源数据中明确改为 image 或 video，不要根据 cell_id 自动猜测。',
  },
  STRUCTURED_JSON_INVALID: {
    explanation: '结构化字段不是合法 JSON，因此不能可靠解析素材顺序和角色。',
    recommendation: '修正为合法 JSON 数组，并保持原本希望的素材顺序。',
  },
  STRUCTURED_ARRAY_REQUIRED: {
    explanation: '该结构化字段需要 JSON 数组，但当前值是其他类型。',
    recommendation: '用方括号包装为数组；即使只有一个素材也要使用单元素数组。',
  },
  ELEMENT_OBJECT_REQUIRED: {
    explanation: 'elements 中的成员不是对象，无法表达图片元素、视频元素或已有 element ID。',
    recommendation: '将该成员改成一种合法的 element 对象。',
  },
  ELEMENT_MODE_CONFLICT: {
    explanation: '同一个 element 同时包含图片、视频或已有 ID 等互斥形态，Adapter 可能丢字段或误判素材角色。',
    recommendation: '确认真实意图后只保留一种形态，或拆成多个独立 element。',
  },
  ELEMENT_REFERENCE_ARRAY_REQUIRED: {
    explanation: 'reference_image_urls 不是有序字符串数组，无法稳定对应同一元素的多视角参考图。',
    recommendation: '改成 URL 字符串数组，并按希望的参考顺序排列。',
  },
  KEYFRAME_COUNT_INVALID: {
    explanation: '视频 image_urls 超过两项，违反 MCP 的单图驱动或双关键帧通道语义。',
    recommendation: 'image_urls 最多保留首帧和尾帧；普通参考图片移入 elements。',
  },
  IMAGE_URL_STRING_REQUIRED: {
    explanation: 'image_urls 中存在空值或非字符串，不能作为有效图片 URL 提交。',
    recommendation: '删除空项，并将每一项改成可访问的图片 URL 字符串。',
  },
  IMAGE_MODEL_VIDEO_INPUT_PRESENT: {
    explanation: '图片 case 使用了只属于视频生成的 elements 或 audio_url 输入。',
    recommendation: '图片参考放入 image_urls，移除视频或音频输入，或把 case modality 改为 video。',
  },
  MIXED_MEDIA_CONTRACT_REVIEW: {
    explanation: '该 case 同时使用关键帧和参考元素或音频，MCP 没有对所有模型通用的唯一生成方式。',
    recommendation: '按目标模型合同明确选择关键帧生成或参考生成；确认前不要依赖图片数量猜测。',
  },
  AUDIO_ONLY_CONTRACT_REVIEW: {
    explanation: '该 case 只有参考音频，没有图片或视频元素，并非所有模型都支持音频单独驱动。',
    recommendation: '只选择实时结构化配置明确支持 audio-only reference 的模型，否则补充所需视觉输入。',
  },
  PROMPT_MISSING: {
    explanation: 'Prompt 为空，模型缺少需要生成的内容描述。',
    recommendation: '补充明确 Prompt 后重新预检。',
  },
  PROMPT_REFERENCE_OUT_OF_RANGE: {
    explanation: 'Prompt 中的素材占位符 @ImageN、@ElementN 或 @audioN 不存在或通道不匹配，模型无法找到对应素材。',
    recommendation: '核对最终素材编号和通道，修正占位符，或补充缺失素材；普通参考图应使用 elements。',
  },
  FRAME_INTENT_CHANNEL_MISMATCH: {
    explanation: 'Prompt 描述了首帧或尾帧约束，但对应素材没有进入 image_urls 关键帧通道。',
    recommendation: '真正的首尾帧按顺序放入 image_urls；若只是普通参考图，则改写 Prompt 并放入 elements。',
  },
  AUDIO_INTENT_CONTRADICTION: {
    explanation: 'Prompt 要求静音，但 generate_audio=true，文字意图与显式参数互相矛盾。',
    recommendation: '根据真实目标关闭 generate_audio，或删除 Prompt 中的静音要求。',
  },
  PROMPT_PARAMETER_CONTRADICTION: {
    explanation: 'Prompt 中写出的分辨率或画幅比例与结构化参数不一致。',
    recommendation: '统一 Prompt 和显式参数，以显式参数作为最终执行值。',
  },
  RELATIVE_ASSET_URL: {
    explanation: '素材是相对路径，Aion 和供应商无法在没有专用解析器的情况下直接访问。',
    recommendation: '替换为稳定的公网 URL；只有确认目标模型存在对应解析器时才人工放行。',
  },
  NON_PUBLIC_ASSET_URL: {
    explanation: '素材地址指向本机、内网或其他非公网位置，模型服务通常无法访问。',
    recommendation: '将素材放到模型服务可访问的稳定公网地址后重新预检。',
  },
  MEDIA_TYPE_MISMATCH: {
    explanation: '素材实际媒体类型与所在 MCP 字段不一致，例如把 MP4 放进图片或音频字段。',
    recommendation: '把素材移到与真实媒体类型匹配的字段，或换成正确格式；不能只修改扩展名。',
  },
  MEDIA_TYPE_UNVERIFIED: {
    explanation: '仅凭 URL 或响应信息无法确认素材类型，存在发送到错误通道的风险。',
    recommendation: '核对响应 MIME 和解码结果，确认类型后再生成。',
  },
  MEDIA_HTTP_UNREACHABLE: {
    explanation: '审计时无法通过 HTTP 获取素材，模型执行时也可能下载失败。',
    recommendation: '更换为无需临时登录、未过期且稳定可访问的公网链接，然后重新探测。',
  },
  MEDIA_DECODE_FAILED: {
    explanation: 'ffprobe/ffmpeg 无法解码素材，文件可能损坏、格式异常或实际返回的不是媒体内容。',
    recommendation: '重新编码或替换素材，确认可完整解码后再生成。',
  },
  MEDIA_STREAM_TYPE_MISMATCH: {
    explanation: '文件可以打开，但内部没有当前字段要求的媒体流，例如图片字段中的 MP4 没有图片流。',
    recommendation: '按真实流类型移动到正确字段，或替换为该字段要求的媒体文件。',
  },
  IMAGE_RESOLUTION_LOW: {
    explanation: '参考图尺寸偏低，人物身份、文字或细节评测容易受清晰度限制。',
    recommendation: '优先替换为更清晰、更高分辨率且内容一致的参考图。',
  },
  VISUAL_REFERENCE_SOFT: {
    explanation: '人工检查发现参考图明显偏糊，虽然可辨认，但身份细节不足。',
    recommendation: '身份一致性相关 case 应换用更清晰的正脸或主体参考图。',
  },
  VISIBLE_WATERMARK: {
    explanation: '参考素材带有可见水印，可能被模型复现并干扰画质或一致性评价。',
    recommendation: '替换为无水印的同内容素材，再进行正式评测。',
  },
  AUDIO_SAMPLE_RATE_LOW: {
    explanation: '参考音频采样率偏低，可能损失歌词、节奏或音色细节。',
    recommendation: '试听确认；涉及声音质量或口型同步时换用更高采样率来源。',
  },
  AUDIO_SHORTER_THAN_CASE: {
    explanation: '参考音频时长短于 case 目标时长，后半段缺少可供跟随的声音内容。',
    recommendation: '换用覆盖完整生成时长的音频，或明确缩短该 case 的 duration。',
  },
  AUDIO_SILENCE_HIGH: {
    explanation: '参考音频中静音占比较高，可能无法提供足够的节奏、歌词或口型驱动信息。',
    recommendation: '人工试听确认静音是否有意；无意时裁剪或更换音频。',
  },
  AUDIO_CLIPPING_RISK: {
    explanation: '音频峰值接近或超过满幅，存在削波失真风险。',
    recommendation: '先试听是否失真；有失真时换源或规范化音量后再评测。',
  },
};

const severityRank: Record<StructuredAuditSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4,
};

export const summarizeStructuredIssuesForReview = (
  issues: StructuredEvaluationIssue[],
): StructuredIssueReviewSummary[] => {
  const grouped = new Map<string, StructuredIssueReviewSummary>();
  issues.forEach(issue => {
    const copy = ISSUE_REVIEW_COPY_ZH[issue.code] || {
      explanation: `该 case 触发了 ${issue.code} 审计规则，但尚未配置专门的中文说明。`,
      recommendation: '结合涉及字段和证据人工确认真实意图，修正后重新运行预检。',
    };
    const existing = grouped.get(issue.code);
    if (!existing) {
      grouped.set(issue.code, {
        code: issue.code,
        severity: issue.severity,
        count: 1,
        fields: issue.field ? [issue.field] : [],
        evidence: issue.evidence ? [issue.evidence] : [],
        ...copy,
      });
      return;
    }
    existing.count += 1;
    if (severityRank[issue.severity] > severityRank[existing.severity]) existing.severity = issue.severity;
    if (issue.field && !existing.fields.includes(issue.field)) existing.fields.push(issue.field);
    if (issue.evidence && !existing.evidence.includes(issue.evidence)) existing.evidence.push(issue.evidence);
  });
  return [...grouped.values()];
};
