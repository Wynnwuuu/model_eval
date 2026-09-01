import type {
  GenerationContractFinding,
  GenerationContractProposal,
  GenerationPreflightCase,
  GenerationPreflightIssue,
} from '../../types.js';
import {
  GENERATION_FORCEABLE_PREFLIGHT_CODES,
  GENERATION_FINAL_JSON_REQUIRED_CODES,
} from './preflightReview.js';

export type GenerationCaseStatusFilter = 'needs_attention' | 'invalid' | 'warning' | 'valid' | 'all';
export type GenerationIssueSeverity = 'error' | 'warning';

interface GenerationIssueCopy {
  title: string;
  description: string;
  suggestion: string;
}

export interface GenerationIssuePresentation extends GenerationIssueCopy {
  issue: GenerationPreflightIssue;
  severity: GenerationIssueSeverity;
  blocking: boolean;
  forceable: boolean;
  requiresFinalJson: boolean;
}

export interface GenerationIssueOption {
  key: string;
  code: string;
  field: string;
  severity: GenerationIssueSeverity;
  count: number;
  label: string;
}

export type GenerationRepairKind =
  | 'prompt_channel_mismatch'
  | 'prompt'
  | 'media'
  | 'input_structure'
  | 'parameter'
  | 'generation_mode'
  | 'general';

export interface GenerationRepairDiagnostic {
  issue: GenerationPreflightIssue;
  severity: GenerationIssueSeverity;
  presentation: GenerationIssuePresentation;
}

export interface GenerationRepairGroup {
  id: string;
  kind: GenerationRepairKind;
  field?: string;
  title: string;
  description: string;
  suggestion: string;
  severity: GenerationIssueSeverity;
  diagnostics: GenerationRepairDiagnostic[];
  finding?: GenerationContractFinding;
  proposal?: GenerationContractProposal;
}

const issueCopy = (title: string, description: string, suggestion: string): GenerationIssueCopy => ({
  title,
  description,
  suggestion,
});

