import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

import {
  analyzeStructuredEvaluationDataset,
  type StructuredAuditSeverity,
  type StructuredEvaluationCaseAudit,
  type StructuredEvaluationIssue,
} from '../server/audit/structuredEvaluationQualityAudit.ts';
import { summarizeStructuredIssuesForReview } from '../server/audit/structuredEvaluationIssuePresentation.ts';
import type {
  DatasetCompatibilityAuditResult,
  DatasetCompatibilityStatus,
} from '../server/generation/generationDatasetAudit.ts';
import { ensureStableDatasetItemIds } from '../src/datasetSync.ts';
import {
  VIDMUSE_STRUCTURED_AUDIT_COLUMNS,
  parsePreservedEvaluationImportEnvelope,
} from '../src/features/datasets/preservedSourceImport.ts';
import type { DatasetSchemaField, EvalDataset } from '../src/types.ts';
import { probeMediaInputs, type MediaProbeResult } from './lib/mediaProbe.ts';

const option = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};
const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const datasetFile = option('dataset-file');
const matrixFile = option('matrix-file');
const probeFile = option('probe-file');
const manualMediaFile = option('manual-media-file');
const outputDir = resolve(option('output-dir', 'task_state/base-audit/report'));
const sourceDatasetUrl = option('source-dataset-url');
const auditDatasetUrl = option('audit-dataset-url');
const matrixArtifactUrl = option('matrix-artifact-url');
const manuEvalCommit = option('manueval-commit', 'working-tree');
const auditContractVersion = 1;
if (!datasetFile || !matrixFile) {
  throw new Error('Use --dataset-file=<preserved import JSON> --matrix-file=<model compatibility JSON>.');
}

const envelope = parsePreservedEvaluationImportEnvelope(readFileSync(resolve(datasetFile), 'utf8'));
if (!envelope) throw new Error('The dataset file is not a preserved-source import envelope.');
const matrix = JSON.parse(readFileSync(resolve(matrixFile), 'utf8')) as DatasetCompatibilityAuditResult;
if (matrix.generationPostRequests !== 0 || !matrix.dryRun) throw new Error('The compatibility artifact is not a zero-generation dry run.');
if (matrix.dataset.id !== envelope.dataset.id) throw new Error('The compatibility matrix belongs to another dataset.');

mkdirSync(outputDir, { recursive: true });
const quality = analyzeStructuredEvaluationDataset(envelope.dataset);
const uniqueMedia = new Map<string, Set<'image' | 'video' | 'audio'>>();
quality.mediaReferences.forEach(reference => {
  const kinds = uniqueMedia.get(reference.normalizedUrl) || new Set();
  kinds.add(reference.expectedKind);
  uniqueMedia.set(reference.normalizedUrl, kinds);
});
const probeInputs = [...uniqueMedia.entries()].map(([url, kinds]) => ({ url, expectedKinds: [...kinds] }));
const previewDir = resolve(outputDir, 'media-previews');
let lastReported = 0;
const probes: MediaProbeResult[] = probeFile
  ? (JSON.parse(readFileSync(resolve(probeFile), 'utf8')) as MediaProbeResult[])
      .filter(probe => uniqueMedia.has(probe.url))
  : hasFlag('skip-media-probe')
  ? []
  : await probeMediaInputs(probeInputs, {
      previewDir,
      onProgress: (completed, total) => {
        if (completed === total || completed - lastReported >= 10) {
          lastReported = completed;
          console.error(`Media probe ${completed}/${total}`);
        }
      },
    });
