import { getDatasetItemStableId } from '../../src/datasetSync.ts';
import { inspectGenerationMediaInput } from '../../src/features/generation/mediaValidation.ts';
import type { GenerationMediaReferenceAudit } from '../../src/features/generation/mediaValidation.ts';
import type { EvalDataset } from '../../src/types.ts';

export type StructuredAuditSeverity = 'blocker' | 'high' | 'medium' | 'low' | 'info';
export type StructuredAuditCategory = 'import' | 'mcp' | 'prompt' | 'media';

export interface StructuredEvaluationIssue {
  code: string;
  severity: StructuredAuditSeverity;
  category: StructuredAuditCategory;
  field?: string;
  message: string;
  evidence?: string;
  recommendation: string;
}

export interface StructuredEvaluationCaseAudit {
  caseId: string;
  datasetItemId: string;
  sourceRecordId: string;
  rowIndex: number;
  cellId: string;
  modality: string;
  variantLabel: string;
  importStatus: 'valid' | 'blocked';
  mcpContractStatus: 'valid' | 'review' | 'blocked';
  promptStatus: 'valid' | 'review' | 'blocked';
  mediaStatus: 'valid' | 'review' | 'blocked';
  severity: StructuredAuditSeverity;
  issues: StructuredEvaluationIssue[];
  normalizedMcpInput: Record<string, unknown>;
}

export interface StructuredEvaluationMediaReference extends GenerationMediaReferenceAudit {
  caseId: string;
  datasetItemId: string;
  sourceRecordId: string;
  rowIndex: number;
  caseDuration?: number;
}

export interface StructuredEvaluationQualityAudit {
  cases: StructuredEvaluationCaseAudit[];
  mediaReferences: StructuredEvaluationMediaReference[];
  summary: {
    totalCases: number;
    bySeverity: Record<StructuredAuditSeverity, number>;
    byMcpStatus: Record<'valid' | 'review' | 'blocked', number>;
    byPromptStatus: Record<'valid' | 'review' | 'blocked', number>;
    byMediaStatus: Record<'valid' | 'review' | 'blocked', number>;
    issueOccurrencesByCode: Record<string, number>;
    uniqueMediaUrls: number;
  };
}

const severityRank: Record<StructuredAuditSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4,
};

const issue = (
  code: string,
  severity: StructuredAuditSeverity,
  category: StructuredAuditCategory,
  message: string,
  recommendation: string,
  field?: string,
  evidence?: string,
): StructuredEvaluationIssue => ({
  code,
  severity,
  category,
  field,
  message,
  evidence,
  recommendation,
});

const hasValue = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '';

const parseArray = (
  value: unknown,
  field: string,
  issues: StructuredEvaluationIssue[],
): unknown[] => {
  if (!hasValue(value)) return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      issues.push(issue(
        'STRUCTURED_JSON_INVALID',
        'blocker',
        'mcp',
        `${field} is not valid JSON.`,
        `Replace ${field} with a valid JSON array without changing its intended media role.`,
        field,
        value.slice(0, 180),
      ));
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    issues.push(issue(
      'STRUCTURED_ARRAY_REQUIRED',
      'blocker',
      'mcp',
      `${field} must be a JSON array.`,
      `Wrap the intended ${field} entries in a JSON array.`,
      field,
      JSON.stringify(parsed).slice(0, 180),
    ));
    return [];
  }
  return parsed;
};