const ISSUE_COPY: Record<string, GenerationIssueCopy> = {
  INVALID_STRUCTURED_INPUT: issueCopy('结构化输入格式不正确', '映射到数组或对象的单元格无法按要求解析。', '检查对应列并使用有效 JSON，数组字段应使用 JSON 数组。'),
  INVALID_PROMPT_JSON: issueCopy('Prompt JSON 格式不正确', '多镜头或保留 JSON 类型的 Prompt 无法解析。', '修正 Prompt JSON，或将 Prompt 格式改为普通文本。'),
  INVALID_PROMPT: issueCopy('Prompt 内容无效', 'Prompt 的数据类型或内容不符合当前映射格式。', '填写非空文本，或选择与单元格内容一致的 Prompt 格式。'),
  INVALID_PROMPT_ITEM: issueCopy('多镜头 Prompt 子项无效', '至少一个镜头缺少 Prompt 或合法时长。', '检查每个镜头对象的 prompt 和 duration。'),
  UNKNOWN_PROMPT_FIELD: issueCopy('Prompt 包含未知字段', '多镜头 Prompt 中包含 MCP 合同未声明的字段。', '删除未知字段，保留 prompt 和 duration。'),
  PROMPT_TOO_LONG: issueCopy('Prompt 超出模型长度限制', '当前 Prompt 超出已解析的模型长度合同。', '精简 Prompt，或选择支持更长 Prompt 的模型。'),
  PROMPT_LENGTH_NOT_VERIFIED: issueCopy('数组 Prompt 长度尚未验证', '模型合同没有声明数组 Prompt 的长度作用范围，因此平台未进行近似或猜测性拦截。', '提交前核对模型合同；最终长度校验仍由 Aion Adapter 执行。'),
  PROMPT_REFERENCE_OUT_OF_RANGE: issueCopy('Prompt 引用了不存在的素材编号', 'Prompt 中的素材占位符没有对应的实际输入。', '修正编号，或补充对应素材。'),
  UNREFERENCED_PROMPT_ASSET: issueCopy('素材未在 Prompt 中引用', '已传入素材，但 Prompt 没有引用它。模型仍可能使用该素材。', '确认这是预期行为，或在 Prompt 中补充模型支持的占位符。'),
  INVALID_ASSET_URL: issueCopy('素材地址无效', '素材不是可提交的 HTTP(S)、上传资产或允许的相对地址。', '替换为有效公网 URL 或先上传素材。'),
  MISSING_ASSET: issueCopy('本地素材未找到', '评测集引用的本地文件没有匹配到已上传资产。', '上传缺失文件，并检查相对路径或文件名。'),
  MEDIA_TYPE_MISMATCH: issueCopy('素材类型与输入通道不匹配', '地址或 MIME 显示的媒体类型与图片、视频或音频通道不一致。', '把素材映射到正确通道，或确认风险后保留原值。'),
  MEDIA_TYPE_UNVERIFIED: issueCopy('无法确认素材类型', '素材地址和 MIME 都不足以确认实际媒体类型。', '人工检查素材可播放性和类型后再继续。'),
  NON_PUBLIC_ASSET_URL: issueCopy('素材地址可能无法被模型访问', '地址指向本机、内网或非标准公网主机。', '改用公网可访问地址，或确认模型侧确实能够访问。'),
  RELATIVE_ASSET_REQUIRES_REVIEW: issueCopy('相对素材地址需要确认', '该地址不是完整公网 URL，Aion 是否能解析取决于运行环境。', '确认相对地址在 Aion 中可解析，或改成完整公网 URL。'),
  INVALID_ELEMENT: issueCopy('参考元素格式不正确', 'elements 中至少一个条目不是合法对象。', '使用图片元素、视频元素或已有 element_id 三种结构之一。'),
  UNKNOWN_ELEMENT_FIELD: issueCopy('参考元素包含未知字段', '元素对象包含 MCP 合同未声明的字段。', '删除未知字段，按 MCP elements 结构填写。'),
  INVALID_ELEMENT_ID: issueCopy('Element ID 无效', 'element_id 不是非负整数。', '填写有效的已有元素 ID。'),
  INVALID_ELEMENT_MODE: issueCopy('参考元素形态冲突', '同一元素同时使用了图片、视频或 element_id 中的多种形态。', '每个元素只保留一种形态。'),
  MODEL_ELEMENT_IMAGE_LIMIT: issueCopy('元素图片数量超出模型限制', '图片元素包含的参考图数量超过当前模型合同。', '减少图片数量或拆分为模型支持的元素结构。'),
  INVALID_AUDIO_INPUT: issueCopy('参考音频格式不正确', 'audios 中至少一个条目缺少有效 URL。', '使用 {"url":"...","range":[start,end]} 结构。'),
  UNKNOWN_AUDIO_FIELD: issueCopy('参考音频包含未知字段', '音频对象包含 MCP 合同未声明的字段。', '只保留 url 和可选 range。'),
  INVALID_AUDIO_RANGE: issueCopy('参考音频区间无效', '音频区间必须满足 0 ≤ 开始时间 < 结束时间。', '修正 range 或改为使用完整音频。'),
  AUDIO_RANGE_WITHOUT_URL: issueCopy('音频区间缺少地址', '设置了截取区间，但没有音频 URL。', '补充音频地址或删除区间。'),
  AUDIO_RANGE_REQUIRES_AUDIOS: issueCopy('音频区间需要 audios 通道', '当前模型或请求形态不能在旧音频字段中表达区间。', '使用 MCP audios 对象数组，或人工审阅最终请求。'),
  MULTIPLE_AUDIOS_REQUIRE_AUDIOS: issueCopy('多音频需要 audios 通道', '多个音频不能通过单值旧字段准确发送。', '使用 MCP audios 对象数组。'),
  MULTIPLE_REFERENCE_AUDIOS: issueCopy('参考音频数量不符合时长跟随规则', '跟随参考音频时长时，每个 case 必须能唯一确定一个音频。', '只保留一个参考音频，或改用统一时长/时长列。'),
  MISSING_REFERENCE_AUDIO: issueCopy('缺少参考音频', '当前 case 选择跟随参考音频时长，但没有音频输入。', '补充音频，或改用其他时长来源。'),
  UNKNOWN_AUDIO_DURATION: issueCopy('无法读取参考音频时长', '平台未能可靠探测该音频的时长。', '检查音频公网可达性，或改用统一时长/时长列。'),
  REFERENCE_AUDIO_NOT_PUBLIC: issueCopy('参考音频不是公网地址', '模型服务可能无法读取该音频。', '提供公网音频 URL。'),
  AUDIO_DURATION_URL_MISMATCH: issueCopy('音频时长记录与地址不一致', '预检探测的音频与当前 case 实际音频不同。', '重新探测并执行预检。'),
  AUDIO_DURATION_RESOLUTION_MISMATCH: issueCopy('音频时长解析结果不一致', '保存的探测结果无法对应当前输入。', '重新探测并执行预检。'),
  REFERENCE_AUDIO_DURATION_UNSUPPORTED: issueCopy('模型不支持该音频时长', '参考音频解析出的时长不在模型允许范围。', '裁剪音频或选择受支持的时长。'),
  MCP_KEYFRAME_COUNT_EXCEEDED: issueCopy('关键帧数量超过 MCP 上限', 'image_urls 是关键帧通道，只允许一张驱动图或首尾两帧。', '普通参考图改放 elements，关键帧最多保留两张。'),
  MISSING_FIRST_FRAME: issueCopy('缺少首帧', 'case 提供了尾帧但没有首帧。', '补充首帧，或移除尾帧。'),
  MISSING_START_IMAGE: issueCopy('缺少驱动图或首帧', '当前生成方式需要首张关键帧。', '补充首帧输入。'),
  INVALID_IMAGE_ROLE_COUNT: issueCopy('关键帧角色数量无效', '首帧或尾帧映射产生了不允许的数量。', '确保每个 case 最多一张首帧和一张尾帧。'),
  CONFLICTING_IMAGE_ROLES: issueCopy('图片角色发生冲突', '同一素材或输入同时被解释为不同图片角色。', '明确区分关键帧与普通参考元素。'),
  MCP_INPUT_MODE_CONFLICT: issueCopy('关键帧与参考输入冲突', 'MCP 没有定义关键帧与 elements/audios 混合时的统一生成方式。', '选择关键帧生成或参考生成；需要例外时人工审阅最终请求。'),
  MODEL_INPUT_CONFLICT: issueCopy('模型不支持当前素材组合', '实时合同不允许这些输入通道同时使用。', '按模型限制减少或调整素材通道。'),
  CONFLICTING_VIDEO_AND_KEYFRAMES: issueCopy('参考视频与关键帧冲突', '当前模型不能同时接收参考视频和关键帧。', '二选一后重新预检。'),
  CONFLICTING_REFERENCE_VIDEO_INPUTS: issueCopy('参考视频来源冲突', '同一 case 同时使用了互斥的参考视频输入方式。', '只保留一种参考视频来源。'),
  REFERENCE_VIDEO_NOT_SUPPORTED: issueCopy('模型不支持参考视频', '实时模型配置未声明参考视频能力。', '选择支持参考视频的模型或移除该输入。'),
  REFERENCE_VIDEO_COUNT_OUT_OF_RANGE: issueCopy('参考视频数量超出范围', '参考视频数量不符合实时模型配置。', '调整视频数量到允许范围。'),
  INPUT_COUNT_OUT_OF_RANGE: issueCopy('素材数量超出模型范围', '一个或多个输入通道的素材数量不符合实时模型限制。', '根据字段和模型说明减少或补充素材。'),
  MULTIPLE_VALUES_FOR_SINGLE_INPUT: issueCopy('单值输入包含多个素材', '该字段只能接收一个值，但当前 case 解析出了多个。', '改用数组通道或只保留一个素材。'),
  UNSUPPORTED_INPUT: issueCopy('模型不支持该输入字段', '最终请求包含实时配置未声明支持的输入。', '移除该输入或选择支持它的模型。'),
  MISSING_REQUIRED_INPUT: issueCopy('缺少模型必需输入', '实时模型配置要求的字段没有有效值。', '补充提示词或对应素材。'),
  RESERVED_MCP_INPUT: issueCopy('映射了平台保留字段', 'model_name 等字段由批次统一控制，不能从数据集读取。', '移除该字段映射。'),
  INVALID_CASE_INPUT_OVERRIDE: issueCopy('Case 修改格式无效', '当前 case 保存的字段级修改无法按支持的版本或操作格式解析。', '清除该修改并重新填写对应字段。'),
  CASE_OVERRIDE_FIELD_NOT_ALLOWED: issueCopy('该内容字段不允许修改', '当前模型模态不接受这个内容字段，或该字段由平台控制。', '只修改当前模型支持的 Prompt、图片、元素或音频字段。'),
  CASE_OVERRIDE_PARAMETER_NOT_ALLOWED: issueCopy('该参数不允许逐 Case 修改', '参数未由实时模型配置声明，或属于平台保留参数。', '省略不受支持的评测集参数、切换模型，或在必要时使用专家覆盖。'),
  CONFLICTING_CASE_REVIEW_MODES: issueCopy('修复模式发生冲突', '字段级修复和最终 Aion JSON 覆盖同时启用，系统无法明确唯一请求来源。', '只保留普通字段修复或专家 JSON 覆盖中的一种。'),
  CONFLICTING_CASE_REVIEW_ACTIONS: issueCopy('同一字段存在多种修改', '同一 Prompt 同时启用了自定义修改和 Plugin 自动改写。', '选择采用建议，或只保留自行编辑的 Prompt。'),
  GENERATION_TYPE_REVIEW_REQUIRED: issueCopy('生成方式需要人工确定', '当前素材组合无法按基础 MCP 合同唯一推导生成方式。', '在详情中检查并提供最终 Aion JSON。'),
  AUDIO_ONLY_MODE_REVIEW_REQUIRED: issueCopy('纯音频生成方式需要人工确定', '只有音频输入时，基础 MCP 合同不足以确认模型生成方式。', '核对实时模型合同并提供最终 Aion JSON。'),
  UNSUPPORTED_GENERATION_TYPE: issueCopy('模型不支持推导出的生成方式', 'MCP 输入推导出的 generation_type 不在实时模型能力中。', '调整素材通道、切换模型，或人工提供最终请求。'),
  CONTRACT_REVIEW_REQUIRED: issueCopy('输入合同需要人工确认', 'Plugin 或合同规则发现需要人工决定的输入语义。', '查看规则建议，接受、拒绝或编辑最终请求。'),
  PLUGIN_MIXED_INPUT_REVIEW: issueCopy('Plugin 发现混合输入风险', '当前模型的 Plugin 规则提示素材组合可能互斥。', '核对模型说明后决定保留哪种输入。'),
  PLUGIN_PROMPT_CHANNEL_MISMATCH: issueCopy('Prompt 占位符与素材通道错位', 'Prompt 引用的通道与实际素材通道可能不一致。', '审阅 Plugin 建议并确认是否改写 Prompt。'),
  MODEL_PROMPT_SHAPE_UNSUPPORTED: issueCopy('模型不支持当前 Prompt 结构', 'Prompt 的文本或多镜头数组形态与模型合同不一致。', '切换 Prompt 格式或按模型要求重组。'),
  AUDIO_ONLY_NOT_SUPPORTED: issueCopy('模型不支持纯音频参考生成', '当前 case 只有参考音频，模型还需要图片或视频参考。', '补充参考元素或移除音频。'),
  UNVERIFIED_MODEL_COMBINATION: issueCopy('该素材组合尚未专项验证', '组合通过基础合同，但没有经过该模型的专项兼容验证。', '提交前人工核对模型说明和最终请求。'),
  COMPATIBILITY_FRAME_USAGE_UNCLEAR: issueCopy('转换后的关键帧用途不明确', '兼容转换后 Prompt 没有明确说明原关键帧用途。', '编辑 Prompt，明确这些参考元素的作用。'),
  COMPATIBILITY_REFERENCE_FALLBACK: issueCopy('关键帧已转换为参考元素', '当前请求不再使用真正的首尾帧约束。', '确认参考生成符合评测意图。'),
  UNSUPPORTED_PRESET_PARAMETER: issueCopy('评测集参数不受模型支持', '评测集单元格有值，但实时模型合同不支持该参数。', '切换模型、明确设为不使用，或逐 case 提供最终 Aion JSON。'),
  PRESET_PARAMETER_EXPLICITLY_OMITTED: issueCopy('评测集参数已明确省略', '该列有值，但用户选择了不发送此参数。', '确认省略符合本次评测设置。'),
  UNSUPPORTED_CONTROL_VALUE: issueCopy('参数值不受模型支持', '单元格值不在实时模型配置允许的枚举中。', '改为允许值或切换模型。'),
  CONTROL_OUT_OF_RANGE: issueCopy('参数值超出模型范围', '数值低于最小值或高于最大值。', '调整到实时模型配置允许范围。'),
  INVALID_CONTROL_VALUE: issueCopy('生成参数格式不正确', '参数值无法按模型要求解析。', '检查数字、布尔、枚举或 JSON 格式。'),
  INVALID_PARAMETER_VALUE: issueCopy('参数列值格式不正确', '该 case 的参数列无法按声明类型解析。', '修正单元格值。'),
  MISSING_PARAMETER_COLUMN_VALUE: issueCopy('参数列缺少值', '已选择从列读取，但该 case 的单元格为空。', '补充单元格，或改为统一值/不使用。'),
  MISSING_DURATION_COLUMN_VALUE: issueCopy('时长列缺少值', '已选择从时长列读取，但该 case 没有时长。', '补充视频秒数，或改用统一时长。'),
  UNVERIFIED_EXTRA_PARAMETER: issueCopy('高级模型参数尚未验证', '该参数来自实时配置，但不属于已确认的通用合同。', '检查最终请求和模型说明后再提交。'),
  INVALID_SEED: issueCopy('Seed 值无效', 'Seed 必须是模型和平台允许范围内的整数。', '修正固定值或数据集列。'),
  MCP_AION_PROJECTION_MISMATCH: issueCopy('MCP 输入与 Aion 请求不一致', 'MCP 公共字段投影到最终 Aion 请求时发生了值或顺序变化。', '查看请求差异并修正编译或人工请求。'),
  DATASET_MODALITY_MISMATCH: issueCopy('Case 模态与模型不一致', '该 case 的 modality 不适用于当前模型输出类型。', '选择同模态 case 或切换模型。'),
  TARGET_NOT_EMPTY: issueCopy('目标结果列已有内容', '为避免覆盖旧结果，该 case 不能写入当前目标列。', '选择空目标列或新建结果列。'),
  TARGET_REPLACEMENT_NOT_CONFIRMED: issueCopy('已有结果未确认替换', '该 case 已有结果，但没有出现在明确的替换选择中。', '返回生成范围并逐行勾选需要替换的 case。'),
  TARGET_REPLACEMENT_STALE: issueCopy('替换选择已失效', '该 case 被标记为替换，但当前目标结果已经为空。', '刷新评测集并重新选择生成范围。'),
  MISSING_STABLE_ITEM_ID: issueCopy('Case 缺少稳定 ID', '平台无法保证生成结果回填到正确行。', '重新导入或修复评测集稳定 ID。'),
};