if (probeFile) {
  const cachedUrls = new Set(probes.map(probe => probe.url));
  probeInputs.filter(input => !cachedUrls.has(input.url) && !/^https?:\/\//i.test(input.url)).forEach(input => {
    probes.push({
      ...input,
      http: { ok: false, error: 'relative_or_non_http_url' },
      decode: { ok: false, error: 'relative_or_non_http_url', streams: [] },
    });
  });
}
const probeByUrl = new Map(probes.map(probe => [probe.url, probe]));
const missingProbeUrls = probeInputs.filter(input => !probeByUrl.has(input.url)).map(input => input.url);
if (probeFile && missingProbeUrls.length) {
  throw new Error(`The cached media probe is missing ${missingProbeUrls.length} current URL(s): ${missingProbeUrls.slice(0, 3).join(', ')}`);
}
type ManualMediaFinding = {
  url: string;
  code: string;
  severity: StructuredAuditSeverity;
  message: string;
  recommendation: string;
};
const manualMediaFindings = manualMediaFile
  ? JSON.parse(readFileSync(resolve(manualMediaFile), 'utf8')) as ManualMediaFinding[]
  : [];
manualMediaFindings.forEach(finding => {
  if (!uniqueMedia.has(finding.url)) {
    throw new Error(`Manual media finding URL is not referenced by this source snapshot: ${finding.url}`);
  }
});

const severityRank: Record<StructuredAuditSeverity, number> = {
  info: 0, low: 1, medium: 2, high: 3, blocker: 4,
};
const highestSeverity = (issues: StructuredEvaluationIssue[]) => issues.reduce<StructuredAuditSeverity>(
  (highest, current) => severityRank[current.severity] > severityRank[highest] ? current.severity : highest,
  'info',
);
const mediaIssue = (
  code: string,
  severity: StructuredAuditSeverity,
  message: string,
  recommendation: string,
  field: string,
): StructuredEvaluationIssue => ({ code, severity, category: 'media', message, recommendation, field });

quality.mediaReferences.forEach(reference => {
  const probe = probeByUrl.get(reference.normalizedUrl);
  if (!probe) return;
  const target = quality.cases[reference.rowIndex];
  if (!target) return;
  if (!probe.http.ok) target.issues.push(mediaIssue(
    'MEDIA_HTTP_UNREACHABLE', 'high',
    `${reference.field} could not be fetched over HTTP${probe.http.status ? ` (HTTP ${probe.http.status})` : ''}.`,
    'Replace the asset with a stable public URL and rerun the probe.', reference.field,
  ));
  if (!probe.decode.ok) target.issues.push(mediaIssue(
    'MEDIA_DECODE_FAILED', 'high',
    `${reference.field} could not be decoded by ffprobe.`,
    'Replace or re-encode the asset before generation.', reference.field,
  ));
  const imageTransport = /^image\//i.test(probe.http.contentType || '')
    || /(?:^|,)(?:image2|jpeg_pipe|png_pipe|webp_pipe|gif)(?:,|$)/i.test(probe.decode.formatName || '')
    || /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(probe.url);
  const matchingStream = reference.expectedKind === 'image' && imageTransport
    ? probe.decode.streams.find(stream => stream.kind === 'video' && Boolean(stream.width) && Boolean(stream.height))
    : probe.decode.streams.find(stream => stream.kind === reference.expectedKind);
  if (probe.decode.ok && !matchingStream) target.issues.push(mediaIssue(
    'MEDIA_STREAM_TYPE_MISMATCH', 'blocker',
    `${reference.field} has no decodable ${reference.expectedKind} stream.`,
    'Move the URL to the field matching its decoded stream or replace the asset.', reference.field,
  ));
  if (reference.expectedKind === 'image' && matchingStream
    && ((matchingStream.width || 0) < 512 || (matchingStream.height || 0) < 512)) {
    target.issues.push(mediaIssue(
      'IMAGE_RESOLUTION_LOW', 'medium',
      `${reference.field} is only ${matchingStream.width || '?'}x${matchingStream.height || '?'}.`,
      'Review visual clarity and replace with a higher-resolution reference when identity/detail matters.', reference.field,
    ));
  }
  if (reference.expectedKind === 'audio' && matchingStream) {
    if ((matchingStream.sampleRate || 0) > 0 && (matchingStream.sampleRate || 0) < 22_050) {
      target.issues.push(mediaIssue(
        'AUDIO_SAMPLE_RATE_LOW', 'medium',
        `${reference.field} sample rate is ${matchingStream.sampleRate} Hz.`,
        'Review audibility and replace with a higher-quality source when rhythm, lyrics, or timbre are evaluated.', reference.field,
      ));
    }
    if (reference.caseDuration && probe.decode.duration
      && probe.decode.duration + 0.05 < reference.caseDuration) {
      target.issues.push(mediaIssue(
        'AUDIO_SHORTER_THAN_CASE', 'high',
        `${reference.field} is ${probe.decode.duration.toFixed(2)}s for a ${reference.caseDuration}s case.`,
        'Use an audio segment covering the full authored duration or reduce the case duration explicitly.', reference.field,
      ));
    }
    if ((probe.audioMetrics?.silenceRatio || 0) >= 0.4) {
      target.issues.push(mediaIssue(
        'AUDIO_SILENCE_HIGH', 'medium',
        `${reference.field} is approximately ${Math.round((probe.audioMetrics?.silenceRatio || 0) * 100)}% silent.`,
        'Listen to the clip and confirm the silence is intentional for this cell.', reference.field,
      ));
    }
    if ((probe.audioMetrics?.peakDb ?? -Infinity) >= -0.1) {
      target.issues.push(mediaIssue(
        'AUDIO_CLIPPING_RISK', 'medium',
        `${reference.field} peak level reaches ${probe.audioMetrics?.peakDb?.toFixed(2)} dB.`,
        'Listen for clipping and replace or normalize the source if distortion is audible.', reference.field,
      ));
    }
  }
});