const validateElements = (
  rawElements: unknown[],
  issues: StructuredEvaluationIssue[],
) => rawElements.flatMap((raw, index) => {
  const field = `elements[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push(issue(
      'ELEMENT_OBJECT_REQUIRED', 'blocker', 'mcp', `${field} must be an object.`,
      'Replace the entry with one valid image, video, or existing-element object.', field,
    ));
    return [];
  }
  const element = raw as Record<string, unknown>;
  const referenceImages = Array.isArray(element.reference_image_urls)
    ? element.reference_image_urls.filter(hasValue)
    : [];
  const hasImageMode = hasValue(element.frontal_image_url) || referenceImages.length > 0;
  const hasVideoMode = hasValue(element.video_url);
  const hasIdMode = hasValue(element.element_id) || hasValue(element.kling_element_id);
  const modeCount = Number(hasImageMode) + Number(hasVideoMode) + Number(hasIdMode);
  if (modeCount !== 1) {
    issues.push(issue(
      'ELEMENT_MODE_CONFLICT',
      'blocker',
      'mcp',
      `${field} must use exactly one MCP element shape: image group, video_url, or existing element ID.`,
      'Split mixed media into separate elements or keep only the intended element shape.',
      field,
      JSON.stringify(element).slice(0, 240),
    ));
  }
  if (element.reference_image_urls != null && !Array.isArray(element.reference_image_urls)) {
    issues.push(issue(
      'ELEMENT_REFERENCE_ARRAY_REQUIRED',
      'blocker',
      'mcp',
      `${field}.reference_image_urls must be an ordered string array.`,
      'Use a JSON string array and keep all views of the same element in their intended order.',
      `${field}.reference_image_urls`,
    ));
  }
  return [element];
});

const promptReferences = (prompt: string, family: 'image' | 'element' | 'audio') => {
  const pattern = family === 'image'
    ? /@image(\d+)/gi
    : family === 'element' ? /@element(\d+)/gi : /@audio(\d+)/gi;
  return Array.from(prompt.matchAll(pattern)).map(match => Number(match[1])).filter(Number.isFinite);
};

const promptIssues = (
  row: Record<string, unknown>,
  imageCount: number,
  elementCount: number,
  audioCount: number,
) => {
  const issues: StructuredEvaluationIssue[] = [];
  const prompt = String(row.prompt ?? '').trim();
  const variantLabel = String(row.variant_label ?? '').toLowerCase();
  const approximation = new Set([
    'elements_approx',
    'sd2_elements_ref',
    'sd2_multi_shot_string',
    'h3_audios_plus_ref',
    'sd2_video_edit_extend',
  ]).has(variantLabel) || /fallback/.test(variantLabel);
  if (!prompt) {
    issues.push(issue('PROMPT_MISSING', 'blocker', 'prompt', 'The case has no Prompt.', 'Add a Prompt before generation.', 'prompt'));
    return issues;
  }
  const imageRefs = promptReferences(prompt, 'image');
  const elementRefs = promptReferences(prompt, 'element');
  const audioRefs = promptReferences(prompt, 'audio');
  imageRefs.filter(index => index < 1 || index > imageCount).forEach(index => issues.push(issue(
    'PROMPT_REFERENCE_OUT_OF_RANGE',
    approximation ? 'medium' : 'high',
    'prompt',
    `Prompt references @Image${index}, but image_urls contains ${imageCount} item(s).`,
    approximation
      ? 'Confirm that this is an intentional approximation and rewrite the token only after model-contract review.'
      : 'Move ordinary references to elements or correct the Prompt token after confirming the intended channel.',
    'prompt',
    `@Image${index}`,
  )));
  elementRefs.filter(index => index < 1 || index > elementCount).forEach(index => issues.push(issue(
    'PROMPT_REFERENCE_OUT_OF_RANGE',
    approximation ? 'medium' : 'high',
    'prompt',
    `Prompt references @Element${index}, but elements contains ${elementCount} item(s).`,
    'Correct the element grouping or Prompt index after confirming the intended reference identity.',
    'prompt',
    `@Element${index}`,
  )));
  audioRefs.filter(index => index < 1 || index > audioCount).forEach(index => issues.push(issue(
    'PROMPT_REFERENCE_OUT_OF_RANGE',
    'high',
    'prompt',
    `Prompt references @audio${index}, but audios contains ${audioCount} item(s).`,
    'Provide the referenced audio input or remove the Prompt token after confirming the intended audio behavior.',
    'prompt',
    `@audio${index}`,
  )));
  const mentionsFirst = /\b(?:first|start|opening)\s+frame\b|首帧/i.test(prompt);
  const mentionsLast = /\b(?:last|end|final)\s+frame\b|尾帧/i.test(prompt);
  if (mentionsFirst && imageCount === 0) {
    issues.push(issue(
      'FRAME_INTENT_CHANNEL_MISMATCH',
      approximation ? 'low' : 'medium',
      'prompt',
      'Prompt describes a first/start frame, but the MCP keyframe channel is empty.',
      approximation
        ? 'Keep only if the variant intentionally evaluates an element approximation; otherwise move the frame to image_urls.'
        : 'Place the intended first frame in image_urls or remove the frame constraint.',
      'prompt',
    ));
  }
  if (mentionsLast && imageCount < 2) {
    issues.push(issue(
      'FRAME_INTENT_CHANNEL_MISMATCH',
      approximation ? 'low' : 'high',
      'prompt',
      'Prompt describes a last/end frame, but image_urls does not contain two ordered keyframes.',
      'Provide [first_frame, last_frame] in image_urls or remove the final-frame constraint.',
      'prompt',
    ));
  }
  const generateAudio = row.generate_audio === true;
  const noAudioIntent = /\b(?:no audio|without audio|silent video|mute(?:d)?)\b|无声|静音/i.test(prompt);
  if (generateAudio && noAudioIntent) {
    issues.push(issue(
      'AUDIO_INTENT_CONTRADICTION',
      'high',
      'prompt',
      'Prompt requests silence while generate_audio is true.',
      'Set generate_audio=false for this case or remove the silence instruction.',
      'generate_audio',
    ));
  }
  const resolutionMention = prompt.match(/\b(\d{3,4}p|\d{3,4}x\d{3,4}|[24]k)\b/i)?.[1];
  const authoredResolution = String(row.resolution ?? '').trim();
  if (resolutionMention && authoredResolution
    && resolutionMention.toLowerCase() !== authoredResolution.toLowerCase()) {
    issues.push(issue(
      'PROMPT_PARAMETER_CONTRADICTION',
      'medium',
      'prompt',
      `Prompt mentions ${resolutionMention}, but the authored resolution is ${authoredResolution}.`,
      'Align the Prompt text and the explicit resolution parameter.',
      'resolution',
    ));
  }
  const ratioMention = prompt.match(/\b(16:9|9:16|1:1|4:3|3:4)\b/)?.[1];
  const authoredRatio = String(row.aspect_ratio ?? '').trim();
  if (ratioMention && authoredRatio && ratioMention !== authoredRatio) {
    issues.push(issue(
      'PROMPT_PARAMETER_CONTRADICTION',
      'medium',
      'prompt',
      `Prompt mentions ${ratioMention}, but the authored aspect_ratio is ${authoredRatio}.`,
      'Align the Prompt text and the explicit aspect_ratio parameter.',
      'aspect_ratio',
    ));
  }
  return issues;
};

const highestSeverity = (issues: StructuredEvaluationIssue[]): StructuredAuditSeverity =>
  issues.reduce<StructuredAuditSeverity>(
    (highest, current) => severityRank[current.severity] > severityRank[highest] ? current.severity : highest,
    'info',
  );

const categoryStatus = (
  issues: StructuredEvaluationIssue[],
  category: StructuredAuditCategory,
) => {
  const relevant = issues.filter(item => item.category === category);
  if (relevant.some(item => item.severity === 'blocker')) return 'blocked' as const;
  if (relevant.length) return 'review' as const;
  return 'valid' as const;
};

export const analyzeStructuredEvaluationDataset = (
  dataset: EvalDataset,
): StructuredEvaluationQualityAudit => {
  const mediaReferences: StructuredEvaluationMediaReference[] = [];
  const cases = dataset.items.map((row, rowIndex): StructuredEvaluationCaseAudit => {
    const issues: StructuredEvaluationIssue[] = [];
    const caseId = String(row.case_id ?? `case-${rowIndex + 1}`);
    const datasetItemId = getDatasetItemStableId(row);
    const sourceRecordId = String(row.__feishuRecordId ?? '');
    if (!sourceRecordId || !row.__sourceRowHash || !row._originalData) {
      issues.push(issue(
        'IMPORT_PROVENANCE_MISSING', 'blocker', 'import',
        'The imported row is missing Feishu record or raw-value provenance.',
        'Re-import this case from the audited source snapshot.',
      ));
    }
    const modality = String(row.modality ?? '').trim().toLowerCase();
    if (!['image', 'video'].includes(modality)) {
      issues.push(issue(
        'MODALITY_INVALID', 'blocker', 'mcp',
        `modality must be image or video, received ${JSON.stringify(row.modality)}.`,
        'Correct the source modality without using cell_id to infer it.', 'modality',
      ));
    }
    const imageUrls = parseArray(row.image_urls, 'image_urls', issues);
    const elements = validateElements(parseArray(row.elements, 'elements', issues), issues);
    if (modality === 'video' && imageUrls.length > 2) {
      issues.push(issue(
        'KEYFRAME_COUNT_INVALID', 'blocker', 'mcp',
        `Video image_urls contains ${imageUrls.length} entries; MCP permits one driver image or two ordered keyframes.`,
        'Move ordinary references into elements and keep at most [first_frame, last_frame] in image_urls.',
        'image_urls',
      ));
    }
    if (imageUrls.some(entry => typeof entry !== 'string' || !entry.trim())) {
      issues.push(issue(
        'IMAGE_URL_STRING_REQUIRED', 'blocker', 'mcp',
        'Every image_urls entry must be a non-empty URL string.',
        'Replace non-string or empty entries with valid image URLs.', 'image_urls',
      ));
    }
    const audioUrl = hasValue(row.audio_url) ? String(row.audio_url).trim() : '';
    if (modality === 'image' && (elements.length || audioUrl)) {
      issues.push(issue(
        'IMAGE_MODEL_VIDEO_INPUT_PRESENT', 'blocker', 'mcp',
        'Image cases cannot map video-only elements or audio_url through generate_image.',
        'Move image references into image_urls and remove video-only media fields from the image case.',
      ));
    }
    if (modality === 'video' && imageUrls.length && (elements.length || audioUrl)) {
      issues.push(issue(
        'MIXED_MEDIA_CONTRACT_REVIEW', 'high', 'mcp',
        'The case mixes keyframes with reference elements or audio; MCP does not define one universal generation mode for this combination.',
        'Review the target model contract and choose keyframe or reference generation explicitly; do not submit by image-count guessing.',
      ));
    } else if (modality === 'video' && audioUrl && !elements.length) {
      issues.push(issue(
        'AUDIO_ONLY_CONTRACT_REVIEW', 'high', 'mcp',
        'The case provides reference audio without image/video elements.',
        'Submit only to models whose structured live contract explicitly supports audio-only reference generation.',
        'audio_url',
      ));
    }
    const normalizedMcpInput: Record<string, unknown> = {
      ...(hasValue(row.prompt) ? { prompt: row.prompt } : {}),
      ...(imageUrls.length ? { [modality === 'image' ? 'images' : 'image_urls']: imageUrls } : {}),
      ...(modality === 'video' && elements.length ? { elements } : {}),
      ...(modality === 'video' && audioUrl ? { audios: [{ url: audioUrl }] } : {}),
      ...Object.fromEntries(['duration', 'aspect_ratio', 'resolution', 'generate_audio']
        .filter(key => hasValue(row[key]))
        .map(key => [key, row[key]])),
    };
    const mediaInspection = inspectGenerationMediaInput(normalizedMcpInput);
    mediaInspection.references.forEach(reference => {
      mediaReferences.push({
        ...reference,
        caseId,
        datasetItemId,
        sourceRecordId,
        rowIndex,
        ...(Number.isFinite(Number(row.duration)) ? { caseDuration: Number(row.duration) } : {}),
      });
      if (!/^(?:https?:\/\/|asset:\/\/)/i.test(reference.normalizedUrl)) {
        issues.push(issue(
          'RELATIVE_ASSET_URL', 'high', 'media',
          `${reference.field} is relative and cannot be verified or submitted without a documented resolver.`,
          'Replace it with a public asset URL or confirm a model-side resolver through manual contract review.',
          reference.field,
          reference.originalUrl,
        ));
      }
    });
    mediaInspection.errors.forEach(error => issues.push(issue(
      error.code,
      error.code === 'MEDIA_TYPE_MISMATCH' ? 'blocker' : 'high',
      'media',
      error.message,
      error.code === 'MEDIA_TYPE_MISMATCH'
        ? 'Place the asset in the MCP field matching its actual media type; do not rename an extension to bypass validation.'
        : 'Use a public URL reachable by Aion and the provider.',
      error.field,
    )));
    mediaInspection.warnings.forEach(warning => issues.push(issue(
      warning.code, 'medium', 'media', warning.message,
      'Verify the response MIME and decode result before generation.', warning.field,
    )));
    issues.push(...promptIssues(row, imageUrls.length, elements.length, audioUrl ? 1 : 0));
    const importStatus = categoryStatus(issues, 'import') === 'blocked' ? 'blocked' : 'valid';
    const mcpContractStatus = categoryStatus(issues, 'mcp');
    const promptStatus = categoryStatus(issues, 'prompt');
    const mediaStatus = categoryStatus(issues, 'media');
    return {
      caseId,
      datasetItemId,
      sourceRecordId,
      rowIndex,
      cellId: String(row.cell_id ?? ''),
      modality,
      variantLabel: String(row.variant_label ?? ''),
      importStatus,
      mcpContractStatus,
      promptStatus,
      mediaStatus,
      severity: highestSeverity(issues),
      issues,
      normalizedMcpInput,
    };
  });

  const bySeverity = { blocker: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byMcpStatus = { valid: 0, review: 0, blocked: 0 };
  const byPromptStatus = { valid: 0, review: 0, blocked: 0 };
  const byMediaStatus = { valid: 0, review: 0, blocked: 0 };
  const issueOccurrencesByCode: Record<string, number> = {};
  cases.forEach(item => {
    bySeverity[item.severity] += 1;
    byMcpStatus[item.mcpContractStatus] += 1;
    byPromptStatus[item.promptStatus] += 1;
    byMediaStatus[item.mediaStatus] += 1;
    item.issues.forEach(current => {
      issueOccurrencesByCode[current.code] = (issueOccurrencesByCode[current.code] || 0) + 1;
    });
  });
  return {
    cases,
    mediaReferences,
    summary: {
      totalCases: cases.length,
      bySeverity,
      byMcpStatus,
      byPromptStatus,
      byMediaStatus,
      issueOccurrencesByCode,
      uniqueMediaUrls: new Set(mediaReferences.map(reference => reference.normalizedUrl)).size,
    },
  };
};