export const getGenerationIssueKey = (
  severity: GenerationIssueSeverity,
  code: string,
  field = '',
) => `${severity}:${code}:${encodeURIComponent(field)}`;

export const getGenerationFieldLabel = (field = '') => {
  const root = inputFieldRoot(field);
  const labels: Record<string, string> = {
    prompt: 'Prompt',
    duration: '时长',
    aspect_ratio: '画面比例',
    resolution: '分辨率',
    generate_audio: '生成声音',
    negative_prompt: '负向 Prompt',
    watermark: '水印',
    seed: 'Seed',
    image_urls: '关键帧',
    images: '图片输入',
    elements: '参考元素',
    audios: '参考音频',
    generation_type: '生成方式',
  };
  const label = labels[root] || root || '通用请求';
  return field && field !== root ? `${label}（${field}）` : label;
};

export const getGenerationCaseId = (item: GenerationPreflightCase) =>
  String(item.resolvedCase.caseId || item.resolvedCase.datasetItemId || `row-${item.resolvedCase.rowIndex ?? '?'}`);

const promptLengthSourceLabel = (
  source: NonNullable<GenerationPreflightIssue['promptLength']>['source'],
) => ({
  aion_input_schema: 'Aion input schema',
  aion_parameter_schema: 'Aion parameter schema',
  aion_options: 'Aion options',
  manueval_compatibility: 'ManuEval 兼容配置',
}[String(source)] || '未声明');