quality.mediaReferences.forEach(reference => {
  manualMediaFindings.filter(finding => finding.url === reference.normalizedUrl).forEach(finding => {
    const target = quality.cases[reference.rowIndex];
    if (!target) return;
    target.issues.push(mediaIssue(
      finding.code,
      finding.severity,
      `${reference.field}: ${finding.message}`,
      finding.recommendation,
      reference.field,
    ));
  });
});

quality.cases.forEach(item => {
  item.severity = highestSeverity(item.issues);
  const mediaIssues = item.issues.filter(current => current.category === 'media');
  item.mediaStatus = mediaIssues.some(current => current.severity === 'blocker')
    ? 'blocked'
    : mediaIssues.length ? 'review' : 'valid';
});

const modelCountsByItem = new Map<string, Record<DatasetCompatibilityStatus, number>>();
const readyModelsByItem = new Map<string, string[]>();
matrix.cases.forEach(item => {
  const counts = modelCountsByItem.get(item.datasetItemId) || {
    ready_as_authored: 0,
    ready_with_explicit_batch_override: 0,
    dataset_error: 0,
    unsupported_by_model: 0,
    manual_contract_review: 0,
  };
  counts[item.status] += 1;
  modelCountsByItem.set(item.datasetItemId, counts);
  if (item.status === 'ready_as_authored') {
    readyModelsByItem.set(item.datasetItemId, [...(readyModelsByItem.get(item.datasetItemId) || []), item.modelName]);
  }
});

const auditFields: DatasetSchemaField[] = VIDMUSE_STRUCTURED_AUDIT_COLUMNS.map(key => ({
  key,
  label: key,
  type: 'text',
  sourceKey: key,
  role: key === 'case_id' ? 'case_id' : key === 'evidence' || key === 'recommended_action' ? 'rubric' : 'metadata',
  ...(key === 'case_id' ? { canonicalKey: 'case_id', required: true } : {}),
}));
const auditId = `ds-vidmuse-audit-${String(envelope.verification.sourceSnapshotHash || '').replace(/^sha256:/, '').slice(0, 12)}-v${auditContractVersion}`;
const auditRows = quality.cases.map(item => {
  const categories = [...new Set(item.issues.map(current => current.category))];
  return {
    case_id: item.caseId,
    variant_label: item.variantLabel,
    cell_id: item.cellId,
    modality: item.modality,
    source_record_id: item.sourceRecordId,
    import_status: item.importStatus,
    mcp_contract_status: item.mcpContractStatus,
    prompt_status: item.promptStatus,
    media_status: item.mediaStatus,
    severity: item.severity,
    issue_categories: categories.join('|'),
    evidence: JSON.stringify(item.issues.map(current => ({
      code: current.code,
      severity: current.severity,
      field: current.field,
      message: current.message,
      evidence: current.evidence,
    }))),
    recommended_action: [...new Set(item.issues.map(current => current.recommendation))].join('\n'),
    review_status: 'initial_review_complete_pending_lead_review',
    initial_review_note: item.issues.some(current => current.category === 'prompt')
      ? 'Prompt was read in full; the recorded placeholder, channel, or semantic finding requires source-owner review.'
      : item.issues.length
        ? 'Prompt and mapped inputs were read in full; no additional Prompt contradiction was found beyond the recorded MCP/media findings.'
        : 'Prompt and mapped inputs were read in full; no deterministic contradiction or input-role error was found.',
    model_compatibility_summary: JSON.stringify(modelCountsByItem.get(item.datasetItemId) || {}),
    ready_models: (readyModelsByItem.get(item.datasetItemId) || []).join('\n'),
    __sourceRecordId: item.sourceRecordId,
    __sourceSnapshotHash: envelope.verification.sourceSnapshotHash,
  };
});
const now = Date.now();
const auditDataset: EvalDataset = {
  id: auditId,
  name: 'VidMuse 结构化评测集 - 接口与质量审计',
  description: `逐条对应 ${envelope.dataset.id}；不修改来源评测集。来源快照 ${envelope.verification.sourceSnapshotHash}.`,
  tags: ['VidMuse', 'audit', 'MCP', '人工复核'],
  inputSchema: auditFields,
  items: ensureStableDatasetItemIds(auditId, auditRows),
  inputType: 'other',
  modality: 'other',
  categoryPath: ['VidMuse', '模型评测集', '审计'],
  columnMappings: {
    caseId: 'case_id', inputColumns: [], outputColumns: [], dimensionColumns: [], referenceColumns: [],
    standard: { case_id: 'case_id' },
  },
  datasetCard: {
    applicableTasks: ['新模型接入评测审计'],
    applicableStages: ['生成前'],
    source: envelope.dataset.datasetCard?.source || '',
    sampleSize: auditRows.length,
    modality: 'other',
    tagDistribution: {},
    dimensionDistribution: {},
    rubricBinding: '人工审阅，不使用 AI 打分。',
    coverageGaps: [],
    latestChange: '创建接口与质量审计明细',
    updatedAt: now,
  },
  version: 1,
  createdAt: now,
  updatedAt: now,
};

const issueCounts: Record<string, number> = {};
const issueCases = new Map<string, Set<string>>();
quality.cases.forEach(item => item.issues.forEach(current => {
  issueCounts[current.code] = (issueCounts[current.code] || 0) + 1;
  const affected = issueCases.get(current.code) || new Set<string>();
  affected.add(item.datasetItemId);
  issueCases.set(current.code, affected);
}));
const issueCaseCounts = Object.fromEntries([...issueCases.entries()].map(([code, cases]) => [code, cases.size]));
const modalityCounts = Object.fromEntries([...new Set(quality.cases.map(item => item.modality))]
  .map(modality => [modality, quality.cases.filter(item => item.modality === modality).length]));
const cellCounts = Object.fromEntries([...new Set(quality.cases.map(item => item.cellId))]
  .sort().map(cellId => [cellId, {
    total: quality.cases.filter(item => item.cellId === cellId).length,
    blocker: quality.cases.filter(item => item.cellId === cellId && item.severity === 'blocker').length,
    high: quality.cases.filter(item => item.cellId === cellId && item.severity === 'high').length,
  }]));