const promptLengthIssueCopy = (issue: GenerationPreflightIssue): GenerationIssueCopy | undefined => {
  const audit = issue.promptLength;
  if (!audit) return undefined;
  if (issue.code === 'PROMPT_LENGTH_NOT_VERIFIED') {
    return issueCopy(
      '数组 Prompt 长度尚未验证',
      `该数组包含 ${audit.measuredLength} 个原始文本 Unicode 字符，但模型合同未声明应逐段校验还是按 Adapter 规范化后的总长校验。平台没有使用近似规则，也没有改写 Aion 请求。`,
      '提交前核对模型的数组 Prompt 合同；最终长度校验仍由 Aion Adapter 执行。',
    );
  }
  if (issue.code !== 'PROMPT_TOO_LONG' || audit.maximumLength === undefined) return undefined;
  const subject = audit.scope === 'array_item'
    ? `第 ${(audit.itemIndex ?? 0) + 1} 段 Prompt`
    : audit.scope === 'array_joined'
      ? '按合同规范化后的数组 Prompt'
      : 'Prompt';
  return issueCopy(
    'Prompt 超出模型长度限制',
    `${subject}为 ${audit.measuredLength} / ${audit.maximumLength} Unicode 字符。判定单位是字符，不是单词数或 Token 数；规则来源：${promptLengthSourceLabel(audit.source)}。`,
    audit.scope === 'array_item'
      ? `精简第 ${(audit.itemIndex ?? 0) + 1} 段 Prompt，或选择支持更长分段 Prompt 的模型。`
      : '精简 Prompt，或选择支持更长 Prompt 的模型。',
  );
};