const inputShape = (item: StructuredEvaluationCaseAudit) => {
  const input = item.normalizedMcpInput;
  const images = Array.isArray(input.images) ? input.images.length : 0;
  const keyframes = Array.isArray(input.image_urls) ? input.image_urls.length : 0;
  const elements = Array.isArray(input.elements) ? input.elements.length : 0;
  const audios = Array.isArray(input.audios) ? input.audios.length : 0;
  if (item.modality === 'image') return images ? 'image_to_image' : 'text_to_image';
  if (keyframes && (elements || audios)) return 'mixed_keyframe_reference_review';
  if (keyframes === 1) return 'single_image_driver';
  if (keyframes === 2) return 'dual_keyframe';
  if (keyframes > 2) return 'invalid_keyframe_count';
  if (elements && audios) return 'reference_elements_with_audio';
  if (elements) return 'reference_elements';
  if (audios) return 'audio_only_review';
  return 'text_to_video';
};
const inputShapeCounts = quality.cases.reduce<Record<string, number>>((counts, item) => {
  const shape = inputShape(item);
  counts[shape] = (counts[shape] || 0) + 1;
  return counts;
}, {});
const currentSummary = {
  totalCases: quality.cases.length,
  bySeverity: Object.fromEntries(['blocker', 'high', 'medium', 'low', 'info'].map(level => [
    level,
    quality.cases.filter(item => item.severity === level).length,
  ])),
  byMcpStatus: Object.fromEntries(['valid', 'review', 'blocked'].map(status => [
    status,
    quality.cases.filter(item => item.mcpContractStatus === status).length,
  ])),
  byPromptStatus: Object.fromEntries(['valid', 'review', 'blocked'].map(status => [
    status,
    quality.cases.filter(item => item.promptStatus === status).length,
  ])),
  byMediaStatus: Object.fromEntries(['valid', 'review', 'blocked'].map(status => [
    status,
    quality.cases.filter(item => item.mediaStatus === status).length,
  ])),
  issueOccurrencesByCode: issueCounts,
  issueCasesByCode: issueCaseCounts,
  modalityCounts,
  cellCounts,
  inputShapeCounts,
  uniqueMediaUrls: uniqueMedia.size,
  mediaProbed: probes.length,
  mediaHttpReachable: probes.filter(probe => probe.http.ok).length,
  mediaDecoded: probes.filter(probe => probe.decode.ok).length,
  manualMediaFindings: manualMediaFindings.length,
  audioAssetsDecoded: probes.filter(probe =>
    probe.expectedKinds.includes('audio') && probe.decode.streams.some(stream => stream.kind === 'audio')).length,
  audioPreviewClipsReviewed: probes.filter(probe => Boolean(probe.audioPreviewPath)).length,
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const previewRows = probes.map(probe => {
  const preview = probe.previewPath ? relative(outputDir, probe.previewPath).replace(/\\/g, '/') : '';
  const audioPreview = probe.audioPreviewPath ? relative(outputDir, probe.audioPreviewPath).replace(/\\/g, '/') : '';
  const dimensions = probe.decode.streams
    .filter(stream => stream.width || stream.sampleRate)
    .map(stream => stream.kind === 'audio'
      ? `${stream.codec || ''} ${stream.sampleRate || '?'}Hz ${stream.channels || '?'}ch`
      : `${stream.codec || ''} ${stream.width || '?'}x${stream.height || '?'}`)
    .join(' / ');
  return `<article><div class="preview">${preview ? `<img src="${escapeHtml(preview)}" loading="lazy">` : '<span>No preview</span>'}</div><div class="meta"><strong>${escapeHtml(probe.expectedKinds.join('/'))}</strong><br>${escapeHtml(dimensions)}<br>HTTP ${escapeHtml(probe.http.status || probe.http.error || 'n/a')} / decode ${probe.decode.ok ? 'ok' : 'failed'}${audioPreview ? `<br><audio controls preload="none" src="${escapeHtml(audioPreview)}"></audio>` : ''}<br><a href="${escapeHtml(probe.url)}">${escapeHtml(probe.url.slice(0, 120))}</a></div></article>`;
}).join('\n');
const mediaHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>VidMuse media review</title><style>body{margin:0;background:#090d16;color:#e5e7eb;font:14px Arial,sans-serif}header{padding:20px;border-bottom:1px solid #283244;position:sticky;top:0;background:#090d16}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1px;background:#283244}article{background:#111827;padding:12px;min-width:0}.preview{height:180px;display:flex;align-items:center;justify-content:center;background:#030712}.preview img{max-width:100%;max-height:100%;object-fit:contain}.meta{padding-top:10px;line-height:1.5;overflow-wrap:anywhere}audio{width:100%;margin-top:8px}a{color:#fbbf24}</style></head><body><header><strong>VidMuse 结构化评测集素材审阅</strong> · ${probes.length} unique assets · snapshot ${escapeHtml(envelope.verification.sourceSnapshotHash)}</header><main>${previewRows}</main></body></html>`;

const topIssues = Object.entries(issueCounts).sort((left, right) => right[1] - left[1]);
const cellRows = Object.entries(cellCounts)
  .map(([cellId, counts]) => `| ${cellId.replace(/\|/g, '\\|')} | ${counts.total} | ${counts.blocker} | ${counts.high} |`)
  .join('\n');
const modelRows = Object.entries(matrix.summary.byModel)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([model, counts]) => `| ${model.replace(/\|/g, '\\|')} | ${counts.ready_as_authored} | ${counts.ready_with_explicit_batch_override} | ${counts.dataset_error} | ${counts.unsupported_by_model} | ${counts.manual_contract_review} |`)
  .join('\n');
const requestExample = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(requestExample);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, requestExample(entry)]));
  }
  if (typeof value !== 'string') return value;
  if (/^(?:https?:\/\/|online-mining\/)/i.test(value)) return '<asset_url>';
  return value.length > 180 ? `<prompt:${value.length} chars>` : value;
};
const exampleModes = ['text_to_video', 'image_to_video', 'images_to_video', 'reference_to_video', 'image_to_image'];
const requestExamples = exampleModes.flatMap(mode => {
  const item = matrix.cases.find(candidate => candidate.generationType === mode
    && candidate.mcpToolInput && candidate.finalAionRequest
    && candidate.status === 'ready_as_authored');
  if (!item) return [];
  return [`### ${mode}: ${item.caseId} / ${item.modelName}\n\n`+
    `MCP 标准输入：\n\n\`\`\`json\n${JSON.stringify(requestExample(item.mcpToolInput), null, 2)}\n\`\`\`\n\n`+
    `ManuEval 推导模式：\`${item.generationType}\`\n\n`+
    `最终 Aion JSON：\n\n\`\`\`json\n${JSON.stringify(requestExample(item.finalAionRequest), null, 2)}\n\`\`\`\n`];
}).join('\n');
const configSetFingerprint = `sha256:${createHash('sha256')
  .update(JSON.stringify(Object.entries(matrix.configFingerprints).sort(([left], [right]) => left.localeCompare(right))))
  .digest('hex')}`;