export const getGenerationIssuePresentation = (
  issue: GenerationPreflightIssue,
  severity: GenerationIssueSeverity,
): GenerationIssuePresentation => {
  const known = promptLengthIssueCopy(issue) || ISSUE_COPY[issue.code];
  const fallback = issueCopy(
    `未识别的预检问题（${issue.code || 'UNKNOWN'}）`,
    '当前前端尚未登记这个问题码，原始信息已保留在技术信息中。',
    '查看原始错误并联系维护者补充问题说明。',
  );
  return {
    ...(known || fallback),
    issue,
    severity,
    blocking: severity === 'error',
    forceable: severity === 'error' && GENERATION_FORCEABLE_PREFLIGHT_CODES.has(issue.code),
    requiresFinalJson: severity === 'error' && GENERATION_FINAL_JSON_REQUIRED_CODES.has(issue.code),
  };
};

const issuesWithSeverity = (item: GenerationPreflightCase) => [
  ...item.errors.map(issue => ({ issue, severity: 'error' as const })),
  ...item.warnings.map(issue => ({ issue, severity: 'warning' as const })),
];

const PROMPT_CODES = new Set([
  'INVALID_PROMPT_JSON',
  'INVALID_PROMPT',
  'INVALID_PROMPT_ITEM',
  'UNKNOWN_PROMPT_FIELD',
  'PROMPT_TOO_LONG',
  'PROMPT_LENGTH_NOT_VERIFIED',
  'PROMPT_REFERENCE_OUT_OF_RANGE',
  'UNREFERENCED_PROMPT_ASSET',
  'MODEL_PROMPT_SHAPE_UNSUPPORTED',
]);