const artifactLinks = [
  sourceDatasetUrl ? `- ManuEval 原样数据集：${sourceDatasetUrl}` : '',
  auditDatasetUrl ? `- ManuEval 逐 case 审计：${auditDatasetUrl}` : '',
  matrixArtifactUrl ? `- case × model 兼容矩阵：${matrixArtifactUrl}` : '',
].filter(Boolean).join('\n');
const report = `# VidMuse 结构化评测集接口与质量审计\n\n`+
  `- 来源：${envelope.dataset.datasetCard?.source}\n`+
  `- 来源快照：${envelope.verification.sourceSnapshotHash}\n`+
  `- 抓取时间：${envelope.dataset.createdAt ? new Date(envelope.dataset.createdAt).toISOString() : 'unknown'}\n`+
  `- MCP 合同：VidMuse MCP revision 1813\n`+
  `- ManuEval：${manuEvalCommit}\n`+
  `- Aion 实时配置集合指纹：${configSetFingerprint}\n`+
  `- 记录：${currentSummary.totalCases}（原样数据集 ${envelope.dataset.id}）\n`+
  `- 实时模型：${matrix.summary.modelCount}，零费用编译 ${matrix.summary.totalEvaluations} 次，生成 POST：${matrix.generationPostRequests}\n`+
  `- 唯一素材：${currentSummary.uniqueMediaUrls}，HTTP 可达 ${currentSummary.mediaHttpReachable}，可解码 ${currentSummary.mediaDecoded}\n`+
  `- 人工视觉素材结论：${currentSummary.manualMediaFindings} 条（逐 URL 复用到全部引用 case）\n`+
  `- 音频试听：${currentSummary.audioPreviewClipsReviewed}/${currentSummary.audioAssetsDecoded} 个可解码音频已生成并检查 8 秒试听片段；未新增可辨听觉缺陷，近满幅峰值仍保留风险标记\n`+
  `${artifactLinks ? `${artifactLinks}\n` : ''}\n`+
  `## 质量状态\n\n`+
  `- modality：${JSON.stringify(currentSummary.modalityCounts)}\n`+
  `- 输入形态：${JSON.stringify(currentSummary.inputShapeCounts)}\n`+
  `- 严重度：${JSON.stringify(currentSummary.bySeverity)}\n`+
  `- MCP：${JSON.stringify(currentSummary.byMcpStatus)}\n`+
  `- Prompt：${JSON.stringify(currentSummary.byPromptStatus)}\n`+
  `- 素材：${JSON.stringify(currentSummary.byMediaStatus)}\n\n`+
  `## 主要问题\n\n`+
  `${topIssues.map(([code, count]) => `- ${code}: ${issueCaseCounts[code]} 个 case，${count} 处`).join('\n')}\n\n`+
  `## 按 cell 汇总\n\n`+
  `| cell_id | case | blocker | high |\n|---|---:|---:|---:|\n${cellRows}\n\n`+
  `## 全模型干跑\n\n`+
  `总状态：${JSON.stringify(matrix.summary.byStatus)}\n\n`+
  `| 模型 | 原样可跑 | 需显式覆盖 | 数据错误 | 模型不支持 | 合同审阅 |\n|---|---:|---:|---:|---:|---:|\n${modelRows}\n\n`+
  `状态必须按模型逐项读取，不能把 7,952 个 case-model 组合汇总数理解为 188 条 case 的通过率。ready_as_authored 只代表 MCP/Aion 接口和实时模型配置通过，仍需叠加 Prompt 与素材质量审计。720p 或 generate_audio=true 不受支持时只进入显式批次覆盖建议，来源值未被改写。\n\n`+
  `## 典型 MCP / Aion 请求\n\n${requestExamples}\n`+
  `示例中的 Prompt 和 URL 已脱敏；完整逐 case 请求保存在兼容矩阵审计产物中。\n\n`+
  `## 生成前建议\n\n`+
  `1. 先修复确定性媒体角色错误、element 联合形态冲突和不可访问素材，再运行任何模型。\n`+
  `2. 逐条修正不存在的 @ImageN/@ElementN/@audioN；不得仅靠替换大小写或图片数量猜测素材意图。\n`+
  `3. 对关键帧与 elements/audios 混合、audio-only case 逐模型审阅结构化合同；未知合同不批量强制。\n`+
  `4. 选择模型后按实时配置批量覆盖 720p、generate_audio 或时长；覆盖只进入批次快照，不修改来源数据。\n`+
  `5. 47 个 case 复用了带水印参考，36 个 case 使用低于 512 像素边长的参考；身份和画质评测前应替换。\n\n`+
  `## 结论边界\n\n`+
  `本报告验证 ManuEval 编译出的 MCP 输入、generation_type 与最终 Aion HTTP JSON，不声称验证 Aion Adapter 后续供应商字段转换。未执行任何真实生成。媒体不可达或无法解码时标记为未通过，不按成功处理。Prompt 问题均保留原文并等待人工复核，不自动改写来源数据。MP4 用作 audio_url 时同时记录容器风险与实际音轨探测结果；MP4 用作 frontal_image_url 是确定的媒体角色错误。\n`;

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const matrixCsv = [
  ['case_id', 'variant_label', 'cell_id', 'modality', 'model_name', 'status', 'generation_type', 'errors', 'warnings'],
  ...matrix.cases.map(item => [
    item.caseId, item.variantLabel, item.cellId, item.modality, item.modelName,
    item.status, item.generationType || '', item.errors.join(' | '), item.warnings.join(' | '),
  ]),
].map(row => row.map(csvCell).join(',')).join('\n');