const MEDIA_CODES = new Set([
  'INVALID_ASSET_URL',
  'MISSING_ASSET',
  'MEDIA_TYPE_MISMATCH',
  'MEDIA_TYPE_UNVERIFIED',
  'NON_PUBLIC_ASSET_URL',
  'RELATIVE_ASSET_REQUIRES_REVIEW',
  'REFERENCE_AUDIO_NOT_PUBLIC',
]);

const PARAMETER_CODES = new Set([
  'UNSUPPORTED_PRESET_PARAMETER',
  'PRESET_PARAMETER_EXPLICITLY_OMITTED',
  'UNSUPPORTED_CONTROL_VALUE',
  'CONTROL_OUT_OF_RANGE',
  'INVALID_CONTROL_VALUE',
  'INVALID_PARAMETER_VALUE',
  'MISSING_PARAMETER_COLUMN_VALUE',
  'MISSING_DURATION_COLUMN_VALUE',
  'UNVERIFIED_EXTRA_PARAMETER',
  'INVALID_SEED',
]);

const GENERATION_MODE_CODES = new Set([
  'MCP_INPUT_MODE_CONFLICT',
  'MODEL_INPUT_CONFLICT',
  'CONFLICTING_VIDEO_AND_KEYFRAMES',
  'GENERATION_TYPE_REVIEW_REQUIRED',
  'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
  'UNSUPPORTED_GENERATION_TYPE',
  'PLUGIN_MIXED_INPUT_REVIEW',
]);