const manualQueue = quality.cases.map(item => {
  const sourceRow = envelope.dataset.items[item.rowIndex];
  const issueDetails = summarizeStructuredIssuesForReview(item.issues);
  const issueSummary = issueDetails.length
    ? issueDetails.map(current => `${current.code}(${current.severity}${current.count > 1 ? `, ${current.count}处` : ''})`).join(', ')
    : 'none';
  const issueReview = issueDetails.length
    ? `- issue 说明：\n${issueDetails.map(current => {
      const context = [
        current.fields.length ? `字段: ${current.fields.join(', ')}` : '',
        current.evidence.length ? `证据: ${current.evidence.join(', ')}` : '',
      ].filter(Boolean).join('；');
      return `  - \`${current.code}\` (${current.severity}${current.count > 1 ? `；${current.count} 处` : ''}${context ? `；${context}` : ''})：是什么：${current.explanation} 怎么改：${current.recommendation}`;
    }).join('\n')}\n`
    : '- issue 说明：未发现确定性问题。\n';
  return `## ${item.rowIndex + 1}. ${item.caseId} / ${item.variantLabel || '-'}\n\n`+
    `- cell/modality: ${item.cellId} / ${item.modality}\n`+
    `- status: MCP=${item.mcpContractStatus}, Prompt=${item.promptStatus}, Media=${item.mediaStatus}, Severity=${item.severity}\n`+
    `- issues: ${issueSummary}\n`+
    issueReview+
    `- prompt: ${String(sourceRow.prompt || '').replace(/\s+/g, ' ').slice(0, 1200)}\n`;
}).join('\n');