const inputFieldRoot = (field = '') => field.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || field;

const repairKindForIssue = (issue: GenerationPreflightIssue): GenerationRepairKind => {
  const root = inputFieldRoot(issue.field);
  if (PROMPT_CODES.has(issue.code) || root === 'prompt') return 'prompt';
  if (MEDIA_CODES.has(issue.code)
    || /^(image_urls|images|elements|audios)(?:\b|\[|\.)/.test(issue.field || '')) return 'media';
  if (PARAMETER_CODES.has(issue.code)
    || ['duration', 'aspect_ratio', 'resolution', 'generate_audio', 'negative_prompt', 'watermark', 'seed'].includes(root)) {
    return 'parameter';
  }
  if (GENERATION_MODE_CODES.has(issue.code) || root === 'generation_type') return 'generation_mode';
  if (/^(INVALID_|MISSING_|UNKNOWN_)/.test(issue.code)) return 'input_structure';
  return 'general';
};

const promptChannelDiagnosticMatches = (
  finding: GenerationContractFinding,
  issue: GenerationPreflightIssue,
) => {
  if (issue.field !== 'prompt') return false;
  if (issue.code === 'CONTRACT_REVIEW_REQUIRED') return issue.message === finding.message;
  const imageToElement = finding.id === 'plugin-prompt-image-to-element';
  const elementToImage = finding.id === 'plugin-prompt-element-to-image';
  if (!imageToElement && !elementToImage) return false;
  if (issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE') {
    return imageToElement ? /@image\d+/i.test(issue.message) : /@Element\d+/.test(issue.message);
  }
  if (issue.code === 'UNREFERENCED_PROMPT_ASSET') {
    return imageToElement ? /@Element\d+/.test(issue.message) : /@image\d+/i.test(issue.message);
  }
  return false;
};

export const buildGenerationRepairGroups = (item: GenerationPreflightCase): GenerationRepairGroup[] => {
  const diagnostics = issuesWithSeverity(item).map(({ issue, severity }) => ({
    issue,
    severity,
    presentation: getGenerationIssuePresentation(issue, severity),
  }));
  const remaining = new Set(diagnostics.map((_diagnostic, index) => index));
  const findings = (item.resolvedCase.compilerAudit?.contractFindings || []) as GenerationContractFinding[];
  const groups: GenerationRepairGroup[] = [];

  findings.filter(finding => finding.code === 'PLUGIN_PROMPT_CHANNEL_MISMATCH'
    && finding.proposal?.kind === 'prompt_rewrite').forEach(finding => {
    const matched = diagnostics
      .map((diagnostic, index) => ({ diagnostic, index }))
      .filter(({ diagnostic, index }) => remaining.has(index)
        && promptChannelDiagnosticMatches(finding, diagnostic.issue));
    if (!matched.length) return;
    matched.forEach(({ index }) => remaining.delete(index));
    groups.push({
      id: `finding:${finding.id}`,
      kind: 'prompt_channel_mismatch',
      field: 'prompt',
      title: 'Prompt 素材引用通道错误',
      description: 'Prompt 使用的素材占位符与这个 case 实际发送的素材通道不一致。',
      suggestion: '核对下方素材编号，并采用建议改写或直接编辑 Prompt。',
      severity: matched.some(({ diagnostic }) => diagnostic.severity === 'error') ? 'error' : 'warning',
      diagnostics: matched.map(({ diagnostic }) => diagnostic),
      finding,
      proposal: finding.proposal,
    });
  });

  const ordinaryGroups = new Map<string, GenerationRepairGroup>();
  diagnostics.forEach((diagnostic, index) => {
    if (!remaining.has(index)) return;
    const kind = repairKindForIssue(diagnostic.issue);
    const field = diagnostic.issue.field || '';
    const key = `${kind}:${field || diagnostic.issue.code}`;
    const existing = ordinaryGroups.get(key);
    if (existing) {
      existing.diagnostics.push(diagnostic);
      if (diagnostic.severity === 'error') existing.severity = 'error';
      return;
    }
    ordinaryGroups.set(key, {
      id: key,
      kind,
      ...(field ? { field } : {}),
      title: diagnostic.presentation.title,
      description: diagnostic.presentation.description,
      suggestion: diagnostic.presentation.suggestion,
      severity: diagnostic.severity,
      diagnostics: [diagnostic],
    });
  });

  return [...groups, ...ordinaryGroups.values()].sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'error' ? -1 : 1;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
};

export const buildGenerationIssueOptions = (cases: GenerationPreflightCase[]): GenerationIssueOption[] => {
  const groups = new Map<string, GenerationIssueOption>();
  cases.forEach(item => {
    const seen = new Set<string>();
    issuesWithSeverity(item).forEach(({ issue, severity }) => {
      const field = String(issue.field || '');
      const key = getGenerationIssueKey(severity, issue.code, field);
      if (seen.has(key)) return;
      seen.add(key);
      const current = groups.get(key);
      const presentation = getGenerationIssuePresentation(issue, severity);
      groups.set(key, {
        key,
        code: issue.code,
        field,
        severity,
        count: (current?.count || 0) + 1,
        label: `${presentation.title} · ${getGenerationFieldLabel(field)}`,
      });
    });
  });
  return Array.from(groups.values()).sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'error' ? -1 : 1;
    return left.label.localeCompare(right.label, 'zh-CN');
  });
};

export const resolveDefaultGenerationCaseStatus = (cases: GenerationPreflightCase[]): GenerationCaseStatusFilter => {
  if (cases.some(item => !item.valid || item.errors.length > 0)) return 'needs_attention';
  if (cases.some(item => item.warnings.length > 0)) return 'needs_attention';
  return 'all';
};

const matchesStatus = (
  item: GenerationPreflightCase,
  status: GenerationCaseStatusFilter,
  allCases: GenerationPreflightCase[],
) => {
  if (status === 'all') return true;
  if (status === 'invalid') return !item.valid || item.errors.length > 0;
  if (status === 'warning') return item.warnings.length > 0;
  if (status === 'valid') return item.valid && item.warnings.length === 0;
  const hasInvalid = allCases.some(candidate => !candidate.valid || candidate.errors.length > 0);
  if (hasInvalid) return !item.valid || item.errors.length > 0;
  const hasWarning = allCases.some(candidate => candidate.warnings.length > 0);
  return hasWarning ? item.warnings.length > 0 : true;
};

export const filterGenerationPreflightCases = (
  cases: GenerationPreflightCase[],
  filters: {
    status: GenerationCaseStatusFilter;
    issueKey: string;
    search: string;
  },
) => {
  const normalizedSearch = filters.search.trim().toLocaleLowerCase();
  return cases.filter(item => {
    if (!matchesStatus(item, filters.status, cases)) return false;
    if (filters.issueKey && !issuesWithSeverity(item).some(({ issue, severity }) =>
      getGenerationIssueKey(severity, issue.code, String(issue.field || '')) === filters.issueKey)) return false;
    if (normalizedSearch && !getGenerationCaseId(item).toLocaleLowerCase().includes(normalizedSearch)) return false;
    return true;
  });
};

export const getPrimaryGenerationIssue = (
  item: GenerationPreflightCase,
  selectedIssueKey = '',
): GenerationIssuePresentation | undefined => {
  const issues = issuesWithSeverity(item);
  const selected = selectedIssueKey
    ? issues.find(({ issue, severity }) => getGenerationIssueKey(
        severity,
        issue.code,
        String(issue.field || ''),
      ) === selectedIssueKey)
    : undefined;
  const primary = selected || issues.find(candidate => candidate.severity === 'error') || issues[0];
  return primary ? getGenerationIssuePresentation(primary.issue, primary.severity) : undefined;
};