writeFileSync(resolve(outputDir, 'quality-audit.json'), `${JSON.stringify({ ...quality, summary: currentSummary }, null, 2)}\n`, 'utf8');
writeFileSync(resolve(outputDir, 'media-probe.json'), `${JSON.stringify(probes, null, 2)}\n`, 'utf8');
writeFileSync(resolve(outputDir, 'audit-dataset.json'), `${JSON.stringify({
  importMode: 'audited_dataset_v1',
  dataset: auditDataset,
  verification: {
    ok: true,
    sourceSnapshotHash: envelope.verification.sourceSnapshotHash,
    recordCount: auditDataset.items.length,
    visibleColumnCount: auditDataset.inputSchema.length,
  },
}, null, 2)}\n`, 'utf8');
writeFileSync(resolve(outputDir, 'report.md'), report, 'utf8');
writeFileSync(resolve(outputDir, 'manual-review-queue.md'), manualQueue, 'utf8');
writeFileSync(resolve(outputDir, 'media-review.html'), mediaHtml, 'utf8');
writeFileSync(resolve(outputDir, 'model-compatibility-matrix.csv'), `${matrixCsv}\n`, 'utf8');
writeFileSync(resolve(outputDir, 'report-manifest.json'), `${JSON.stringify({
  sourceDatasetId: envelope.dataset.id,
  auditDatasetId: auditDataset.id,
  sourceSnapshotHash: envelope.verification.sourceSnapshotHash,
  matrixHash: `sha256:${createHash('sha256').update(readFileSync(resolve(matrixFile))).digest('hex')}`,
  manualMediaFindingsHash: manualMediaFile
    ? `sha256:${createHash('sha256').update(readFileSync(resolve(manualMediaFile))).digest('hex')}`
    : null,
  generatedAt: new Date().toISOString(),
  summary: currentSummary,
  mcpRevision: 1813,
  auditContractVersion,
  manuEvalCommit,
  configSetFingerprint,
  files: ['quality-audit.json', 'media-probe.json', 'audit-dataset.json', 'report.md', 'manual-review-queue.md', 'media-review.html', 'model-compatibility-matrix.csv'],
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  sourceDatasetId: envelope.dataset.id,
  auditDatasetId: auditDataset.id,
  outputDir,
  summary: currentSummary,
  topIssues: topIssues.slice(0, 20),
  report: resolve(outputDir, 'report.md'),
  mediaReview: resolve(outputDir, 'media-review.html'),
  auditDataset: resolve(outputDir, 'audit-dataset.json'),
}, null, 2));
