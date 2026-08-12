import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  buildAionGenerationRequest,
  buildMcpToolInput,
  compileGenerationReferenceVideoInputs,
  estimateGenerationCost,
  fingerprintConfig,
  generationRequestProjectionDiff,
  matchUploadedAsset,
  normalizeAionModelConfig,
  preflightGenerationCase,
  resolveGenerationImageInputs,
} from '../server/generation/generationPlanning.ts';
import {
  AionGenerationClient,
  aionUserAssetPathToUrl,
  buildTaskWorkerSubmission,
  normalizeTaskWorkerTask,
  taskWorkerFilePathToUrl,
} from '../server/generation/aionGenerationClient.ts';
import {
  generationPollPhase,
  generationSubmissionFailure,
  generationSubmissionErrorDiagnostics,
  archivedGenerationResult,
  normalizeProviderPayload,
  providerResult,
  unarchivedGenerationResult,
} from '../server/generation/generationWorker.ts';
import { createByteLimitStream, generationAssetService } from '../server/generation/generationAssetService.ts';
import {
  buildGenerationCasesForPreflight,
  validateGenerationRequestOverride,
  validateGenerationContentMappingConfiguration,
  validateGenerationParameterBindings,
  validateGenerationParameterColumnOverrides,
  validateGenerationPromptColumnOverrides,
  validateExpectedGenerationConfigFingerprint,
  validateGenerationSeedConfiguration,
  validateDurationSourceConfiguration,
} from '../server/generation/generationPreflightService.ts';
import { inferDatasetMappings } from '../src/datasetManifest.ts';
import {
  defaultVidMuseEvaluationParameterColumns,
  defaultGenerationInputMapping,
  generationRowMatchesModality,
  getGenerationImageRole,
  hasVidMuseEvaluationPreset,
  inferGenerationImageRole,
  setGenerationImageRole,
} from '../src/features/generation/inputMapping.ts';
import {
  getGenerationReferenceVideoSupport,
  getSupportedGenerationImageRoles,
} from '../src/features/generation/modelCapabilities.ts';
import {
  probeAudioDurations,
  resolveReferenceAudioDuration,
} from '../src/features/generation/audioDuration.ts';
import {
  inspectGenerationTargetColumn,
  resolveGenerationCaseSelection,
} from '../src/features/generation/caseSelection.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import {
  flattenGenerationReferences,
  uniqueGenerationReferences,
} from '../src/features/generation/mediaReferences.ts';
import { inspectGenerationMediaInput } from '../src/features/generation/mediaValidation.ts';
import {
  applyBulkGenerationForceReview,
  applyBulkPromptColumnReview,
  generationPromptReplacementColumns,
  generationForceBypassableCodes,
  generationPendingForceCodes,
  generationForceRequiresFinalJson,
} from '../src/features/generation/preflightReview.ts';
import {
  applyBulkGenerationRepair,
  buildGenerationBulkRepairWorkspace,
  generationParameterEditorValue,
  generationParameterReplacementColumns,
  excludeGenerationCaseIds,
  restoreGenerationCaseIds,
} from '../src/features/generation/bulkRepair.ts';
import {
  computeGenerationConcurrencyPolicy,
  parseGenerationVideoModelLimits,
  resolveGenerationVideoModelLimit,
} from '../server/generation/generationConcurrencyPolicy.ts';
import {
  admitGenerationCapacity,
  applyGenerationCapacityEvidence,
  capacityBucketKey,
  classifyGenerationCapacityEvidence,
  createInitialGenerationCapacityState,
  markGenerationCapacitySubmissionAccepted,
  parseGenerationVideoAdaptivePolicy,
  refreshGenerationCapacityState,
  type GenerationCapacityState,
} from '../server/generation/generationAdaptiveCapacity.ts';
import {
  generationValidationForModel,
  parseGenerationModelValidationOverrides,
} from '../server/generation/generationValidationPolicy.ts';
import {
  buildGenerationRoutePath,
  parseGenerationRouteContext,
  resolveWorkspaceDataset,
  shouldClearGenerationWorkspaceDataset,
} from '../src/features/generation/workspaceNavigation.ts';
import {
  buildGenerationRepairGroups,
  buildGenerationIssueOptions,
  filterGenerationPreflightCases,
  getGenerationIssuePresentation,
  getPrimaryGenerationIssue,
  resolveDefaultGenerationCaseStatus,
} from '../src/features/generation/preflightPresentation.ts';
import { applyGenerationCaseInputOverride } from '../src/features/generation/caseInputOverride.ts';

const promptChannelMismatchCase = {
  valid: false,
  generationType: 'reference_to_video',
  errors: [
    {
      code: 'CONTRACT_REVIEW_REQUIRED',
      field: 'prompt',
      message: 'The Prompt references @imageN, but this case only submits elements.',
    },
    {
      code: 'PROMPT_REFERENCE_OUT_OF_RANGE',
      field: 'prompt',
      message: '@image1 does not match any submitted image input.',
    },
  ],
  warnings: [{
    code: 'UNREFERENCED_PROMPT_ASSET',
    field: 'prompt',
    message: '@Element1 is submitted but not referenced.',
  }],
  resolvedCase: {
    caseId: 'case-prompt-channel',
    datasetItemId: 'item-prompt-channel',
    prompt: '@image1 walks through the scene.',
    compilerAudit: {
      compiledInput: {
        prompt: '@image1 walks through the scene.',
        image_urls: [],
        elements: [{ frontal_image_url: 'https://assets.example.com/person.png' }],
        audios: [],
      },
      contractFindings: [{
        id: 'plugin-prompt-image-to-element',
        ruleId: 'plugin.prompt.elements-use-element-token',
        code: 'PLUGIN_PROMPT_CHANNEL_MISMATCH',
        field: 'prompt',
        message: 'The Prompt references @imageN, but this case only submits elements.',
        source: 'plugin_snapshot',
        sourceVersion: 'test-plugin',
        disposition: 'suggestion',
        proposal: {
          kind: 'prompt_rewrite',
          prompt: '@Element1 walks through the scene.',
        },
      }],
    },
  },
};

const promptRepairGroups = buildGenerationRepairGroups(promptChannelMismatchCase);
assert.equal(promptRepairGroups.length, 1, 'derivative Prompt diagnostics must form one repair group');
assert.equal(promptRepairGroups[0].kind, 'prompt_channel_mismatch');
assert.equal(promptRepairGroups[0].finding?.id, 'plugin-prompt-image-to-element');
assert.deepEqual(
  promptRepairGroups[0].diagnostics.map(item => item.issue.code),
  ['CONTRACT_REVIEW_REQUIRED', 'PROMPT_REFERENCE_OUT_OF_RANGE', 'UNREFERENCED_PROMPT_ASSET'],
);
assert.equal(promptRepairGroups[0].proposal?.prompt, '@Element1 walks through the scene.');

const independentRepairGroups = buildGenerationRepairGroups({
  ...promptChannelMismatchCase,
  errors: [
    ...promptChannelMismatchCase.errors,
    {
      code: 'MEDIA_TYPE_MISMATCH',
      field: 'elements[0].frontal_image_url',
      message: 'Expected image but detected video.',
    },
  ],
});
assert.equal(independentRepairGroups.length, 2, 'an unrelated material failure must remain independently actionable');
const mediaRepairGroup = independentRepairGroups.find(group => group.kind === 'media');
assert.equal(mediaRepairGroup?.field, 'elements[0].frontal_image_url');

const caseOverrideResult = applyGenerationCaseInputOverride({
  input: {
    prompt: 'Original Prompt',
    image_urls: ['https://assets.example.com/first.png'],
    elements: [{ frontal_image_url: 'https://assets.example.com/reference.png' }],
    audios: [{ url: 'https://assets.example.com/reference.wav' }],
    duration: 5,
  },
  override: {
    version: 1,
    content: {
      prompt: { action: 'set', value: 'Reviewed Prompt' },
      image_urls: { action: 'omit' },
      elements: {
        action: 'set',
        value: [
          { frontal_image_url: 'https://assets.example.com/reference-2.png' },
          { video_url: 'https://assets.example.com/reference.mp4' },
        ],
      },
    },
    parameters: {
      duration: { action: 'set', value: 8 },
    },
  },
  outputModality: 'video',
  parameterDestinations: { duration: 'control' },
});
assert.deepEqual(caseOverrideResult.issues, []);
assert.equal(caseOverrideResult.input.prompt, 'Reviewed Prompt');
assert.equal(caseOverrideResult.input.image_urls, undefined);
assert.equal(caseOverrideResult.input.duration, 8);
assert.deepEqual(caseOverrideResult.input.elements, [
  { frontal_image_url: 'https://assets.example.com/reference-2.png' },
  { video_url: 'https://assets.example.com/reference.mp4' },
]);
assert.deepEqual(caseOverrideResult.audit?.appliedContentFields, ['prompt', 'image_urls', 'elements']);

const unsafeCaseOverride = applyGenerationCaseInputOverride({
  input: { prompt: 'Original' },
  override: {
    version: 1,
    content: {
      generation_type: { action: 'set', value: 'text_to_video' },
    } as never,
    parameters: {
      model_name: { action: 'set', value: 'other/model' },
    },
  },
  outputModality: 'video',
  parameterDestinations: {},
});
assert.deepEqual(unsafeCaseOverride.issues.map(issue => issue.code), [
  'CASE_OVERRIDE_FIELD_NOT_ALLOWED',
  'CASE_OVERRIDE_PARAMETER_NOT_ALLOWED',
]);
assert.equal(unsafeCaseOverride.input.generation_type, undefined);
assert.equal(unsafeCaseOverride.input.model_name, undefined);

const undefinedCaseOverride = applyGenerationCaseInputOverride({
  input: { prompt: 'Original' },
  override: {
    version: 1,
    content: { prompt: { action: 'set', value: undefined } },
  },
  outputModality: 'video',
  parameterDestinations: {},
});
assert.equal(undefinedCaseOverride.input.prompt, undefined);
assert.deepEqual(undefinedCaseOverride.issues, []);

const presentationCases = [
  {
    valid: false,
    generationType: 'reference_to_video',
    errors: [
      { code: 'INPUT_COUNT_OUT_OF_RANGE', field: 'elements', message: 'Too many elements.' },
      { code: 'INPUT_COUNT_OUT_OF_RANGE', field: 'elements', message: 'Repeated diagnostic.' },
    ],
    warnings: [{ code: 'MEDIA_TYPE_UNVERIFIED', field: 'elements[0]', message: 'Unknown extension.' }],
    resolvedCase: { caseId: 'case-invalid', datasetItemId: 'item-invalid' },
  },
  {
    valid: true,
    generationType: 'text_to_video',
    errors: [],
    warnings: [{ code: 'MEDIA_TYPE_UNVERIFIED', field: 'audios[0]', message: 'Unknown extension.' }],
    resolvedCase: { caseId: 'case-warning', datasetItemId: 'item-warning' },
  },
  {
    valid: true,
    generationType: 'text_to_video',
    errors: [],
    warnings: [],
    resolvedCase: { caseId: 'case-valid', datasetItemId: 'item-valid' },
  },
];

assert.equal(resolveDefaultGenerationCaseStatus(presentationCases), 'needs_attention');
assert.deepEqual(
  buildGenerationIssueOptions(presentationCases).map(option => [option.key, option.count]),
  [
    ['error:INPUT_COUNT_OUT_OF_RANGE:elements', 1],
    ['warning:MEDIA_TYPE_UNVERIFIED:audios%5B0%5D', 1],
    ['warning:MEDIA_TYPE_UNVERIFIED:elements%5B0%5D', 1],
  ],
  'issue counts must be deduplicated by case rather than repeated diagnostics',
);
assert.deepEqual(
  filterGenerationPreflightCases(presentationCases, {
    status: 'needs_attention',
    issueKey: '',
    search: '',
  }).map(item => item.resolvedCase.caseId),
  ['case-invalid'],
  'needs-attention defaults to invalid cases while any invalid case exists',
);
assert.deepEqual(
  filterGenerationPreflightCases(presentationCases, {
    status: 'warning',
    issueKey: 'warning:MEDIA_TYPE_UNVERIFIED:audios%5B0%5D',
    search: 'warning',
  }).map(item => item.resolvedCase.caseId),
  ['case-warning'],
  'status, issue and case search filters must all constrain the visible cases',
);
assert.equal(
  getPrimaryGenerationIssue(presentationCases[0], 'warning:MEDIA_TYPE_UNVERIFIED:elements%5B0%5D')?.issue.code,
  'MEDIA_TYPE_UNVERIFIED',
  'the selected issue type must become the row primary issue',
);
assert.equal(getPrimaryGenerationIssue(presentationCases[0])?.issue.code, 'INPUT_COUNT_OUT_OF_RANGE');
assert.deepEqual(
  filterGenerationPreflightCases(presentationCases, {
    status: 'warning',
    issueKey: 'warning:MEDIA_TYPE_UNVERIFIED:elements%5B0%5D',
    search: '',
  }).map(item => item.resolvedCase.caseId),
  ['case-invalid'],
  'warning status must preserve the selected warning field rather than merge unrelated media channels',
);
const unsupportedPresetPresentation = getGenerationIssuePresentation({
  code: 'UNSUPPORTED_PRESET_PARAMETER',
  field: 'generate_audio',
  message: 'unsupported',
}, 'error');
assert.equal(unsupportedPresetPresentation.forceable, true);
assert.equal(unsupportedPresetPresentation.requiresFinalJson, true);
const unverifiedMediaPresentation = getGenerationIssuePresentation({
  code: 'MEDIA_TYPE_UNVERIFIED',
  field: 'audios[0].url',
  message: 'unknown',
}, 'warning');
assert.equal(unverifiedMediaPresentation.blocking, false);
assert.equal(unverifiedMediaPresentation.forceable, false);
assert.match(
  getGenerationIssuePresentation({ code: 'FUTURE_UNKNOWN_CODE', message: 'Future raw detail.' }, 'error').title,
  /FUTURE_UNKNOWN_CODE/,
  'unknown issues must keep their original code visible',
);

assert.equal(buildGenerationRoutePath({ generationView: 'tasks' }), '/generation?view=tasks');
assert.equal(
  buildGenerationRoutePath({ generationView: 'new', datasetId: 'dataset-1' }),
  '/datasets/dataset-1/generation?view=new',
);
assert.equal(
  buildGenerationRoutePath({ generationView: 'new', datasetId: 'dataset-1', generationBatchId: 'batch-1' }),
  '/generation?view=tasks&batch=batch-1',
  'batch deep links must always return to the task view',
);
assert.deepEqual(
  parseGenerationRouteContext('/generation', new URLSearchParams()),
  { generationView: 'tasks' },
);
assert.deepEqual(
  parseGenerationRouteContext('/datasets/dataset-1/generation', new URLSearchParams()),
  { generationView: 'new', datasetId: 'dataset-1', source: 'dataset' },
  'legacy dataset generation links must continue to open new generation with that dataset selected',
);
assert.deepEqual(
  parseGenerationRouteContext('/generation', new URLSearchParams('view=new&batch=batch-1')),
  { generationView: 'tasks', generationBatchId: 'batch-1' },
);
const generationDatasets = [{ id: 'dataset-1' }, { id: 'dataset-2' }];
assert.equal(resolveWorkspaceDataset(generationDatasets, '', false), undefined,
  'new generation must never select the first dataset implicitly');
assert.equal(resolveWorkspaceDataset(generationDatasets, '', true)?.id, 'dataset-1',
  'the dataset repository retains its existing first-dataset fallback');
assert.equal(shouldClearGenerationWorkspaceDataset([], 'dataset-1'), false,
  'deep-link dataset selection must survive while the async dataset list is still empty');
assert.equal(shouldClearGenerationWorkspaceDataset(generationDatasets, 'dataset-missing'), true);
assert.equal(shouldClearGenerationWorkspaceDataset(generationDatasets, 'dataset-1'), false);

const capacityFailure = (code: string, message: string, httpStatus?: number) => ({
  status: 'failed',
  error: { code, message, httpStatus },
});
const successfulOutcome = () => ({ status: 'succeeded', error: {} });
const concurrencyLimit = { min: 1, initial: 1, max: 6 };

assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, []).effectiveLimit, 1,
  'a model without recent capacity evidence must use its initial limit');
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, [successfulOutcome()]).effectiveLimit, 1);
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, Array.from({ length: 3 }, successfulOutcome)).effectiveLimit, 2);
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, Array.from({ length: 6 }, successfulOutcome)).effectiveLimit, 3);
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, [
  capacityFailure('QUEUE_FULL', 'Provider queue is full.', 429),
  ...Array.from({ length: 12 }, successfulOutcome),
]).effectiveLimit, 1, 'the newest explicit capacity rejection must immediately reset capacity to the minimum');
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, [
  ...Array.from({ length: 3 }, successfulOutcome),
  capacityFailure('QUEUE_FULL', 'Provider queue is full.', 429),
]).effectiveLimit, 2, 'three successes after the latest explicit capacity rejection may restore one slot');

const deterministicFailures = [
  capacityFailure('AION_SUBMIT_REJECTED', 'Wan3 seed must be an integer between 0 and 2147483647', 400),
  capacityFailure('AION_SUBMIT_REJECTED', 'Prompt is too long', 400),
  capacityFailure('PROVIDER_FAILED', 'Content policy rejection'),
];
const ignoredDeterministic = computeGenerationConcurrencyPolicy(concurrencyLimit, [
  ...deterministicFailures,
  ...Array.from({ length: 6 }, successfulOutcome),
]);
assert.equal(ignoredDeterministic.sampleSize, 6);
assert.equal(ignoredDeterministic.capacityFailures, 0);
assert.equal(ignoredDeterministic.effectiveLimit, 3);

const configuredModelLimits = parseGenerationVideoModelLimits(JSON.stringify({
  default: { min: 1, initial: 1, max: 4 },
  models: { 'wan/wan3.0-video': { min: 1, initial: 1, max: 6 } },
}), 8);
assert.deepEqual(resolveGenerationVideoModelLimit(configuredModelLimits, 'wan/wan3.0-video'), { min: 1, initial: 1, max: 6 });
assert.deepEqual(resolveGenerationVideoModelLimit(configuredModelLimits, 'future/video-model'), { min: 1, initial: 1, max: 4 });
assert.deepEqual(
  resolveGenerationVideoModelLimit(parseGenerationVideoModelLimits(undefined, 8), 'future/video-model'),
  { min: 8, initial: 8, max: 8 },
  'disabling optimistic waves must fall back to the global-eight limit without model-name rules',
);
assert.throws(() => parseGenerationVideoModelLimits('{broken', 8), /valid JSON/);
assert.throws(() => parseGenerationVideoModelLimits(JSON.stringify({
  default: { min: 1, initial: 5, max: 4 }, models: {},
}), 8), /minimum/);

const adaptivePolicy = parseGenerationVideoAdaptivePolicy(undefined);
assert.equal(adaptivePolicy.policyVersion, 5);
assert.equal(adaptivePolicy.hardLimit, 24);
assert.equal(adaptivePolicy.initialGlobalLimit, 24);
assert.equal(adaptivePolicy.coldStartLimit, 8);
assert.deepEqual(adaptivePolicy.optimisticWaves, [8, 16, 24]);
assert.equal(capacityBucketKey('config/with spaces'), 'model:config%2Fwith%20spaces');
assert.equal(capacityBucketKey('config-a', 'shared/provider'), 'group:shared%2Fprovider');
assert.throws(() => parseGenerationVideoAdaptivePolicy(JSON.stringify({ hardLimit: 0 })), /hardLimit/);
assert.throws(() => parseGenerationVideoAdaptivePolicy(JSON.stringify({ policyVersion: 3 })), /policyVersion/);
assert.throws(() => parseGenerationVideoAdaptivePolicy(JSON.stringify({
  hardLimit: 8,
  initialGlobalLimit: 12,
})), /initialGlobalLimit/);

const capacityNow = Date.UTC(2026, 7, 10, 8, 0, 0);
let adaptiveState = createInitialGenerationCapacityState(adaptivePolicy, capacityNow);
assert.equal(adaptiveState.currentWindow, 8, 'unknown capacity groups must optimistically start at eight');
for (let accepted = 1; accepted <= 7; accepted += 1) {
  adaptiveState = markGenerationCapacitySubmissionAccepted(
    adaptiveState,
    capacityNow + accepted * 100,
    adaptivePolicy,
  );
  assert.equal(adaptiveState.currentWindow, 8);
  assert.equal(adaptiveState.acceptedInWave, accepted);
}
adaptiveState = markGenerationCapacitySubmissionAccepted(adaptiveState, capacityNow + 800, adaptivePolicy);
assert.equal(adaptiveState.currentWindow, 16, 'eight accepted task IDs must open the second wave immediately');
assert.equal(adaptiveState.acceptedInWave, 0);
for (let accepted = 1; accepted <= 8; accepted += 1) {
  adaptiveState = markGenerationCapacitySubmissionAccepted(
    adaptiveState,
    capacityNow + 800 + accepted * 100,
    adaptivePolicy,
  );
}
assert.equal(adaptiveState.currentWindow, 24, 'another eight accepted task IDs must open the final wave');
assert.equal(adaptiveState.phase, 'stable');
assert.equal(admitGenerationCapacity(adaptiveState, 23, capacityNow + 2_000).admitted, true);
assert.equal(admitGenerationCapacity(adaptiveState, 24, capacityNow + 2_000).admitted, false);

adaptiveState = applyGenerationCapacityEvidence({
  ...adaptiveState,
  currentWindow: 16,
}, {
  kind: 'concurrency_limit',
  observedAt: capacityNow + 4_000,
  activeAtSubmit: 16,
  limitAtSubmit: 16,
  retryAfterMs: 30_000,
}, adaptivePolicy);
assert.equal(adaptiveState.currentWindow, 8, 'an explicit capacity rejection must halve the current window');
assert.equal(adaptiveState.phase, 'cooling');
assert.ok((adaptiveState.cooldownUntil || 0) >= capacityNow + 64_000,
  'an explicit capacity rejection must cool down for at least sixty seconds');

const beforeRateLimit = { ...adaptiveState, currentWindow: 16, cooldownUntil: undefined };
const afterRateLimit = applyGenerationCapacityEvidence(beforeRateLimit, {
  kind: 'rate_limit', observedAt: capacityNow + 5_000, activeAtSubmit: 16, limitAtSubmit: 16,
}, adaptivePolicy);
assert.equal(afterRateLimit.currentWindow, 16, 'RPM failures must not reduce task concurrency');
assert.equal(afterRateLimit.phase, 'rate_limited');

const firstAmbiguous429 = applyGenerationCapacityEvidence(beforeRateLimit, {
  kind: 'ambiguous_429', observedAt: capacityNow + 6_000, activeAtSubmit: 16, limitAtSubmit: 16,
}, adaptivePolicy);
assert.equal(firstAmbiguous429.currentWindow, 16);
const secondAmbiguous429 = applyGenerationCapacityEvidence(firstAmbiguous429, {
  kind: 'ambiguous_429', observedAt: capacityNow + 7_000, activeAtSubmit: 16, limitAtSubmit: 16,
}, adaptivePolicy);
assert.equal(secondAmbiguous429.currentWindow, 8,
  'a repeated ambiguous 429 inside ten minutes should also tighten concurrency');

const submissionUnknown = applyGenerationCapacityEvidence(beforeRateLimit, {
  kind: 'submission_unknown', observedAt: capacityNow + 7_500, activeAtSubmit: 16, limitAtSubmit: 16,
}, adaptivePolicy);
assert.equal(submissionUnknown.currentWindow, 16,
  'a no-response submission outcome must not be treated as a discovered capacity boundary');
assert.equal(submissionUnknown.cooldownUntil, undefined);

let unavailableState: GenerationCapacityState = { ...beforeRateLimit, availabilityFailureTimes: [] };
for (let failure = 1; failure <= 3; failure += 1) {
  unavailableState = applyGenerationCapacityEvidence(unavailableState, {
    kind: 'availability', observedAt: capacityNow + 8_000 + failure * 100,
  }, adaptivePolicy);
}
assert.equal(unavailableState.currentWindow, 16,
  'generic availability failures must not pretend to discover a provider concurrency boundary');
assert.equal(unavailableState.phase, beforeRateLimit.phase,
  'generic provider availability failures must not open a capacity circuit');

let recoveryState: GenerationCapacityState = { ...submissionUnknown, cooldownUntil: undefined, currentWindow: 4 };
for (let accepted = 0; accepted < 4; accepted += 1) {
  recoveryState = markGenerationCapacitySubmissionAccepted(
    recoveryState,
    capacityNow + 9_000 + accepted,
    adaptivePolicy,
  );
}
assert.equal(recoveryState.currentWindow, 8,
  'a reduced capacity group must recover quickly from fresh accepted submissions');

const beforeTerminal = { ...adaptiveState, currentWindow: 16, cooldownUntil: undefined };
assert.deepEqual(
  applyGenerationCapacityEvidence(beforeTerminal, {
    kind: 'neutral', observedAt: capacityNow + 8_000, activeAtSubmit: 16, limitAtSubmit: 16,
  }, adaptivePolicy).currentWindow,
  16,
  'video terminal outcomes must not participate in concurrency learning',
);
assert.equal(classifyGenerationCapacityEvidence({ status: 'succeeded' }).kind, 'neutral');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'failed', error: { code: 'GENERATION_TIMEOUT', message: '1200 seconds timeout' },
}).kind, 'neutral');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'failed', error: { errorCode: 'rate_limited', httpStatus: 429, errorType: 'rpm' },
}).kind, 'rate_limit');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'failed', error: { errorCode: 'queue_full', httpStatus: 400 },
}).kind, 'concurrency_limit');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'failed', error: { errorCode: 'rate_limited', httpStatus: 429 },
}).kind, 'ambiguous_429');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'failed', error: { errorCode: 'provider_unavailable', httpStatus: 503 },
}).kind, 'neutral');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'submission_unknown', error: { code: 'AION_SUBMISSION_UNKNOWN', transportCode: 'ECONNRESET' },
}).kind, 'neutral');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'submission_unknown', error: { code: 'MISSING_PROVIDER_TASK_ID' },
}).kind, 'neutral');
assert.equal(classifyGenerationCapacityEvidence({
  status: 'failed', error: { errorCode: 'validation_error', httpStatus: 400 },
}).kind, 'neutral');

const staleState = refreshGenerationCapacityState({
  ...beforeTerminal,
  currentWindow: 16,
  lastActivityAt: capacityNow - adaptivePolicy.idleResetMs - 1,
  configFingerprint: 'old',
}, 'new', capacityNow, adaptivePolicy);
assert.equal(staleState.currentWindow, 8);
assert.equal(staleState.acceptedInWave, 0);
assert.equal(staleState.configFingerprint, 'new');

const validationOverrides = parseGenerationModelValidationOverrides(JSON.stringify({
  'wan/wan3.0-video': { promptMaxLength: 5000 },
}));
assert.deepEqual(validationOverrides['wan/wan3.0-video'], { promptMaxLength: 5000 });
const structuredValidationOverrides = parseGenerationModelValidationOverrides(JSON.stringify({
  'provider/future-video': {
    promptLength: {
      unit: 'unicode_code_points',
      string: { maxLength: 5000 },
      array: {
        scope: 'array_joined',
        maxLength: 5000,
        separator: '\n',
        trimItems: true,
        omitEmptyItems: true,
      },
    },
  },
}));
assert.deepEqual(structuredValidationOverrides['provider/future-video'], {
  promptLength: {
    unit: 'unicode_code_points',
    string: { maxLength: 5000 },
    array: {
      scope: 'array_joined',
      maxLength: 5000,
      separator: '\n',
      trimItems: true,
      omitEmptyItems: true,
    },
  },
});
assert.throws(() => parseGenerationModelValidationOverrides(JSON.stringify({
  'wan/wan3.0-video': { promptMaxLength: 0 },
})), /positive integer/);
assert.throws(() => parseGenerationModelValidationOverrides(JSON.stringify({
  'provider/future-video': {
    promptLength: {
      unit: 'tokens',
      array: { scope: 'array_joined', maxLength: 1000 },
    },
  },
})), /unicode_code_points/);

const selectionRows = [
  { [DATASET_ITEM_ID_KEY]: 'item-1', case_id: 'case-1', prompt: 'One' },
  { [DATASET_ITEM_ID_KEY]: 'item-2', case_id: 'case-2', prompt: 'Two' },
  { [DATASET_ITEM_ID_KEY]: 'item-3', case_id: 'case-3', prompt: 'Three' },
];
assert.equal(generationPollPhase({
  status: 'processing',
  now: 1_500,
  timeoutAt: 1_000,
}), 'start_reconciling');
assert.equal(generationPollPhase({
  status: 'reconciling',
  now: 1_500,
  timeoutAt: 1_000,
  reconciliationDeadlineAt: 2_000,
}), 'reconciling');
assert.equal(generationPollPhase({
  status: 'reconciling',
  now: 2_000,
  timeoutAt: 1_000,
  reconciliationDeadlineAt: 2_000,
}), 'expired');

const receivedServiceError = Object.assign(new Error('safe upstream failure detail'), {
  status: 503,
  errorCode: 'provider_unavailable',
  retryable: true,
});
assert.deepEqual(generationSubmissionErrorDiagnostics(receivedServiceError), {
  httpStatus: 503,
  errorName: 'Error',
  errorCode: 'provider_unavailable',
  retryable: true,
  responseReceived: true,
  definitelyRejected: true,
});
assert.deepEqual(generationSubmissionFailure(receivedServiceError), {
  status: 'failed',
  error: {
    code: 'AION_HTTP_ERROR',
    message: 'safe upstream failure detail',
    httpStatus: 503,
    errorName: 'Error',
    errorCode: 'provider_unavailable',
    retryable: true,
    responseReceived: true,
  },
});
assert.equal(generationSubmissionErrorDiagnostics(Object.assign(new Error('bad request'), {
  status: 400,
})).definitelyRejected, true);
for (const httpStatus of [400, 500, 502, 503]) {
  const failure = generationSubmissionFailure(Object.assign(new Error(`HTTP ${httpStatus}`), { status: httpStatus }));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.error.code, httpStatus >= 500 ? 'AION_HTTP_ERROR' : 'AION_SUBMIT_REJECTED');
  assert.equal(failure.error.responseReceived, true);
}
const connectionRefused = Object.assign(new Error('connection refused'), {
  cause: { code: 'ECONNREFUSED' },
});
assert.deepEqual(generationSubmissionErrorDiagnostics(connectionRefused), {
  errorName: 'Error',
  transportCode: 'ECONNREFUSED',
  responseReceived: false,
  definitelyRejected: false,
});
assert.deepEqual(generationSubmissionFailure(connectionRefused), {
  status: 'submission_unknown',
  error: {
    code: 'AION_SUBMISSION_UNKNOWN',
    message: 'The Aion submission did not return an HTTP response; automatic retry is disabled to prevent duplicate billing.',
    errorName: 'Error',
    transportCode: 'ECONNREFUSED',
    responseReceived: false,
  },
});
const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
assert.equal(generationSubmissionFailure(aborted).status, 'submission_unknown');
const connectionReset = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
assert.equal(generationSubmissionFailure(connectionReset).status, 'submission_unknown');
const redactedFailure = generationSubmissionFailure(Object.assign(
  new Error(`upstream rejected https://provider.example/result.mp4?secret=hidden ${'x'.repeat(2_100)}`),
  { status: 500 },
));
assert.equal(redactedFailure.error.message.includes('secret=hidden'), false);
assert.ok(redactedFailure.error.message.length <= 2_000);
assert.equal(generationSubmissionErrorDiagnostics(Object.assign(new Error('unsafe code'), {
  code: 'https://internal.example/path with spaces',
})).transportCode, undefined, 'diagnostics must not expose arbitrary error text as a transport code');



const legacyFullSelection = resolveGenerationCaseSelection(selectionRows);
assert.deepEqual(legacyFullSelection.rows.map(item => item.datasetItemId), ['item-1', 'item-2', 'item-3']);
assert.deepEqual(legacyFullSelection.errors, []);

const subsetSelection = resolveGenerationCaseSelection(selectionRows, ['item-3', 'item-1']);
assert.deepEqual(subsetSelection.rows.map(item => item.datasetItemId), ['item-1', 'item-3']);
assert.deepEqual(subsetSelection.normalizedIds, ['item-1', 'item-3']);
assert.deepEqual(subsetSelection.errors, []);

const reorderedSubset = resolveGenerationCaseSelection(selectionRows, ['item-1', 'item-3']);
assert.deepEqual(reorderedSubset.normalizedIds, subsetSelection.normalizedIds);
assert.equal(
  fingerprintConfig({ selectedDatasetItemIds: reorderedSubset.normalizedIds }),
  fingerprintConfig({ selectedDatasetItemIds: subsetSelection.normalizedIds }),
);
assert.notEqual(
  fingerprintConfig({ selectedDatasetItemIds: subsetSelection.normalizedIds }),
  fingerprintConfig({ selectedDatasetItemIds: ['item-2'] }),
);
assert.deepEqual(uniqueGenerationReferences([
  'https://assets.example.com/first.mp4;https://assets.example.com/second.mp4',
  '["https://assets.example.com/third.mp4", "https://assets.example.com/first.mp4"]',
]), [
  'https://assets.example.com/first.mp4',
  'https://assets.example.com/second.mp4',
  'https://assets.example.com/third.mp4',
]);
const spacedAudioUrl = 'https://vidmuse.sandcdn.com/user/796854911166661/assets/uploads/te iubesc 2_1785886320816.mp4';
assert.deepEqual(flattenGenerationReferences(spacedAudioUrl), [
  'https://vidmuse.sandcdn.com/user/796854911166661/assets/uploads/te%20iubesc%202_1785886320816.mp4',
]);
assert.deepEqual(flattenGenerationReferences(JSON.stringify([
  { url: 'https://assets.example.com/reference one.png' },
  { url: 'https://assets.example.com/reference,two.png?token=a,b' },
])), [
  'https://assets.example.com/reference%20one.png',
  'https://assets.example.com/reference,two.png?token=a,b',
]);

const mediaInspection = inspectGenerationMediaInput({
  model_name: 'provider/video-pro',
  image_urls: [
    'https://assets.example.com/first frame.PNG?signature=1',
    'asset://uploaded-image',
  ],
  elements: [
    { frontal_image_url: 'https://assets.example.com/not-an-image.mp4' },
    { video_url: 'https://assets.example.com/reference.jpg' },
  ],
  audios: [
    { url: 'https://assets.example.com/sound.mp4' },
    { url: 'https://assets.example.com/no-extension' },
    { url: 'http://online-mining/reference.wav' },
    { url: 'http://localhost/reference.wav' },
    { url: 'http://192.168.1.8/reference.wav' },
    { url: 'http://[::1]/reference.wav' },
    { url: 'http://[::ffff:127.0.0.1]/reference.wav' },
  ],
}, [{
  id: 'uploaded-image',
  relativePath: 'image.bin',
  fileName: 'image.bin',
  contentType: 'image/png',
}]);
assert.equal(mediaInspection.references.length, 11);
assert.equal(mediaInspection.references[0].normalizedUrl, 'https://assets.example.com/first%20frame.PNG?signature=1');
assert.equal(mediaInspection.references[1].detectionSource, 'mime');
assert.deepEqual(mediaInspection.errors.map(issue => issue.code), [
  'MEDIA_TYPE_MISMATCH',
  'MEDIA_TYPE_MISMATCH',
  'MEDIA_TYPE_MISMATCH',
  'NON_PUBLIC_ASSET_URL',
  'NON_PUBLIC_ASSET_URL',
  'NON_PUBLIC_ASSET_URL',
  'NON_PUBLIC_ASSET_URL',
  'NON_PUBLIC_ASSET_URL',
]);
assert.ok(mediaInspection.warnings.some(issue =>
  issue.code === 'MEDIA_TYPE_UNVERIFIED' && issue.field === 'audios[1].url'));
assert.deepEqual(
  mediaInspection.references.slice(-5).map(reference => reference.nonPublicReason),
  ['single_label_host', 'localhost', 'private_ip', 'private_ip', 'private_ip'],
);

const bulkReview = applyBulkGenerationForceReview({
  cases: [
    {
      valid: false,
      generationType: 'text_to_video',
      errors: [{ code: 'UNSUPPORTED_PRESET_PARAMETER', field: 'generate_audio', message: 'unsupported' }],
      warnings: [],
      resolvedCase: { datasetItemId: 'case-a' },
    },
    {
      valid: false,
      generationType: 'reference_to_video',
      errors: [{ code: 'MEDIA_TYPE_MISMATCH', field: 'audios[0].url', message: 'wrong type' }],
      warnings: [],
      resolvedCase: { datasetItemId: 'case-b' },
    },
  ],
  reviews: {},
  errorCode: 'UNSUPPORTED_PRESET_PARAMETER',
  reason: 'Reviewed the unsupported parameter explicitly.',
  duplicateBillingRiskConfirmed: true,
});
assert.deepEqual(bulkReview['case-a'].force?.ruleCodes, ['UNSUPPORTED_PRESET_PARAMETER']);
assert.equal(bulkReview['case-a'].finalAionRequest, undefined);
assert.equal(bulkReview['case-b'], undefined);

const structuredRepairCases = [
  {
    valid: false,
    generationType: 'text_to_video',
    errors: [{
      code: 'UNSUPPORTED_CONTROL_VALUE',
      field: 'resolution',
      message: 'Resolution does not support value 720p.',
      evidence: {
        rawValue: '720p',
        normalizedValue: '720p',
        source: 'column',
        sourceColumn: 'resolution',
        allowedValues: ['1440p'],
        valueType: 'string',
        ruleSource: 'aion_options',
        modelConfigFingerprint: 'config-a',
      },
      repairActions: [
        { kind: 'set_parameter', field: 'resolution', allowedValues: ['1440p'], valueType: 'string' },
        { kind: 'use_parameter_column', field: 'resolution', valueType: 'string' },
        { kind: 'omit_parameter', field: 'resolution' },
      ],
    }],
    warnings: [],
    resolvedCase: {
      caseId: 'resolution-a',
      datasetItemId: 'resolution-a',
      compilerAudit: { compiledInput: { prompt: 'A', resolution: '720p' } },
    },
  },
  {
    valid: false,
    generationType: 'text_to_video',
    errors: [{
      code: 'UNSUPPORTED_CONTROL_VALUE',
      field: 'resolution',
      message: 'Resolution does not support value 1080p.',
      evidence: {
        rawValue: '1080p',
        normalizedValue: '1080p',
        source: 'column',
        sourceColumn: 'resolution',
        allowedValues: ['1440p'],
        valueType: 'string',
        ruleSource: 'aion_options',
        modelConfigFingerprint: 'config-a',
      },
      repairActions: [
        { kind: 'set_parameter', field: 'resolution', allowedValues: ['1440p'], valueType: 'string' },
        { kind: 'use_parameter_column', field: 'resolution', valueType: 'string' },
      ],
    }],
    warnings: [],
    resolvedCase: {
      caseId: 'resolution-b',
      datasetItemId: 'resolution-b',
      compilerAudit: { compiledInput: { prompt: 'B', resolution: '1080p' } },
    },
  },
  {
    valid: false,
    generationType: 'text_to_video',
    errors: [{
      code: 'UNSUPPORTED_CONTROL_VALUE',
      field: 'resolution',
      message: 'Resolution does not support value 720p.',
      evidence: {
        rawValue: '720p',
        normalizedValue: '720p',
        source: 'column',
        sourceColumn: 'resolution',
        allowedValues: ['1440p'],
        valueType: 'string',
        ruleSource: 'aion_options',
        modelConfigFingerprint: 'config-a',
      },
      repairActions: [{ kind: 'set_parameter', field: 'resolution', allowedValues: ['1440p'], valueType: 'string' }],
    }],
    warnings: [],
    resolvedCase: { caseId: 'resolution-expert', datasetItemId: 'resolution-expert' },
  },
] as any;
const structuredRepairWorkspace = buildGenerationBulkRepairWorkspace({
  cases: structuredRepairCases,
  reviews: { 'resolution-expert': { finalAionRequest: { prompt: 'owned by expert' } } },
  severity: 'error',
  code: 'UNSUPPORTED_CONTROL_VALUE',
  field: 'resolution',
});
assert.deepEqual(structuredRepairWorkspace.eligibleIds, ['resolution-a', 'resolution-b']);
assert.deepEqual(structuredRepairWorkspace.expertConflictIds, ['resolution-expert']);
assert.deepEqual(structuredRepairWorkspace.valueDistribution, [
  { value: '720p', count: 2 },
  { value: '1080p', count: 1 },
]);
assert.equal(
  generationParameterEditorValue('720p', ['1440p'], undefined),
  '',
  'an unsupported source value must not make the select display its first replacement option',
);
assert.equal(generationParameterEditorValue('1440p', ['1440p'], undefined), '1440p');
assert.equal(generationParameterEditorValue('720p', ['1440p'], { action: 'set', value: '1440p' }), '1440p');

const fixedResolutionRepair = applyBulkGenerationRepair({
  workspace: structuredRepairWorkspace,
  cases: structuredRepairCases,
  reviews: {
    'resolution-a': {
      inputOverride: { version: 1, content: { elements: { action: 'omit' } } },
      parameterColumnOverrides: { resolution: { version: 1, column: 'resolution_backup' } },
    },
    'resolution-expert': { finalAionRequest: { prompt: 'owned by expert' } },
  },
  selectedIds: ['resolution-a', 'resolution-b'],
  action: { kind: 'set_parameter', field: 'resolution', value: '1440p' },
});
assert.deepEqual(fixedResolutionRepair.appliedIds, ['resolution-a', 'resolution-b']);
assert.deepEqual(fixedResolutionRepair.reviews['resolution-a'].inputOverride?.parameters?.resolution, {
  action: 'set', value: '1440p',
});
assert.deepEqual(fixedResolutionRepair.reviews['resolution-a'].inputOverride?.content?.elements, { action: 'omit' });
assert.equal(fixedResolutionRepair.reviews['resolution-a'].parameterColumnOverrides?.resolution, undefined);
assert.deepEqual(fixedResolutionRepair.reviews['resolution-expert'].finalAionRequest, { prompt: 'owned by expert' });

const columnResolutionRepair = applyBulkGenerationRepair({
  workspace: structuredRepairWorkspace,
  cases: structuredRepairCases,
  reviews: fixedResolutionRepair.reviews,
  selectedIds: ['resolution-a'],
  action: { kind: 'use_parameter_column', field: 'resolution', column: 'resolution_backup' },
});
assert.deepEqual(columnResolutionRepair.reviews['resolution-a'].parameterColumnOverrides?.resolution, {
  version: 1, column: 'resolution_backup',
});
assert.equal(columnResolutionRepair.reviews['resolution-a'].inputOverride?.parameters?.resolution, undefined);

const mixedInputCases = [{
  valid: false,
  generationType: 'reference_to_video',
  errors: [{
    code: 'MCP_INPUT_MODE_CONFLICT',
    field: 'image_urls',
    message: 'mixed',
    repairActions: [
      { kind: 'keep_keyframes', omitFields: ['elements', 'audios'] },
      { kind: 'keep_references', omitFields: ['image_urls'] },
    ],
  }],
  warnings: [],
  resolvedCase: {
    caseId: 'mixed-a',
    datasetItemId: 'mixed-a',
    compilerAudit: {
      compiledInput: {
        image_urls: ['https://example.com/first-a.png'],
        elements: [{ frontal_image_url: 'https://example.com/reference-a.png' }],
        audios: [{ url: 'https://example.com/audio-a.wav' }],
      },
    },
  },
}] as any;
const mixedWorkspace = buildGenerationBulkRepairWorkspace({
  cases: mixedInputCases,
  reviews: {},
  severity: 'error',
  code: 'MCP_INPUT_MODE_CONFLICT',
  field: 'image_urls',
});
const keepKeyframesRepair = applyBulkGenerationRepair({
  workspace: mixedWorkspace,
  cases: mixedInputCases,
  reviews: {},
  selectedIds: ['mixed-a'],
  action: { kind: 'keep_keyframes', omitFields: ['elements', 'audios'] },
});
assert.deepEqual(keepKeyframesRepair.reviews['mixed-a'].inputOverride?.content?.elements, { action: 'omit' });
assert.deepEqual(keepKeyframesRepair.reviews['mixed-a'].inputOverride?.content?.audios, { action: 'omit' });
assert.equal(keepKeyframesRepair.reviews['mixed-a'].inputOverride?.content?.image_urls, undefined);

assert.deepEqual(excludeGenerationCaseIds(['a', 'b', 'c'], ['b', 'missing']), ['a', 'c']);
assert.deepEqual(restoreGenerationCaseIds(['a', 'c'], ['b'], ['a', 'b', 'c']), ['a', 'b', 'c']);

const bulkPromptCases = [
  {
    valid: false,
    generationType: 'text_to_video',
    errors: [{ code: 'PROMPT_TOO_LONG', field: 'prompt', message: 'too long' }],
    warnings: [],
    resolvedCase: {
      datasetItemId: 'prompt-case-a',
      compilerAudit: {
        contractFindings: [{ id: 'plugin-prompt-a', field: 'prompt', proposal: { kind: 'prompt_rewrite' } }],
      },
    },
  },
  {
    valid: false,
    generationType: 'text_to_video',
    errors: [
      { code: 'PROMPT_TOO_LONG', field: 'prompt[0]', message: 'too long' },
      { code: 'PROMPT_TOO_LONG', field: 'prompt[1]', message: 'too long' },
    ],
    warnings: [],
    resolvedCase: { datasetItemId: 'prompt-case-b' },
  },
  {
    valid: true,
    generationType: 'text_to_video',
    errors: [],
    warnings: [],
    resolvedCase: { datasetItemId: 'prompt-case-c' },
  },
] as any;
const bulkPromptResult = applyBulkPromptColumnReview({
  cases: bulkPromptCases,
  reviews: {
    'prompt-case-a': {
      acceptedFindingIds: ['plugin-prompt-a', 'plugin-media-a'],
      rejectedFindingIds: ['plugin-prompt-old'],
      promptOverride: 'legacy prompt',
      inputOverride: {
        version: 1,
        content: {
          prompt: { action: 'set', value: 'manual prompt' },
          elements: { action: 'set', value: [{ element_id: 7 }] },
        },
        parameters: { duration: { action: 'set', value: 8 } },
      },
      force: {
        reason: 'reviewed media risk',
        duplicateBillingRiskConfirmed: true,
        ruleCodes: ['MEDIA_TYPE_MISMATCH'],
      },
    },
  },
  column: 'prompt_zh',
});
assert.deepEqual(bulkPromptResult.targetIds, ['prompt-case-a', 'prompt-case-b']);
assert.equal(bulkPromptResult.overwrittenPromptReviewCount, 1);
assert.deepEqual(bulkPromptResult.expertConflictIds, []);
assert.deepEqual(bulkPromptResult.reviews['prompt-case-a'].promptColumnOverride, {
  version: 1,
  column: 'prompt_zh',
});
assert.equal(bulkPromptResult.reviews['prompt-case-a'].promptOverride, undefined);
assert.equal(bulkPromptResult.reviews['prompt-case-a'].inputOverride?.content?.prompt, undefined);
assert.deepEqual(bulkPromptResult.reviews['prompt-case-a'].inputOverride?.content?.elements, {
  action: 'set',
  value: [{ element_id: 7 }],
});
assert.deepEqual(bulkPromptResult.reviews['prompt-case-a'].inputOverride?.parameters?.duration, {
  action: 'set',
  value: 8,
});
assert.deepEqual(bulkPromptResult.reviews['prompt-case-a'].acceptedFindingIds, ['plugin-media-a']);
assert.equal(bulkPromptResult.reviews['prompt-case-a'].rejectedFindingIds, undefined);
assert.deepEqual(bulkPromptResult.reviews['prompt-case-a'].force?.ruleCodes, ['MEDIA_TYPE_MISMATCH']);
assert.deepEqual(bulkPromptResult.reviews['prompt-case-b'].promptColumnOverride, {
  version: 1,
  column: 'prompt_zh',
});
assert.equal(bulkPromptResult.reviews['prompt-case-c'], undefined);

const expertBulkPromptReviews = {
  'prompt-case-b': { finalAionRequest: { prompt: 'expert' } },
};
const expertBulkPromptResult = applyBulkPromptColumnReview({
  cases: bulkPromptCases,
  reviews: expertBulkPromptReviews,
  column: 'prompt_zh',
});
assert.deepEqual(expertBulkPromptResult.expertConflictIds, ['prompt-case-b']);
assert.equal(expertBulkPromptResult.reviews, expertBulkPromptReviews,
  'an expert conflict must block the entire bulk operation');
assert.deepEqual(generationPromptReplacementColumns({
  headers: ['case_id', 'prompt', 'prompt_zh', 'notes', 'image', 'elements', 'legacy_media', 'result', '__hidden'],
  inputSchema: [
    { key: 'case_id', label: 'Case ID', type: 'text', role: 'case_id' },
    { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
    { key: 'prompt_zh', label: 'Prompt 中文', type: 'text', role: 'input' },
    { key: 'notes', label: 'Notes', type: 'text', role: 'metadata' },
    { key: 'image', label: 'Image', type: 'image_url', role: 'media' },
    { key: 'elements', label: 'Elements', type: 'text', role: 'reference' },
    { key: 'result', label: 'Result', type: 'video_url', role: 'output' },
  ],
  primaryPromptColumn: 'prompt',
  outputColumns: ['result'],
  referenceColumns: ['legacy_media'],
}), ['prompt_zh', 'notes']);
assert.deepEqual(generationParameterReplacementColumns({
  headers: ['case_id', 'resolution', 'resolution_override', 'duration_backup', 'image', 'elements', 'result', '__hidden'],
  inputSchema: [
    { key: 'case_id', label: 'Case ID', type: 'text', role: 'case_id' },
    { key: 'resolution', label: 'Resolution', type: 'text', role: 'input' },
    { key: 'resolution_override', label: 'Resolution override', type: 'text', role: 'metadata' },
    { key: 'duration_backup', label: 'Duration backup', type: 'text', role: 'dimension' },
    { key: 'image', label: 'Image', type: 'image_url', role: 'media' },
    { key: 'elements', label: 'Elements', type: 'text', role: 'reference' },
    { key: 'result', label: 'Result', type: 'video_url', role: 'output' },
  ],
  currentColumn: 'resolution',
  outputColumns: ['result'],
  referenceColumns: ['elements'],
}), ['resolution_override', 'duration_backup']);
assert.equal(generationForceRequiresFinalJson(['UNSUPPORTED_PRESET_PARAMETER']), true);
assert.equal(generationForceRequiresFinalJson(['MEDIA_TYPE_MISMATCH']), false);
assert.deepEqual(generationForceBypassableCodes({
  errorCodes: ['UNSUPPORTED_PRESET_PARAMETER', 'MEDIA_TYPE_MISMATCH'],
  selectedRuleCodes: ['UNSUPPORTED_PRESET_PARAMETER', 'MEDIA_TYPE_MISMATCH'],
  hasFinalAionRequest: false,
}), ['MEDIA_TYPE_MISMATCH']);
assert.deepEqual(generationForceBypassableCodes({
  errorCodes: ['UNSUPPORTED_PRESET_PARAMETER', 'MEDIA_TYPE_MISMATCH'],
  selectedRuleCodes: ['UNSUPPORTED_PRESET_PARAMETER'],
  hasFinalAionRequest: true,
}), ['UNSUPPORTED_PRESET_PARAMETER']);
assert.deepEqual(generationPendingForceCodes({
  errorCodes: ['UNSUPPORTED_PRESET_PARAMETER', 'MEDIA_TYPE_MISMATCH'],
  selectedRuleCodes: ['UNSUPPORTED_PRESET_PARAMETER', 'MEDIA_TYPE_MISMATCH'],
  bypassedCodes: ['MEDIA_TYPE_MISMATCH'],
}), ['UNSUPPORTED_PRESET_PARAMETER']);
assert.deepEqual(generationPendingForceCodes({
  errorCodes: ['MEDIA_TYPE_MISMATCH'],
  selectedRuleCodes: ['MEDIA_TYPE_MISMATCH'],
  bypassedCodes: ['MEDIA_TYPE_MISMATCH'],
}), []);


assert.ok(resolveGenerationCaseSelection(selectionRows, []).errors.some(issue => issue.code === 'EMPTY_SELECTION'));
assert.ok(resolveGenerationCaseSelection(selectionRows, ['missing']).errors.some(issue => issue.code === 'UNKNOWN_SELECTED_ITEM_ID'));
assert.ok(resolveGenerationCaseSelection(selectionRows, ['item-1', 'item-1']).errors.some(issue => issue.code === 'DUPLICATE_SELECTED_ITEM_ID'));

const generatedDataset = {
  inputSchema: [
    { key: 'generated_video', label: 'generated_video', type: 'video_url', role: 'output', previewType: 'video' },
  ],
  columnMappings: {
    inputColumns: ['prompt'],
    outputColumns: ['generated_video'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: {},
  },
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'item-1',
      generated_video: 'https://assets.example.com/one.mp4',
      generated_video_params_json: JSON.stringify({ modelName: 'provider/video-pro', configFingerprint: 'old-fingerprint' }),
    },
    { [DATASET_ITEM_ID_KEY]: 'item-2', generated_video: '' },
  ],
} as any;

assert.ok(inspectGenerationTargetColumn(generatedDataset, {
  mode: 'new',
  targetColumn: 'generated_video',
  modelName: 'provider/video-pro',
  outputModality: 'video',
}).errors.some(issue => issue.code === 'TARGET_COLUMN_EXISTS'));

const fillTarget = inspectGenerationTargetColumn(generatedDataset, {
  mode: 'fill_existing',
  targetColumn: 'generated_video',
  modelName: 'provider/video-pro',
  outputModality: 'video',
  configFingerprint: 'new-fingerprint',
});
assert.equal(fillTarget.completedCount, 1);
assert.equal(fillTarget.emptyCount, 1);
assert.deepEqual(fillTarget.errors, []);
assert.ok(fillTarget.warnings.some(issue => issue.code === 'TARGET_CONFIG_CHANGED'));

assert.ok(inspectGenerationTargetColumn(generatedDataset, {
  mode: 'fill_existing',
  targetColumn: 'generated_video',
  modelName: 'provider/other-video',
  outputModality: 'video',
}).errors.some(issue => issue.code === 'TARGET_MODEL_MISMATCH'));

assert.ok(inspectGenerationTargetColumn(generatedDataset, {
  mode: 'fill_existing',
  targetColumn: 'generated_video',
  modelName: 'provider/video-pro',
  outputModality: 'image',
}).errors.some(issue => issue.code === 'TARGET_MODALITY_MISMATCH'));

const generatedMetadataMappings = inferDatasetMappings(
  ['case_id', 'model_output_request_id'],
  [{ case_id: 'case-1', model_output_request_id: 'request-1' }],
);
assert.equal(generatedMetadataMappings.caseId, 'case_id');
assert.equal(generatedMetadataMappings.standard.case_id, 'case_id');

const mappingDataset = {
  inputSchema: [
    { key: '完整Prompt', label: '完整Prompt', type: 'text', canonicalKey: 'full_prompt' },
    { key: '参考图_URLs', label: '参考图_URLs', type: 'image_url', previewType: 'image', canonicalKey: 'reference_image_urls' },
    { key: '首帧图_URL', label: '首帧图_URL', type: 'image_url', previewType: 'image', canonicalKey: 'start_image_url' },
    { key: '尾帧图_URL', label: '尾帧图_URL', type: 'image_url', previewType: 'image', canonicalKey: 'end_image_url' },
    { key: '音频_URL', label: '音频_URL', type: 'audio_url', previewType: 'audio', canonicalKey: 'audio_url' },
  ],
  items: [],
} as any;
const mappingHeaders = mappingDataset.inputSchema.map((field: { key: string }) => field.key);
const emptyMediaMapping = defaultGenerationInputMapping(
  mappingDataset,
  mappingHeaders,
  { standard: { full_prompt: '完整Prompt' }, inputColumns: [], outputColumns: [], dimensionColumns: [], referenceColumns: [] },
);
assert.equal(emptyMediaMapping.promptColumn, '完整Prompt');
assert.deepEqual(emptyMediaMapping.referenceImageColumns, []);
assert.deepEqual(emptyMediaMapping.referenceAudioColumns, []);
assert.deepEqual(emptyMediaMapping.referenceVideoColumns, []);
assert.equal(emptyMediaMapping.startImageColumn, '');
assert.equal(emptyMediaMapping.endImageColumn, '');
assert.equal(emptyMediaMapping.mappingMode, 'mcp');
assert.equal(emptyMediaMapping.compatibilityMode, 'strict');
assert.equal(emptyMediaMapping.canonicalFieldMappings?.prompt, emptyMediaMapping.promptColumn);
assert.equal(inferGenerationImageRole('参考图_URLs', mappingDataset.inputSchema), 'reference');
assert.equal(inferGenerationImageRole('首帧图_URL', mappingDataset.inputSchema), 'start');
assert.equal(inferGenerationImageRole('尾帧图_URL', mappingDataset.inputSchema), 'end');
assert.equal(inferGenerationImageRole('\u9996\u5e27\u56fe_URL', []), 'start');
assert.equal(inferGenerationImageRole('\u5c3e\u5e27\u56fe_URL', []), 'end');
const canonicalDefaultMapping = defaultGenerationInputMapping(
  { inputSchema: [], items: [] } as any,
  ['prompt', 'image_urls', 'elements', 'audios'],
  {
    standard: {},
    inputColumns: ['prompt'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
  },
);
assert.deepEqual(canonicalDefaultMapping.canonicalFieldMappings, { prompt: 'prompt' });
const exactPromptDefaultMapping = defaultGenerationInputMapping(
  { inputSchema: [], items: [] } as any,
  ['other_input', 'prompt'],
  {
    standard: {},
    inputColumns: ['other_input'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
  },
);
assert.equal(exactPromptDefaultMapping.promptColumn, 'prompt');
assert.equal(exactPromptDefaultMapping.canonicalFieldMappings?.prompt, 'prompt');

const vidMusePresetHeaders = [
  'case_id', 'cell_id', 'modality', 'effects', 'intent', 'variant_label', 'prompt',
  'duration', 'aspect_ratio', 'resolution', 'generate_audio', 'audio_url',
  'source_thread', 'source_note', 'image_urls', 'elements',
];
assert.equal(hasVidMuseEvaluationPreset(vidMusePresetHeaders), true);
const vidMuseVideoPreset = defaultGenerationInputMapping(
  { inputSchema: [], items: [] } as any,
  vidMusePresetHeaders,
  { standard: {}, inputColumns: [], outputColumns: [], dimensionColumns: [], referenceColumns: [] },
  'video',
);
assert.equal(vidMuseVideoPreset.presetId, 'vidmuse_evaluation_v1');
assert.deepEqual(vidMuseVideoPreset.contentMapping?.keyframes, { source: 'array_column', column: 'image_urls' });
assert.deepEqual(vidMuseVideoPreset.contentMapping?.elements, { source: 'array_column', column: 'elements' });
assert.deepEqual(vidMuseVideoPreset.contentMapping?.audios, {
  source: 'builder',
  items: [{ id: 'preset-audio-1', urlColumn: 'audio_url', rangeSource: 'none' }],
});
const vidMuseImagePreset = defaultGenerationInputMapping(
  { inputSchema: [], items: [] } as any,
  vidMusePresetHeaders,
  { standard: {}, inputColumns: [], outputColumns: [], dimensionColumns: [], referenceColumns: [] },
  'image',
);
assert.deepEqual(vidMuseImagePreset.contentMapping?.elements, { source: 'unused' });
assert.deepEqual(vidMuseImagePreset.contentMapping?.audios, { source: 'unused' });
assert.deepEqual(defaultVidMuseEvaluationParameterColumns(
  vidMusePresetHeaders,
  ['aspect_ratio', 'resolution', 'generate_audio', 'watermark'],
), {
  aspect_ratio: { source: 'column', column: 'aspect_ratio' },
  resolution: { source: 'column', column: 'resolution' },
  generate_audio: { source: 'column', column: 'generate_audio' },
});
assert.equal(generationRowMatchesModality({ modality: 'video' }, 'video'), true);
assert.equal(generationRowMatchesModality({ modality: 'image' }, 'video'), false);
assert.equal(generationRowMatchesModality({}, 'video'), true);
assert.equal(generationRowMatchesModality({ _originalData: { modality: 'image' } }, 'video'), false);

const importedVidMusePresetDataset = {
  inputSchema: [
    { key: '\u7528\u4f8bID', label: '\u7528\u4f8bID', sourceKey: 'case_id', canonicalKey: 'case_id' },
    { key: 'modality', label: 'modality', sourceKey: 'modality' },
    { key: '\u5b8c\u6574Prompt', label: '\u5b8c\u6574Prompt', sourceKey: 'prompt', canonicalKey: 'full_prompt' },
    { key: 'duration', label: 'duration', sourceKey: 'duration' },
    { key: 'aspect_ratio', label: 'aspect_ratio', sourceKey: 'aspect_ratio' },
    { key: 'resolution', label: 'resolution', sourceKey: 'resolution' },
    { key: 'generate_audio', label: 'generate_audio', sourceKey: 'generate_audio' },
    { key: '\u97f3\u9891_URL', label: '\u97f3\u9891_URL', sourceKey: 'audio_url', canonicalKey: 'audio_url' },
    { key: 'image_urls', label: 'image_urls', sourceKey: 'image_urls' },
    { key: 'elements', label: 'elements', sourceKey: 'elements' },
  ],
  items: [],
} as any;
const importedVidMuseHeaders = importedVidMusePresetDataset.inputSchema.map((field: { key: string }) => field.key);
assert.equal(hasVidMuseEvaluationPreset(importedVidMuseHeaders, importedVidMusePresetDataset.inputSchema), true);
const importedVidMuseVideoPreset = defaultGenerationInputMapping(
  importedVidMusePresetDataset,
  importedVidMuseHeaders,
  {
    standard: { case_id: '\u7528\u4f8bID', full_prompt: '\u5b8c\u6574Prompt', audio_url: '\u97f3\u9891_URL' },
    inputColumns: ['\u5b8c\u6574Prompt', 'duration', 'aspect_ratio', 'resolution', 'generate_audio', 'image_urls', 'elements'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: ['\u97f3\u9891_URL'],
  },
  'video',
);
assert.equal(importedVidMuseVideoPreset.presetId, 'vidmuse_evaluation_v1');
assert.equal(importedVidMuseVideoPreset.contentMapping?.prompt.column, '\u5b8c\u6574Prompt');
assert.deepEqual(importedVidMuseVideoPreset.contentMapping?.keyframes, { source: 'array_column', column: 'image_urls' });
assert.deepEqual(importedVidMuseVideoPreset.contentMapping?.elements, { source: 'array_column', column: 'elements' });
assert.deepEqual(importedVidMuseVideoPreset.contentMapping?.audios, {
  source: 'builder',
  items: [{ id: 'preset-audio-1', urlColumn: '\u97f3\u9891_URL', rangeSource: 'none' }],
});
assert.deepEqual(defaultVidMuseEvaluationParameterColumns(
  importedVidMuseHeaders,
  ['aspect_ratio', 'resolution', 'generate_audio'],
  importedVidMusePresetDataset.inputSchema,
), {
  aspect_ratio: { source: 'column', column: 'aspect_ratio' },
  resolution: { source: 'column', column: 'resolution' },
  generate_audio: { source: 'column', column: 'generate_audio' },
});



const withReference = setGenerationImageRole(emptyMediaMapping, '参考图_URLs', 'reference');
const withStart = setGenerationImageRole(withReference, '首帧图_URL', 'start');
const withEnd = setGenerationImageRole(withStart, '尾帧图_URL', 'end');
assert.equal(getGenerationImageRole(withEnd, '参考图_URLs'), 'reference');
assert.equal(getGenerationImageRole(withEnd, '首帧图_URL'), 'start');
assert.equal(getGenerationImageRole(withEnd, '尾帧图_URL'), 'end');
assert.equal(getGenerationImageRole(setGenerationImageRole(withEnd, '首帧图_URL'), '首帧图_URL'), undefined);

const textImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: [],
  endUrls: [],
});
assert.equal(textImageInputs.generationType, undefined);
assert.deepEqual(textImageInputs.imageUrls, []);

const referenceImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: ['https://assets.example.com/ref-a.png', 'https://assets.example.com/ref-b.png'],
  startUrls: [],
  endUrls: [],
});
assert.equal(referenceImageInputs.generationType, 'reference_to_video');
assert.deepEqual(referenceImageInputs.imageUrls, [
  'https://assets.example.com/ref-a.png',
  'https://assets.example.com/ref-b.png',
]);

const startImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: ['https://assets.example.com/start.png'],
  endUrls: [],
});
assert.equal(startImageInputs.generationType, 'image_to_video');

const keyframeImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: ['https://assets.example.com/start.png'],
  endUrls: ['https://assets.example.com/end.png'],
});
assert.equal(keyframeImageInputs.generationType, 'images_to_video');
assert.deepEqual(keyframeImageInputs.imageUrls, [
  'https://assets.example.com/start.png',
  'https://assets.example.com/end.png',
]);
assert.deepEqual(keyframeImageInputs.issues, []);

const endOnlyImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: [],
  endUrls: ['https://assets.example.com/end.png'],
});
assert.ok(endOnlyImageInputs.issues.some(issue => issue.code === 'MISSING_START_IMAGE'));

const conflictingImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: ['https://assets.example.com/reference.png'],
  startUrls: ['https://assets.example.com/start.png'],
  endUrls: [],
});
assert.ok(conflictingImageInputs.issues.some(issue => issue.code === 'CONFLICTING_IMAGE_ROLES'));

const rawVideoModel = {
  id: 'model-config-1',
  name: 'provider/video-pro',
  display_name: 'Video Pro',
  description: 'Video model',
  model_type: 'video',
  provider: 'provider',
  capabilities: {
    text_to_video: true,
    image_to_video: true,
    images_to_video: true,
  },
  options: {
    supported_params: [
      'prompt',
      'image_urls',
      'generation_type',
      'aspect_ratio',
      'resolution',
      'camera_motion',
      'custom_strength',
      'duration',
      'generate_audio',
    ],
    aspect_ratio_options: ['16:9', '9:16'],
    resolution_options: ['720p', '1080p'],
    duration_options: [5, 10],
    default_duration: 5,
    default_resolution: '720p',
    parameter_schema: {
      properties: {
        custom_strength: {
          type: 'number',
          title: 'Custom strength',
          default: 0.5,
        },
      },
    },
    input_schema: {
      version: '1',
      unsupported_inputs: ['audio_url'],
      required_inputs: {
        text_to_video: ['prompt'],
        image_to_video: ['image_urls'],
      },
      required_one_of_inputs: {},
    },
  },
  input_schema: {
    version: '1',
    unsupported_inputs: ['audio_url'],
    required_inputs: {
      text_to_video: ['prompt'],
      image_to_video: ['image_urls'],
    },
    required_one_of_inputs: {},
  },
  price_items: [{ unit: 'generation', credits: 12 }],
  cost_items: [],
  update_time: '2026-08-01T00:00:00Z',
};

const camelCaseVideoModel = {
  name: 'seedance-2.0-pro',
  displayName: 'Seedance 2.0 Pro',
  description: 'CLI-shaped model config',
  type: 'video',
  subType: 'video',
  provider: 'provider',
  capabilities: {
    image2video: true,
    ref2video: true,
  },
  options: {
    duration_options: [5, 10, 15],
    resolution_options: ['720p', '1080p', '2160p'],
    resolution: '1080p',
    audios_count_range: [0, 1],
    required_params: {
      image_to_video: ['prompt'],
      reference_to_video: ['prompt'],
    },
    required_one_of_params: {
      image_to_video: [['image_urls', 'elements']],
      reference_to_video: [['image_urls', 'elements']],
    },
    supportedParams: ['prompt', 'image_urls', 'elements', 'audios', 'audio_url', 'duration', 'resolution'],
  },
  priceItems: [
    { unit_type: 'seconds', price: { input: 0, output: 20 } },
    { unit_type: 'seconds', properties: { resolution: '2160p' }, price: { input: 0, output: 80 } },
  ],
};

const videoModel = normalizeAionModelConfig(rawVideoModel);
const unsupportedPresetParameterModel = normalizeAionModelConfig({
  ...rawVideoModel,
  name: 'provider/video-without-evaluation-controls',
  options: {
    supported_params: ['prompt', 'image_urls', 'elements', 'audios', 'generation_type'],
    input_schema: {
      supported_inputs: ['prompt', 'image_urls', 'elements', 'audios'],
      required_inputs: { text_to_video: ['prompt'] },
      required_one_of_inputs: {},
    },
  },
  input_schema: {
    supported_inputs: ['prompt', 'image_urls', 'elements', 'audios'],
    required_inputs: { text_to_video: ['prompt'] },
    required_one_of_inputs: {},
  },
});
const unsupportedPresetDataset = {
  id: 'dataset-unsupported-preset-parameters',
  inputSchema: vidMusePresetHeaders.map(key => ({ key, label: key, sourceKey: key })),
  items: [{
    [DATASET_ITEM_ID_KEY]: 'unsupported-preset-item',
    case_id: 'unsupported-preset-case',
    modality: 'video',
    prompt: 'Use the supplied audio.',
    duration: 5,
    aspect_ratio: '16:9',
    resolution: '720p',
    generate_audio: true,
    audio_url: spacedAudioUrl,
    image_urls: '[]',
    elements: '[]',
  }],
} as any;
const unsupportedPresetRequest = {
  datasetId: unsupportedPresetDataset.id,
  datasetVersion: 1,
  modelName: unsupportedPresetParameterModel.modelName,
  targetColumn: 'result',
  inputMapping: vidMuseVideoPreset,
  defaultControls: {},
  perCaseControlColumns: {},
  parameterBindings: {},
  seedMode: 'unused',
  seedPolicyVersion: 2,
} as any;
const unsupportedPresetCase = buildGenerationCasesForPreflight(
  unsupportedPresetDataset,
  unsupportedPresetRequest,
  unsupportedPresetParameterModel,
  [{
    row: unsupportedPresetDataset.items[0],
    rowIndex: 0,
    datasetItemId: 'unsupported-preset-item',
  }],
)[0];
assert.deepEqual(
  unsupportedPresetCase.preparationIssues
    .filter(issue => issue.code === 'UNSUPPORTED_PRESET_PARAMETER')
    .map(issue => issue.field),
  ['duration', 'aspect_ratio', 'resolution', 'generate_audio'],
);
assert.equal(unsupportedPresetCase.resolvedCase.parameterAudit?.resolution.destination, 'blocked');
assert.deepEqual(unsupportedPresetCase.resolvedCase.audioUrls, [
  'https://vidmuse.sandcdn.com/user/796854911166661/assets/uploads/te%20iubesc%202_1785886320816.mp4',
]);
assert.deepEqual(unsupportedPresetCase.resolvedCase.compilerAudit?.mediaReferences?.[0], {
  field: 'audios[0].url',
  originalUrl: spacedAudioUrl,
  normalizedUrl: 'https://vidmuse.sandcdn.com/user/796854911166661/assets/uploads/te%20iubesc%202_1785886320816.mp4',
  expectedKind: 'audio',
  detectedKind: 'video',
  detectionSource: 'extension',
});
const unsupportedPresetMcpInput = buildMcpToolInput(
  unsupportedPresetParameterModel,
  unsupportedPresetCase.resolvedCase,
);
const unsupportedPresetAionRequest = buildAionGenerationRequest(
  unsupportedPresetParameterModel,
  {
    ...unsupportedPresetCase.resolvedCase,
    generationType: unsupportedPresetCase.resolvedCase.generationType || 'manual_review',
  },
).body;
assert.deepEqual(unsupportedPresetMcpInput.audios, [{
  url: 'https://vidmuse.sandcdn.com/user/796854911166661/assets/uploads/te%20iubesc%202_1785886320816.mp4',
}]);
assert.deepEqual(unsupportedPresetAionRequest.audios, unsupportedPresetMcpInput.audios);
assert.deepEqual(generationRequestProjectionDiff(
  unsupportedPresetParameterModel,
  unsupportedPresetMcpInput,
  unsupportedPresetAionRequest,
), []);
assert.ok(unsupportedPresetCase.preparationIssues.some(issue =>
  issue.code === 'MEDIA_TYPE_MISMATCH' && issue.field === 'audios[0].url'));

const omittedPresetRequest = {
  ...unsupportedPresetRequest,
  parameterBindings: {
    duration: { source: 'unused' },
    aspect_ratio: { source: 'unused' },
    resolution: { source: 'unused' },
    generate_audio: { source: 'unused' },
  },
} as any;
assert.doesNotThrow(() => validateGenerationParameterBindings(
  omittedPresetRequest,
  unsupportedPresetParameterModel,
  unsupportedPresetDataset,
));
const omittedPresetCase = buildGenerationCasesForPreflight(
  unsupportedPresetDataset,
  omittedPresetRequest,
  unsupportedPresetParameterModel,
  [{
    row: unsupportedPresetDataset.items[0],
    rowIndex: 0,
    datasetItemId: 'unsupported-preset-item',
  }],
)[0];
assert.equal(omittedPresetCase.preparationIssues.some(issue =>
  issue.code === 'UNSUPPORTED_PRESET_PARAMETER'), false);
assert.equal(omittedPresetCase.resolvedCase.parameterAudit?.generate_audio.destination, 'omitted');
assert.equal(omittedPresetCase.resolvedCase.parameterAudit?.generate_audio.source, 'unused');
assert.ok(omittedPresetCase.preparationWarnings.some(issue =>
  issue.code === 'PRESET_PARAMETER_EXPLICITLY_OMITTED' && issue.field === 'generate_audio'));
const overrideBaseRequest = {
  model_name: videoModel.modelName,
  generation_type: 'image_to_video',
  prompt: 'Original prompt',
  image_urls: ['https://cdn.example.com/first.png'],
  features: { auto_adjust_duration_to_supported: false },
};
assert.equal(validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  prompt: 'Reviewed prompt',
}).prompt, 'Reviewed prompt');
assert.throws(() => validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  model_name: 'another/model',
}), /selected model is immutable/i);
assert.throws(() => validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  features: { auto_adjust_duration_to_supported: true },
}), /features object is immutable/i);
assert.throws(() => validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  callback_url: 'https://attacker.example.com/callback',
}), /protected field/i);
assert.throws(() => validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  image_urls: ['file:///etc/passwd'],
}), /file URL/i);
assert.throws(() => validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  audios: [{ url: '../private/audio.mp3' }],
}), /Path traversal/i);
const reviewedOverrideRequest = validateGenerationRequestOverride(videoModel, overrideBaseRequest, {
  ...overrideBaseRequest,
  generation_type: 'reference_to_video',
  prompt: 'Reviewed request',
  image_urls: [],
  elements: [{ frontal_image_url: 'https://cdn.example.com/reference.png' }],
});
assert.deepEqual(buildAionGenerationRequest(videoModel, {
  caseId: 'override-case',
  datasetItemId: 'override-item',
  rowIndex: 0,
  prompt: 'Original request',
  imageUrls: ['https://cdn.example.com/first.png'],
  audioUrls: [],
  controls: {},
  generationType: 'image_to_video',
  compilerAudit: {
    compilerVersion: '3',
    compatibilityApplied: false,
    originalInput: {},
    compiledInput: {},
    bindings: { images: [], elements: [], audios: [] },
    overrideAudit: {
      forced: true,
      reason: 'Reviewed model-specific contract.',
      actorId: 'user-1',
      actorName: 'Tester',
      reviewedAt: 1,
      originalRequest: overrideBaseRequest,
      finalRequest: reviewedOverrideRequest,
      bypassedRules: ['UNSUPPORTED_GENERATION_TYPE'],
      configFingerprint: videoModel.configFingerprint,
    },
  },
}).body, reviewedOverrideRequest);
assert.equal(videoModel.id, rawVideoModel.name);
assert.equal(videoModel.outputModality, 'video');
assert.deepEqual(getSupportedGenerationImageRoles(videoModel), ['start', 'end']);
assert.deepEqual(videoModel.supportedDurations, [5, 10]);
assert.equal(videoModel.controls.find(item => item.key === 'duration')?.defaultValue, 5);
assert.ok(videoModel.configFingerprint);
assert.equal(videoModel.supportsSeed, false);
assert.throws(() => buildAionGenerationRequest(videoModel, {
  caseId: 'unsupported-seed-case',
  datasetItemId: 'unsupported-seed-item',
  rowIndex: 0,
  prompt: 'Do not silently discard this seed.',
  imageUrls: [],
  audioUrls: [],
  controls: {},
  generationType: 'text_to_video',
  seed: 0,
  seedPolicyVersion: 2,
} as any), /does not declare Seed support/i);
const misleadingSeedOptionModel = normalizeAionModelConfig({
  ...rawVideoModel,
  name: 'provider/misleading-seed-option',
  options: {
    ...rawVideoModel.options,
    seed: true,
  },
});
assert.equal(misleadingSeedOptionModel.supportsSeed, false);
const camelOnlySeedModel = normalizeAionModelConfig({
  ...rawVideoModel,
  name: 'provider/camel-only-seed',
  options: {
    ...rawVideoModel.options,
    supported_params: undefined,
    supportedParams: ['prompt', 'seed'],
  },
});
assert.equal(camelOnlySeedModel.supportsSeed, false);
assert.doesNotThrow(() => validateGenerationSeedConfiguration({
  datasetId: 'dataset',
  datasetVersion: 1,
  modelName: videoModel.modelName,
  targetColumn: 'result',
  inputMapping: {},
  seedMode: 'unused',
  seedPolicyVersion: 2,
} as any, videoModel, 'task_worker'));
assert.throws(() => validateGenerationSeedConfiguration({
  datasetId: 'dataset',
  datasetVersion: 1,
  modelName: videoModel.modelName,
  targetColumn: 'result',
  inputMapping: {},
  seedMode: 'fixed',
  seedPolicyVersion: 2,
  fixedSeed: 0,
} as any, videoModel, 'model_api'), /does not declare Seed support/i);

assert.equal(videoModel.controls.find(item => item.key === 'camera_motion'), undefined);
assert.equal(videoModel.advancedParameters.find(item => item.key === 'camera_motion')?.verified, false);
assert.equal(videoModel.controls.find(item => item.key === 'custom_strength'), undefined);
assert.equal(videoModel.advancedParameters.find(item => item.key === 'custom_strength')?.verified, false);

const wanParameterModel = normalizeAionModelConfig({
  ...rawVideoModel,
  name: 'wan/wan3.0-video',
  options: {
    ...rawVideoModel.options,
    supported_params: [
      'prompt',
      'duration',
      'generate_audio',
      'watermark',
      'seed',
      'reference_image_urls',
      'multi_shots',
      'adapter_hint',
    ],
    parameter_schema: { properties: {} },
  },
});
assert.ok(wanParameterModel.controls.some(item => item.key === 'generate_audio' && item.type === 'toggle'));
assert.ok(wanParameterModel.controls.some(item => item.key === 'watermark' && item.type === 'toggle'));
assert.equal(wanParameterModel.supportsSeed, true);
assert.equal(wanParameterModel.controls.some(item => item.key === 'seed'), false);
assert.deepEqual(wanParameterModel.advancedParameters.map(item => item.key), ['adapter_hint']);
assert.deepEqual(
  wanParameterModel.invalidParameters.map(item => item.key).sort(),
  ['multi_shots', 'reference_image_urls'],
);
assert.match(
  wanParameterModel.invalidParameters.find(item => item.key === 'reference_image_urls')?.replacement || '',
  /elements\[\]\.reference_image_urls/,
);
assert.throws(() => validateGenerationSeedConfiguration({
  datasetId: 'dataset',
  datasetVersion: 1,
  modelName: wanParameterModel.modelName,
  targetColumn: 'result',
  inputMapping: {},
  seedMode: 'fixed',
  seedPolicyVersion: 2,
  fixedSeed: 0,
} as any, wanParameterModel, 'task_worker'), /task_worker/i);
assert.doesNotThrow(() => validateGenerationSeedConfiguration({
  datasetId: 'dataset',
  datasetVersion: 1,
  modelName: wanParameterModel.modelName,
  targetColumn: 'result',
  inputMapping: {},
  seedMode: 'fixed',
  seedPolicyVersion: 2,
  fixedSeed: 0,
} as any, wanParameterModel, 'model_api'));

const mcpProjectionModel = normalizeAionModelConfig({
  ...rawVideoModel,
  name: 'provider/mcp-projection-video',
  capabilities: {
    text_to_video: true,
    image_to_video: true,
    images_to_video: true,
    reference_to_video: true,
  },
  options: {
    ...rawVideoModel.options,
    supported_params: [
      'prompt', 'image_urls', 'elements', 'audios', 'duration', 'aspect_ratio',
      'resolution', 'generate_audio', 'negative_prompt', 'seed',
    ],
  },
});
const compilerAuditV3 = {
  compilerVersion: '3',
  compatibilityApplied: false,
  originalInput: {},
  compiledInput: {},
  bindings: { images: [], elements: [], audios: [] },
};
const mcpProjectionCases = [
  {
    generationType: 'text_to_video',
    imageUrls: [],
    audioUrls: [],
    extraInputs: {},
  },
  {
    generationType: 'image_to_video',
    imageUrls: ['https://assets.example.com/first.png'],
    audioUrls: [],
    extraInputs: {},
  },
  {
    generationType: 'images_to_video',
    imageUrls: [
      'https://assets.example.com/first.png',
      'https://assets.example.com/last.png',
    ],
    audioUrls: [],
    extraInputs: {},
  },
  {
    generationType: 'reference_to_video',
    imageUrls: [],
    audioUrls: [],
    extraInputs: {
      elements: [{ frontal_image_url: 'https://assets.example.com/character.png' }],
    },
  },
  {
    generationType: 'reference_to_video',
    imageUrls: [],
    audioUrls: ['https://assets.example.com/voice.wav'],
    audioInputs: [{ url: 'https://assets.example.com/voice.wav', range: [0.25, 3.75] as [number, number] }],
    extraInputs: {
      elements: [{ video_url: 'https://assets.example.com/reference.mp4' }],
    },
  },
].map((value, index) => ({
  caseId: `projection-case-${index}`,
  datasetItemId: `projection-item-${index}`,
  rowIndex: index,
  prompt: `Projection case ${index}`,
  controls: {
    duration: 5,
    aspect_ratio: '16:9',
    resolution: '720p',
    generate_audio: false,
  },
  compilerAudit: compilerAuditV3,
  ...value,
}));
mcpProjectionCases.forEach(item => {
  const mcpToolInput = buildMcpToolInput(mcpProjectionModel, item as any);
  const aionRequest = buildAionGenerationRequest(mcpProjectionModel, item as any).body;
  assert.deepEqual(generationRequestProjectionDiff(mcpProjectionModel, mcpToolInput, aionRequest), []);
  assert.equal(mcpToolInput.generation_type, undefined);
  assert.equal(mcpToolInput.features, undefined);
  assert.equal(mcpToolInput.extra_params, undefined);
  assert.equal(mcpToolInput.seed, undefined);
  assert.equal(aionRequest.generation_type, item.generationType);
  assert.equal(aionRequest.features.auto_adjust_duration_to_supported, false);
  assert.equal(aionRequest.generate_audio, false);
});
const forcedProjectionInput = buildMcpToolInput(mcpProjectionModel, mcpProjectionCases[0] as any);
assert.deepEqual(
  generationRequestProjectionDiff(mcpProjectionModel, forcedProjectionInput, {
    ...buildAionGenerationRequest(mcpProjectionModel, mcpProjectionCases[0] as any).body,
    prompt: 'Forced prompt override',
  }),
  [{ field: 'prompt', mcpValue: 'Projection case 0', aionValue: 'Forced prompt override' }],
);
const explicitZeroSeedRequest = buildAionGenerationRequest(mcpProjectionModel, {
  ...mcpProjectionCases[0],
  seed: 0,
  seedPolicyVersion: 2,
} as any).body;
assert.equal(explicitZeroSeedRequest.extra_params.seed, 0);
assert.equal(
  buildAionGenerationRequest(mcpProjectionModel, mcpProjectionCases[0] as any).body.extra_params.seed,
  undefined,
);
assert.throws(() => buildAionGenerationRequest(mcpProjectionModel, {
  ...mcpProjectionCases[0],
  seedPolicyVersion: 2,
  seedMode: 'unused',
  extraInputs: { extra_params: { seed: 99 } },
} as any), /dedicated Seed strategy/i);

const cliShapeModel = normalizeAionModelConfig(camelCaseVideoModel);
assert.equal(cliShapeModel.displayName, camelCaseVideoModel.displayName);
assert.equal(cliShapeModel.outputModality, 'video');
assert.deepEqual(getSupportedGenerationImageRoles(cliShapeModel), ['reference', 'start']);
assert.equal(cliShapeModel.controls.find(item => item.key === 'resolution')?.defaultValue, '1080p');
assert.deepEqual(cliShapeModel.inputSchema?.required_inputs, camelCaseVideoModel.options.required_params);
const hailuoH3Model = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'minimax/hailuo-h3',
  options: {
    ...camelCaseVideoModel.options,
    duration_options: Array.from({ length: 12 }, (_, index) => index + 4),
    supported_params: ['prompt', 'duration', 'elements', 'audios'],
  },
});
assert.deepEqual(getGenerationReferenceVideoSupport(hailuoH3Model), {
  supported: true,
  strategy: 'elements',
  field: 'elements',
  min: 0,
  max: 3,
  source: 'hailuo_h3_contract',
});
const h3VideoInputs = compileGenerationReferenceVideoInputs(hailuoH3Model, [
  'https://assets.example.com/reference-a.mp4',
  'https://assets.example.com/reference-b.mp4',
]);
assert.equal(h3VideoInputs.generationType, 'reference_to_video');
assert.deepEqual(h3VideoInputs.extraInputs.elements, [
  { video_url: 'https://assets.example.com/reference-a.mp4' },
  { video_url: 'https://assets.example.com/reference-b.mp4' },
]);
assert.deepEqual(h3VideoInputs.issues, []);
const h3ReferenceCase = preflightGenerationCase(hailuoH3Model, {
  caseId: 'case-h3-reference-video',
  datasetItemId: 'item-h3-reference-video',
  rowIndex: 8,
  prompt: 'Follow the reference video.',
  imageUrls: [],
  audioUrls: [],
  videoUrls: h3VideoInputs.videoUrls,
  controls: { duration: 9, resolution: '1080p' },
  extraInputs: h3VideoInputs.extraInputs,
  generationType: h3VideoInputs.generationType,
});
assert.equal(h3ReferenceCase.valid, true);
const h3ReferenceRequest = buildAionGenerationRequest(hailuoH3Model, h3ReferenceCase.resolvedCase);
assert.equal(h3ReferenceRequest.body.generation_type, 'reference_to_video');
assert.deepEqual(h3ReferenceRequest.body.elements, h3VideoInputs.extraInputs.elements);
assert.equal(h3ReferenceRequest.body.duration, 9);
const h3RequiredControlModel = {
  ...hailuoH3Model,
  inputSchema: {
    ...(hailuoH3Model.inputSchema || {}),
    required_inputs: {
      reference_to_video: ['prompt', 'elements', 'duration', 'resolution'],
    },
  },
};
assert.equal(preflightGenerationCase(
  h3RequiredControlModel,
  h3ReferenceCase.resolvedCase,
).valid, true, 'required model inputs must include resolved standard controls');

const keyframeVideoConflict = preflightGenerationCase(hailuoH3Model, {
  ...h3ReferenceCase.resolvedCase,
  caseId: 'case-keyframe-video-conflict',
  imageUrls: ['https://assets.example.com/start.png'],
  generationType: 'image_to_video',
});
assert.ok(keyframeVideoConflict.errors.some(issue => issue.code === 'CONFLICTING_VIDEO_AND_KEYFRAMES'));
assert.ok(compileGenerationReferenceVideoInputs(hailuoH3Model, [
  'https://assets.example.com/1.mp4',
  'https://assets.example.com/2.mp4',
  'https://assets.example.com/3.mp4',
  'https://assets.example.com/4.mp4',
]).issues.some(issue => issue.code === 'REFERENCE_VIDEO_COUNT_OUT_OF_RANGE'));

const wanVideoModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'wan2.7-video',
  options: {
    ...camelCaseVideoModel.options,
    duration_options: Array.from({ length: 14 }, (_, index) => index + 2),
    ref2video_duration_options: Array.from({ length: 9 }, (_, index) => index + 2),
    supported_params: ['prompt', 'duration', 'video_url', 'reference_video_urls', 'elements'],
  },
});
assert.equal(getGenerationReferenceVideoSupport(wanVideoModel).strategy, 'array_field');
assert.equal(getGenerationReferenceVideoSupport(wanVideoModel).field, 'reference_video_urls');
const wanReferenceInputs = compileGenerationReferenceVideoInputs(
  wanVideoModel,
  ['https://assets.example.com/reference.mp4'],
);
assert.deepEqual(wanReferenceInputs.extraInputs, {
  reference_video_urls: ['https://assets.example.com/reference.mp4'],
});
const wanReferenceRequest = buildAionGenerationRequest(wanVideoModel, {
  caseId: 'case-wan-reference-video',
  datasetItemId: 'item-wan-reference-video',
  rowIndex: 9,
  prompt: 'Follow this motion.',
  imageUrls: [],
  audioUrls: [],
  videoUrls: wanReferenceInputs.videoUrls,
  controls: { duration: 10 },
  extraInputs: wanReferenceInputs.extraInputs,
  generationType: 'reference_to_video',
});
assert.deepEqual(wanReferenceRequest.body.reference_video_urls, [
  'https://assets.example.com/reference.mp4',
]);
assert.equal(resolveReferenceAudioDuration(wanVideoModel, 10.2, 'reference_to_video').valid, false);
assert.equal(resolveReferenceAudioDuration(wanVideoModel, 10.2, 'text_to_video').resolvedDuration, 11);

const singleVideoModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'single-video-model',
  options: {
    ...camelCaseVideoModel.options,
    supported_params: ['prompt', 'duration', 'video_url'],
  },
});
assert.equal(getGenerationReferenceVideoSupport(singleVideoModel).strategy, 'single_field');
assert.ok(compileGenerationReferenceVideoInputs(singleVideoModel, [
  'https://assets.example.com/one.mp4',
  'https://assets.example.com/two.mp4',
]).issues.some(issue => issue.code === 'REFERENCE_VIDEO_COUNT_OUT_OF_RANGE'));

const uncertainElementsModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'uncertain-elements-model',
  options: {
    ...camelCaseVideoModel.options,
    supported_params: ['prompt', 'duration', 'elements'],
  },
});
assert.equal(getGenerationReferenceVideoSupport(uncertainElementsModel).supported, false);
assert.ok(compileGenerationReferenceVideoInputs(uncertainElementsModel, [
  'https://assets.example.com/reference.mp4',
]).issues.some(issue => issue.code === 'REFERENCE_VIDEO_NOT_SUPPORTED'));
assert.ok(compileGenerationReferenceVideoInputs(hailuoH3Model, [
  'https://assets.example.com/reference.mp4',
], [{ video_url: 'https://assets.example.com/raw.mp4' }]).issues.some(
  issue => issue.code === 'CONFLICTING_REFERENCE_VIDEO_INPUTS',
));

const discreteAudioDuration = resolveReferenceAudioDuration(hailuoH3Model, 8.515917);
assert.equal(discreteAudioDuration.valid, true);
assert.equal(discreteAudioDuration.resolvedDuration, 9);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 5.1).resolvedDuration, 5);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 5.2).resolvedDuration, 6);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 15.16).valid, false);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 3.8).valid, false);

const continuousDurationModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'continuous-duration-model',
  options: {
    supported_params: ['prompt', 'duration'],
    parameter_schema: {
      properties: {
        duration: { type: 'number', minimum: 2, maximum: 20 },
      },
    },
  },
});
assert.equal(resolveReferenceAudioDuration(continuousDurationModel, 8.515917).resolvedDuration, 8.516);

let probeCalls = 0;
const audioProbeCache = new Map<string, number>();
const probedAudio = await probeAudioDurations([
  'https://assets.example.com/audio.mp3',
  'https://assets.example.com/audio.mp3',
], {
  cache: audioProbeCache,
  concurrency: 2,
  timeoutMs: 100,
  probe: async () => {
    probeCalls += 1;
    return 8.515917;
  },
});
assert.equal(probeCalls, 1);
assert.equal(probedAudio['https://assets.example.com/audio.mp3'].seconds, 8.515917);
await probeAudioDurations(['https://assets.example.com/audio.mp3'], {
  cache: audioProbeCache,
  probe: async () => {
    probeCalls += 1;
    return 9;
  },
});
assert.equal(probeCalls, 1, 'successful metadata probes should be cached by URL');
const timedOutAudio = await probeAudioDurations(['https://assets.example.com/timeout.mp3'], {
  timeoutMs: 5,
  probe: async () => new Promise<number>(() => undefined),
});
assert.match(timedOutAudio['https://assets.example.com/timeout.mp3'].error || '', /timed out/i);
const serviceDataset = {
  id: 'dataset-duration-service',
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'duration-item-1',
      case_id: 'duration-case-1',
      prompt: 'Use the reference media.',
      audio: 'https://assets.example.com/audio.mp3',
      video: 'https://assets.example.com/reference.mp4',
      duration_column: '11',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'duration-item-2',
      case_id: 'duration-case-2',
      prompt: 'Invalid multiple audio case.',
      audio: 'https://assets.example.com/one.mp3;https://assets.example.com/two.mp3',
      video: 'https://assets.example.com/reference-2.mp4',
      duration_column: '',
    },
  ],
} as any;
const serviceSelection = serviceDataset.items.map((row: Record<string, unknown>, rowIndex: number) => ({
  row,
  rowIndex,
  datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
}));
const audioFollowingCases = buildGenerationCasesForPreflight(serviceDataset, {
  datasetId: serviceDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    promptColumn: 'prompt',
    referenceImageColumns: [],
    referenceAudioColumns: ['audio'],
    referenceVideoColumns: ['video'],
    extraInputColumns: [],
  },
  defaultControls: { resolution: '1080p' },
  perCaseControlColumns: {},
  durationSource: {
    mode: 'reference_audio',
    referenceAudio: {
      'duration-item-1': {
        audioUrl: 'https://assets.example.com/audio.mp3',
        detectedSeconds: 8.515917,
        resolvedDuration: 9,
      },
    },
  },
}, hailuoH3Model, serviceSelection);
assert.equal(audioFollowingCases[0].resolvedCase.controls.duration, 9);
assert.equal(audioFollowingCases[0].resolvedCase.durationResolution?.detectedSeconds, 8.516);
assert.equal(audioFollowingCases[0].resolvedCase.durationResolution?.resolvedDuration, 9);
assert.equal(audioFollowingCases[0].resolvedCase.generationType, 'reference_to_video');
assert.deepEqual(audioFollowingCases[0].resolvedCase.extraInputs?.elements, [
  { video_url: 'https://assets.example.com/reference.mp4' },
]);
assert.deepEqual(audioFollowingCases[0].preparationIssues, []);
assert.ok(audioFollowingCases[1].preparationIssues.some(
  issue => issue.code === 'MULTIPLE_REFERENCE_AUDIOS',
));

const durationColumnCases = buildGenerationCasesForPreflight(serviceDataset, {
  datasetId: serviceDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    promptColumn: 'prompt',
    referenceImageColumns: [],
    referenceAudioColumns: [],
    referenceVideoColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { resolution: '1080p' },
  perCaseControlColumns: {},
  durationSource: { mode: 'column', column: 'duration_column' },
}, hailuoH3Model, serviceSelection);
assert.equal(durationColumnCases[0].resolvedCase.controls.duration, 11);
assert.equal(durationColumnCases[0].resolvedCase.durationResolution?.source, 'column');
assert.ok(durationColumnCases[1].preparationIssues.some(
  issue => issue.code === 'MISSING_DURATION_COLUMN_VALUE',
));
const mcpDataset = {
  id: 'dataset-mcp-contract',
  items: [{
    [DATASET_ITEM_ID_KEY]: 'mcp-item-1',
    case_id: 'mcp-case-1',
    prompt_json: 'Use @Element1 and @audio1.',
    elements_json: '[{"frontal_image_url":"https://assets.example.com/subject.png"}]',
    audios_json: '[{"url":"https://assets.example.com/voice.mp3","range":[0,4]}]',
    duration_value: '4',
  }],
} as any;
const mcpCases = buildGenerationCasesForPreflight(mcpDataset, {
  datasetId: mcpDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    mappingMode: 'mcp',
    compatibilityMode: 'strict',
    canonicalFieldMappings: {
      prompt: 'prompt_json',
      elements: 'elements_json',
      audios: 'audios_json',
      duration: 'duration_value',
    },
    referenceImageColumns: [],
    referenceAudioColumns: [],
    referenceVideoColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { resolution: '1080p' },
  perCaseControlColumns: {},
  durationSource: { mode: 'uniform' },
}, hailuoH3Model, [{
  row: mcpDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'mcp-item-1',
}]);
assert.deepEqual(mcpCases[0].preparationIssues, []);
assert.equal(mcpCases[0].resolvedCase.generationType, 'reference_to_video');
assert.deepEqual(mcpCases[0].resolvedCase.audioInputs, [
  { url: 'https://assets.example.com/voice.mp3', range: [0, 4] },
]);
assert.equal(mcpCases[0].resolvedCase.controls.duration, 4);
assert.equal(mcpCases[0].resolvedCase.compilerAudit?.profileId, 'hailuo-h3');
const mcpRequest = buildAionGenerationRequest(hailuoH3Model, {
  ...mcpCases[0].resolvedCase,
  generationType: mcpCases[0].resolvedCase.generationType || 'reference_to_video',
});
assert.deepEqual(mcpRequest.body.elements, [
  { frontal_image_url: 'https://assets.example.com/subject.png' },
]);
assert.deepEqual(mcpRequest.body.audios, [
  { url: 'https://assets.example.com/voice.mp3', range: [0, 4] },
]);
const v2IntentDataset = {
  id: 'dataset-mcp-v2-intent',
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'intent-reference',
      case_id: 'intent-reference',
      prompt: 'Keep @Element1 and @Element2 consistent.',
      first_frame: '',
      last_frame: '',
      reference_a: 'https://assets.example.com/reference-a.png',
      reference_b: 'https://assets.example.com/reference-b.png',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'intent-keyframes',
      case_id: 'intent-keyframes',
      prompt: 'Move from @Image1 to @Image2.',
      first_frame: 'https://assets.example.com/first.png',
      last_frame: 'https://assets.example.com/last.png',
      reference_a: '',
      reference_b: '',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'intent-conflict',
      case_id: 'intent-conflict',
      prompt: 'Conflicting media.',
      first_frame: 'https://assets.example.com/first.png',
      last_frame: '',
      reference_a: 'https://assets.example.com/reference.png',
      reference_b: '',
    },
  ],
} as any;
const v2IntentRequest = {
  datasetId: v2IntentDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    contentMappingVersion: 2 as const,
    contentMapping: {
      version: 2 as const,
      prompt: { column: 'prompt', format: 'text' as const },
      keyframes: {
        source: 'columns' as const,
        firstColumn: 'first_frame',
        lastColumn: 'last_frame',
      },
      elements: {
        source: 'builder' as const,
        items: [
          { id: 'reference-a', mode: 'image' as const, frontalImageColumn: 'reference_a' },
          { id: 'reference-b', mode: 'image' as const, frontalImageColumn: 'reference_b' },
        ],
      },
      audios: { source: 'unused' as const },
    },
  },
  defaultControls: { duration: 5 },
  perCaseControlColumns: {},
  durationSource: { mode: 'uniform' as const },
  seedMode: 'fixed' as const,
  fixedSeed: 7,
};
assert.doesNotThrow(() => validateGenerationContentMappingConfiguration(
  v2IntentRequest,
  hailuoH3Model,
  v2IntentDataset,
));
const v2IntentCases = buildGenerationCasesForPreflight(
  v2IntentDataset,
  v2IntentRequest,
  hailuoH3Model,
  v2IntentDataset.items.map((row: Record<string, unknown>, rowIndex: number) => ({
    row,
    rowIndex,
    datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
  })),
);
assert.equal(v2IntentCases[0].resolvedCase.generationType, 'reference_to_video');
assert.deepEqual(v2IntentCases[0].resolvedCase.imageUrls, []);
assert.deepEqual(v2IntentCases[0].resolvedCase.extraInputs?.elements, [
  { frontal_image_url: 'https://assets.example.com/reference-a.png' },
  { frontal_image_url: 'https://assets.example.com/reference-b.png' },
]);
assert.equal(v2IntentCases[1].resolvedCase.generationType, 'images_to_video');
assert.equal(v2IntentCases[1].resolvedCase.compilerAudit?.effectiveGenerationType, undefined);
assert.equal(v2IntentCases[1].resolvedCase.compilerAudit?.profileId, undefined);
assert.deepEqual(v2IntentCases[1].resolvedCase.imageUrls, [
  'https://assets.example.com/first.png',
  'https://assets.example.com/last.png',
]);
assert.deepEqual(v2IntentCases[1].resolvedCase.extraInputs?.elements, []);
assert.equal(v2IntentCases[2].resolvedCase.generationType, 'manual_review');
assert.ok(v2IntentCases[2].preparationIssues.some(issue => issue.code === 'CONTRACT_REVIEW_REQUIRED'));
assert.ok(v2IntentCases[2].resolvedCase.compilerAudit?.contractFindings?.some(
  finding => finding.id === 'plugin-mixed-keyframes-to-elements',
));
assert.equal(v2IntentCases[0].resolvedCase.compilerAudit?.intent?.mappingVersion, 2);

const caseOverrideCases = buildGenerationCasesForPreflight(
  v2IntentDataset,
  {
    ...v2IntentRequest,
    caseReviews: {
      'intent-keyframes': {
        inputOverride: {
          version: 1,
          content: {
            prompt: { action: 'set', value: 'Keep @Element1 and @Element2 consistent.' },
            image_urls: { action: 'omit' },
            elements: {
              action: 'set',
              value: [
                { frontal_image_url: 'https://assets.example.com/reference-a.png' },
                { frontal_image_url: 'https://assets.example.com/reference-b.png' },
              ],
            },
          },
          parameters: {
            duration: { action: 'set', value: 8 },
          },
        },
      },
    },
  },
  hailuoH3Model,
  [{ row: v2IntentDataset.items[1], rowIndex: 1, datasetItemId: 'intent-keyframes' }],
);
assert.equal(caseOverrideCases[0].resolvedCase.generationType, 'reference_to_video');
assert.deepEqual(caseOverrideCases[0].resolvedCase.imageUrls, []);
assert.deepEqual(caseOverrideCases[0].resolvedCase.extraInputs?.elements, [
  { frontal_image_url: 'https://assets.example.com/reference-a.png' },
  { frontal_image_url: 'https://assets.example.com/reference-b.png' },
]);
assert.equal(caseOverrideCases[0].resolvedCase.prompt, 'Keep @Element1 and @Element2 consistent.');
assert.equal(caseOverrideCases[0].resolvedCase.controls.duration, 8);
assert.equal(caseOverrideCases[0].resolvedCase.durationResolution?.source, 'case_override');
assert.deepEqual(caseOverrideCases[0].resolvedCase.compilerAudit?.caseInputOverride?.appliedContentFields, [
  'prompt',
  'image_urls',
  'elements',
]);
assert.deepEqual(caseOverrideCases[0].preparationIssues, []);

const promptColumnDataset = {
  id: 'dataset-prompt-column-override',
  columnMappings: {
    inputColumns: ['prompt', 'prompt_zh'],
    outputColumns: ['legacy_result'],
    dimensionColumns: [],
    referenceColumns: ['legacy_media'],
    standard: {},
  },
  inputSchema: [
    { key: 'case_id', label: 'Case ID', type: 'text', role: 'case_id' },
    { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
    { key: 'prompt_zh', label: 'Prompt 中文', type: 'text', role: 'input' },
    { key: 'result', label: 'Result', type: 'video_url', role: 'output' },
  ],
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'prompt-source-a',
      case_id: 'prompt-source-a',
      prompt: 'A very long English prompt.',
      prompt_zh: '中文甲',
      legacy_result: 'https://example.com/old-result.mp4',
      legacy_media: 'https://example.com/reference.png',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'prompt-source-b',
      case_id: 'prompt-source-b',
      prompt: 'Another long English prompt.',
      prompt_zh: '中文乙',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'prompt-source-empty',
      case_id: 'prompt-source-empty',
      prompt: 'English fallback must not be used.',
      prompt_zh: '',
    },
  ],
} as any;
const promptColumnRequest = {
  ...v2IntentRequest,
  datasetId: promptColumnDataset.id,
  caseReviews: Object.fromEntries(promptColumnDataset.items.map((row: Record<string, unknown>) => [
    String(row[DATASET_ITEM_ID_KEY]),
    { promptColumnOverride: { version: 1 as const, column: 'prompt_zh' } },
  ])),
};
assert.doesNotThrow(() => validateExpectedGenerationConfigFingerprint(undefined, 'config-new'));
assert.doesNotThrow(() => validateExpectedGenerationConfigFingerprint('config-same', 'config-same'));
assert.throws(
  () => validateExpectedGenerationConfigFingerprint('config-old', 'config-new'),
  /live model configuration changed/i,
);

assert.doesNotThrow(() => validateGenerationPromptColumnOverrides(
  promptColumnRequest,
  promptColumnDataset,
  promptColumnDataset.items.map((row: Record<string, unknown>, rowIndex: number) => ({
    row,
    rowIndex,
    datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
  })),
));
assert.throws(() => validateGenerationPromptColumnOverrides({
  ...promptColumnRequest,
  caseReviews: {
    'prompt-source-a': { promptColumnOverride: { version: 1, column: 'case_id' } },
  },
}, promptColumnDataset, [{
  row: promptColumnDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'prompt-source-a',
}]), /visible non-output text column/i);
assert.throws(() => validateGenerationPromptColumnOverrides({
  ...promptColumnRequest,
  caseReviews: {
    'prompt-source-a': { promptColumnOverride: { version: 1, column: 'result' } },
  },
}, promptColumnDataset, [{
  row: promptColumnDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'prompt-source-a',
}]), /visible non-output text column/i);
assert.throws(() => validateGenerationPromptColumnOverrides({
  ...promptColumnRequest,
  caseReviews: {
    'prompt-source-a': { promptColumnOverride: { version: 1, column: 'legacy_media' } },
  },
}, promptColumnDataset, [{
  row: promptColumnDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'prompt-source-a',
}]), /visible non-output text column/i);
assert.throws(() => validateGenerationPromptColumnOverrides({
  ...promptColumnRequest,
  caseReviews: {
    'prompt-source-a': { promptColumnOverride: { version: 1, column: 'legacy_result' } },
  },
}, promptColumnDataset, [{
  row: promptColumnDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'prompt-source-a',
}]), /visible non-output text column/i);
assert.throws(() => validateGenerationPromptColumnOverrides({
  ...promptColumnRequest,
  caseReviews: {
    'prompt-source-a': {
      promptColumnOverride: { version: 1, column: 'prompt_zh' },
      finalAionRequest: { prompt: 'expert' },
    },
  },
}, promptColumnDataset, [{
  row: promptColumnDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'prompt-source-a',
}]), /final Aion JSON/i);
const promptColumnCases = buildGenerationCasesForPreflight(
  promptColumnDataset,
  promptColumnRequest,
  hailuoH3Model,
  [
    { row: promptColumnDataset.items[1], rowIndex: 1, datasetItemId: 'prompt-source-b' },
    { row: promptColumnDataset.items[0], rowIndex: 0, datasetItemId: 'prompt-source-a' },
    { row: promptColumnDataset.items[2], rowIndex: 2, datasetItemId: 'prompt-source-empty' },
  ],
);
assert.equal(promptColumnCases[0].resolvedCase.prompt, '中文乙');
assert.equal(promptColumnCases[1].resolvedCase.prompt, '中文甲');
assert.equal(promptColumnCases[2].resolvedCase.prompt, undefined,
  'an empty alternate Prompt must not fall back to the primary Prompt');
assert.deepEqual(promptColumnCases[0].resolvedCase.compilerAudit?.promptColumnOverride, {
  version: 1,
  column: 'prompt_zh',
  rawValue: '中文乙',
});
assert.equal(promptColumnCases[0].resolvedCase.compilerAudit?.originalInput?.prompt,
  'Another long English prompt.');
const emptyPromptColumnPreflight = preflightGenerationCase(
  hailuoH3Model,
  promptColumnCases[2].resolvedCase,
);
assert.ok(emptyPromptColumnPreflight.errors.some(issue => issue.code === 'MISSING_REQUIRED_INPUT'));

const promptColumnMultiDataset = {
  id: 'dataset-prompt-column-multi',
  inputSchema: [
    { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
    { key: 'prompt_zh', label: 'Prompt 中文', type: 'text', role: 'input' },
  ],
  items: [{
    [DATASET_ITEM_ID_KEY]: 'prompt-multi-a',
    case_id: 'prompt-multi-a',
    prompt: '[{"prompt":"English shot","duration":2.5}]',
    prompt_zh: '[{"prompt":"中文镜头😀","duration":2.5}]',
  }],
} as any;
const promptColumnMultiCase = buildGenerationCasesForPreflight(
  promptColumnMultiDataset,
  {
    ...v2IntentRequest,
    datasetId: promptColumnMultiDataset.id,
    inputMapping: {
      ...v2IntentRequest.inputMapping,
      contentMapping: {
        ...v2IntentRequest.inputMapping.contentMapping,
        prompt: { column: 'prompt', format: 'multi_prompt_json' as const },
      },
    },
    caseReviews: {
      'prompt-multi-a': { promptColumnOverride: { version: 1, column: 'prompt_zh' } },
    },
  },
  hailuoH3Model,
  [{ row: promptColumnMultiDataset.items[0], rowIndex: 0, datasetItemId: 'prompt-multi-a' }],
)[0];
assert.deepEqual(promptColumnMultiCase.resolvedCase.prompt, [
  { prompt: '中文镜头😀', duration: 2.5 },
]);
assert.deepEqual(promptColumnMultiCase.preparationIssues, []);

const promptChannelDataset = {
  ...v2IntentDataset,
  items: [{
    ...v2IntentDataset.items[0],
    prompt: 'Keep @image1 and @image2 consistent.',
  }],
} as any;
const acceptedPromptRewriteCase = buildGenerationCasesForPreflight(
  promptChannelDataset,
  {
    ...v2IntentRequest,
    caseReviews: {
      'intent-reference': { acceptedFindingIds: ['plugin-prompt-image-to-element'] },
    },
  },
  hailuoH3Model,
  [{ row: promptChannelDataset.items[0], rowIndex: 0, datasetItemId: 'intent-reference' }],
)[0];
assert.equal(acceptedPromptRewriteCase.resolvedCase.prompt, 'Keep @Element1 and @Element2 consistent.');
assert.ok(!acceptedPromptRewriteCase.preparationIssues.some(issue => [
  'CONTRACT_REVIEW_REQUIRED',
  'PROMPT_REFERENCE_OUT_OF_RANGE',
].includes(issue.code)));
assert.ok(!acceptedPromptRewriteCase.preparationWarnings.some(
  issue => issue.code === 'UNREFERENCED_PROMPT_ASSET',
));

const conflictingReviewCase = buildGenerationCasesForPreflight(
  v2IntentDataset,
  {
    ...v2IntentRequest,
    caseReviews: {
      'intent-keyframes': {
        inputOverride: {
          version: 1,
          content: { prompt: { action: 'set', value: 'Reviewed Prompt' } },
        },
        finalAionRequest: {
          model_name: hailuoH3Model.modelName,
          generation_type: 'images_to_video',
          prompt: 'Manual Prompt',
          image_urls: [
            'https://assets.example.com/first.png',
            'https://assets.example.com/last.png',
          ],
        },
      },
    },
  },
  hailuoH3Model,
  [{ row: v2IntentDataset.items[1], rowIndex: 1, datasetItemId: 'intent-keyframes' }],
)[0];
assert.ok(conflictingReviewCase.preparationIssues.some(
  issue => issue.code === 'CONFLICTING_CASE_REVIEW_MODES',
));

const v2StructuredDataset = {
  id: 'dataset-mcp-v2-structured',
  items: [{
    [DATASET_ITEM_ID_KEY]: 'structured-1',
    case_id: 'structured-1',
    prompt: '[Scene 1] Keep this literal.',
    frontal: 'https://assets.example.com/front.png',
    angle_a: 'https://assets.example.com/left.png',
    angle_b: 'https://assets.example.com/right.png',
    audio: 'https://assets.example.com/voice.mp3',
    range_start: '0.1234',
    range_end: '3.9876',
  }],
} as any;
const v2StructuredCases = buildGenerationCasesForPreflight(v2StructuredDataset, {
  datasetId: v2StructuredDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    contentMappingVersion: 2,
    contentMapping: {
      version: 2,
      prompt: { column: 'prompt', format: 'text' },
      keyframes: { source: 'unused' },
      elements: {
        source: 'builder',
        items: [{
          id: 'subject',
          mode: 'image',
          frontalImageColumn: 'frontal',
          referenceImageColumns: ['angle_a', 'angle_b'],
        }],
      },
      audios: {
        source: 'builder',
        items: [{
          id: 'voice',
          urlColumn: 'audio',
          rangeSource: 'columns',
          rangeStartColumn: 'range_start',
          rangeEndColumn: 'range_end',
        }],
      },
    },
  },
  defaultControls: { duration: 5 },
  perCaseControlColumns: {},
  durationSource: { mode: 'uniform' },
  seedMode: 'fixed',
  fixedSeed: 9,
}, hailuoH3Model, [{
  row: v2StructuredDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'structured-1',
}]);
assert.equal(v2StructuredCases[0].resolvedCase.prompt, '[Scene 1] Keep this literal.');
assert.deepEqual(v2StructuredCases[0].resolvedCase.extraInputs?.elements, [{
  frontal_image_url: 'https://assets.example.com/front.png',
  reference_image_urls: [
    'https://assets.example.com/left.png',
    'https://assets.example.com/right.png',
  ],
}]);
assert.deepEqual(v2StructuredCases[0].resolvedCase.audioInputs, [{
  url: 'https://assets.example.com/voice.mp3',
  range: [0.1234, 3.9876],
}]);



const parameterDataset = {
  id: 'dataset-parameter-bindings',
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'parameter-item-1',
      case_id: 'parameter-case-1',
      prompt: 'A paper boat crossing a quiet lake.',
      generate_audio_value: '\u662f',
      adapter_hint_value: '{"mode":"cinematic"}',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'parameter-item-2',
      case_id: 'parameter-case-2',
      prompt: 'A paper plane crossing a bright room.',
      generate_audio_value: 'maybe',
      adapter_hint_value: '',
    },
  ],
} as any;
const parameterSelection = parameterDataset.items.map((row: Record<string, unknown>, rowIndex: number) => ({
  row,
  rowIndex,
  datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
}));
const parameterRequest = {
  datasetId: parameterDataset.id,
  datasetVersion: 1,
  modelName: wanParameterModel.modelName,
  targetColumn: 'result',
  inputMapping: {
    mappingMode: 'mcp',
    canonicalFieldMappings: { prompt: 'prompt' },
    referenceImageColumns: [],
    referenceAudioColumns: [],
    referenceVideoColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { duration: 5 },
  perCaseControlColumns: {},
  durationSource: { mode: 'uniform' },
  seedMode: 'fixed',
  seedPolicyVersion: 2,
  fixedSeed: 17,
  parameterBindings: {
    generate_audio: { source: 'column', column: 'generate_audio_value' },
    watermark: { source: 'uniform', value: false },
    adapter_hint: { source: 'column', column: 'adapter_hint_value', valueType: 'json' },
  },
} as any;
validateGenerationParameterBindings(parameterRequest, wanParameterModel, parameterDataset);
const parameterCases = buildGenerationCasesForPreflight(
  parameterDataset,
  parameterRequest,
  wanParameterModel,
  parameterSelection,
);
const parameterColumnDataset = {
  id: 'dataset-parameter-column-overrides',
  inputSchema: [
    { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
    { key: 'resolution_backup', label: 'Resolution backup', type: 'text', role: 'input' },
  ],
  items: [{
    [DATASET_ITEM_ID_KEY]: 'parameter-column-a',
    case_id: 'parameter-column-a',
    prompt: 'A paper boat crossing a quiet lake.',
    resolution_backup: '720p',
  }],
} as any;
const parameterColumnRequest = {
  datasetId: parameterColumnDataset.id,
  datasetVersion: 1,
  modelName: videoModel.modelName,
  targetColumn: 'result',
  inputMapping: {
    mappingMode: 'mcp',
    canonicalFieldMappings: { prompt: 'prompt' },
    referenceImageColumns: [],
    referenceAudioColumns: [],
    referenceVideoColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { duration: 5 },
  perCaseControlColumns: {},
  durationSource: { mode: 'uniform' },
  seedMode: 'unused',
  seedPolicyVersion: 2,
  parameterBindings: {
    resolution: { source: 'uniform', value: '1080p' },
  },
  caseReviews: {
    'parameter-column-a': {
      parameterColumnOverrides: {
        resolution: { version: 1, column: 'resolution_backup' },
      },
    },
  },
} as any;
const parameterColumnSelection = [{
  row: parameterColumnDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'parameter-column-a',
}];
assert.doesNotThrow(() => validateGenerationParameterColumnOverrides(
  parameterColumnRequest,
  videoModel,
  parameterColumnDataset,
  parameterColumnSelection,
));
const parameterColumnCase = buildGenerationCasesForPreflight(
  parameterColumnDataset,
  parameterColumnRequest,
  videoModel,
  parameterColumnSelection,
)[0];
assert.equal(parameterColumnCase.resolvedCase.controls.resolution, '720p');
assert.deepEqual(parameterColumnCase.resolvedCase.parameterAudit?.resolution, {
  source: 'case_column_override',
  column: 'resolution_backup',
  rawValue: '720p',
  value: '720p',
  verified: true,
  destination: 'control',
});
assert.deepEqual(parameterColumnCase.resolvedCase.compilerAudit?.parameterColumnOverrides, {
  resolution: { version: 1, column: 'resolution_backup', rawValue: '720p' },
});
assert.throws(() => validateGenerationParameterColumnOverrides({
  ...parameterColumnRequest,
  caseReviews: {
    'parameter-column-a': {
      parameterColumnOverrides: {
        resolution: { version: 1, column: 'resolution_backup' },
      },
      finalAionRequest: { prompt: 'expert' },
    },
  },
}, videoModel, parameterColumnDataset, parameterColumnSelection), /final Aion JSON/i);
const unusedSeedCase = buildGenerationCasesForPreflight(
  parameterDataset,
  {
    ...parameterRequest,
    seedMode: 'unused',
    fixedSeed: undefined,
    parameterBindings: {},
  },
  wanParameterModel,
  [parameterSelection[0]],
)[0];
assert.equal(unusedSeedCase.resolvedCase.seed, undefined);
assert.equal(unusedSeedCase.resolvedCase.seedPolicyVersion, 2);
const derivedSeedRequest = {
  ...parameterRequest,
  seedMode: 'derive_from_case',
  fixedSeed: undefined,
  parameterBindings: {},
};
const derivedSeed = buildGenerationCasesForPreflight(
  parameterDataset,
  derivedSeedRequest,
  wanParameterModel,
  [parameterSelection[0]],
)[0].resolvedCase.seed;
const promptChangedDataset = {
  ...parameterDataset,
  items: [{ ...parameterDataset.items[0], prompt: 'A completely revised prompt.' }],
};
const promptChangedSeed = buildGenerationCasesForPreflight(
  promptChangedDataset as any,
  { ...derivedSeedRequest, targetColumn: 'another_result' },
  { ...wanParameterModel, modelName: 'provider/another-seed-model' },
  [{ row: promptChangedDataset.items[0], rowIndex: 0, datasetItemId: 'parameter-item-1' }],
)[0].resolvedCase.seed;
assert.equal(promptChangedSeed, derivedSeed);
const fixedZeroSeedCase = buildGenerationCasesForPreflight(
  parameterDataset,
  { ...parameterRequest, fixedSeed: 0, parameterBindings: {} },
  wanParameterModel,
  [parameterSelection[0]],
)[0];
assert.equal(fixedZeroSeedCase.resolvedCase.seed, 0);
const emptySeedColumnCase = buildGenerationCasesForPreflight(
  parameterDataset,
  {
    ...parameterRequest,
    seedMode: 'column',
    fixedSeed: undefined,
    seedColumn: 'seed_value',
    parameterBindings: {},
  },
  wanParameterModel,
  [parameterSelection[0]],
)[0];
assert.ok(emptySeedColumnCase.preparationIssues.some(issue => issue.code === 'INVALID_SEED'));
const zeroSeedColumnRow = { ...parameterDataset.items[0], seed_value: 0 };
const zeroSeedColumnCase = buildGenerationCasesForPreflight(
  { ...parameterDataset, items: [zeroSeedColumnRow] } as any,
  {
    ...parameterRequest,
    seedMode: 'column',
    fixedSeed: undefined,
    seedColumn: 'seed_value',
    parameterBindings: {},
  },
  wanParameterModel,
  [{ row: zeroSeedColumnRow, rowIndex: 0, datasetItemId: 'parameter-item-1' }],
)[0];
assert.equal(zeroSeedColumnCase.resolvedCase.seed, 0);
assert.equal(zeroSeedColumnCase.preparationIssues.some(issue => issue.code === 'INVALID_SEED'), false);
assert.deepEqual(parameterCases[0].preparationIssues, []);
assert.equal(parameterCases[0].resolvedCase.controls.generate_audio, true);
assert.equal(parameterCases[0].resolvedCase.controls.watermark, false);
assert.deepEqual(parameterCases[0].resolvedCase.extraInputs?.extra_params, {
  adapter_hint: { mode: 'cinematic' },
});
assert.equal(parameterCases[0].resolvedCase.parameterAudit?.generate_audio.source, 'column');
assert.ok(parameterCases[0].preparationWarnings.some(
  issue => issue.code === 'UNVERIFIED_EXTRA_PARAMETER' && issue.field === 'adapter_hint',
));
assert.ok(parameterCases[1].preparationIssues.some(
  issue => issue.code === 'INVALID_PARAMETER_VALUE' && issue.field === 'generate_audio',
));
assert.ok(parameterCases[1].preparationIssues.some(
  issue => issue.code === 'MISSING_PARAMETER_COLUMN_VALUE' && issue.field === 'adapter_hint',
));
const parameterAionRequest = buildAionGenerationRequest(wanParameterModel, {
  ...parameterCases[0].resolvedCase,
  generationType: parameterCases[0].resolvedCase.generationType || 'text_to_video',
});
assert.equal(parameterAionRequest.body.generate_audio, true);
assert.equal(parameterAionRequest.body.watermark, false);
assert.equal(parameterAionRequest.body.extra_params.seed, 17);
assert.deepEqual(parameterAionRequest.body.extra_params.adapter_hint, { mode: 'cinematic' });
assert.throws(() => buildAionGenerationRequest(wanParameterModel, {
  ...parameterCases[0].resolvedCase,
  generationType: parameterCases[0].resolvedCase.generationType || 'text_to_video',
  extraInputs: {
    ...parameterCases[0].resolvedCase.extraInputs,
    extra_params: { seed: 99 },
  },
}), /dedicated Seed strategy/i);

const booleanVariants: Array<[unknown, boolean]> = [
  ['true', true], ['1', true], ['yes', true], ['on', true], ['enabled', true],
  ['\u662f', true], ['\u5f00', true], ['\u542f\u7528', true],
  ['false', false], ['0', false], ['no', false], ['off', false], ['disabled', false],
  ['\u5426', false], ['\u5173', false], ['\u7981\u7528', false],
];
const booleanDataset = {
  id: 'dataset-boolean-bindings',
  items: booleanVariants.map(([value], index) => ({
    [DATASET_ITEM_ID_KEY]: `boolean-item-${index}`,
    case_id: `boolean-case-${index}`,
    prompt: `Boolean parser case ${index}`,
    generate_audio_value: value,
  })),
} as any;
const booleanRequest = {
  ...parameterRequest,
  datasetId: booleanDataset.id,
  parameterBindings: {
    generate_audio: { source: 'column', column: 'generate_audio_value' },
  },
} as any;
validateGenerationParameterBindings(booleanRequest, wanParameterModel, booleanDataset);
const booleanCases = buildGenerationCasesForPreflight(
  booleanDataset,
  booleanRequest,
  wanParameterModel,
  booleanDataset.items.map((row: Record<string, unknown>, rowIndex: number) => ({
    row,
    rowIndex,
    datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
  })),
);
booleanCases.forEach((item, index) => {
  assert.deepEqual(item.preparationIssues, []);
  assert.equal(item.resolvedCase.controls.generate_audio, booleanVariants[index][1]);
});
const unusedAdvancedRequest = {
  ...parameterRequest,
  parameterBindings: { adapter_hint: { source: 'unused' } },
} as any;
validateGenerationParameterBindings(unusedAdvancedRequest, wanParameterModel, parameterDataset);
const unusedAdvancedCase = buildGenerationCasesForPreflight(
  parameterDataset,
  unusedAdvancedRequest,
  wanParameterModel,
  [parameterSelection[0]],
)[0];
const unusedAdvancedAionRequest = buildAionGenerationRequest(wanParameterModel, {
  ...unusedAdvancedCase.resolvedCase,
  generationType: unusedAdvancedCase.resolvedCase.generationType || 'text_to_video',
});
assert.equal(unusedAdvancedAionRequest.body.extra_params.adapter_hint, undefined);
assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  parameterBindings: { seed: { source: 'uniform', value: 99 } },
} as any, wanParameterModel, parameterDataset), /dedicated Seed strategy/);
assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  parameterBindings: { multi_shots: { source: 'uniform', value: true } },
} as any, wanParameterModel, parameterDataset), /prompt.*duration/);
assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  inputMapping: {
    ...parameterRequest.inputMapping,
    canonicalFieldMappings: { prompt: 'prompt', reference_image_urls: 'adapter_hint_value' },
  },
  parameterBindings: {},
} as any, videoModel, parameterDataset), /elements\[\]\.reference_image_urls/);
assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  parameterBindings: {
    reference_image_urls: { source: 'column', column: 'adapter_hint_value', valueType: 'json' },
  },
} as any, wanParameterModel, parameterDataset), /elements\[\]\.reference_image_urls/);
assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  inputMapping: {
    ...parameterRequest.inputMapping,
    canonicalFieldMappings: {
      prompt: 'prompt',
      generate_audio: 'generate_audio_value',
    },
  },
} as any, wanParameterModel, parameterDataset), /generation parameter mapping/i);

assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  inputMapping: {
    ...parameterRequest.inputMapping,
    extraInputMappings: { adapter_hint: 'adapter_hint_value' },
  },
} as any, wanParameterModel, parameterDataset), /explicit parameterBindings/i);
assert.throws(() => validateGenerationParameterBindings({
  ...parameterRequest,
  inputMapping: {
    ...parameterRequest.inputMapping,
    extraInputColumns: ['multi_shots'],
  },
  parameterBindings: {},
} as any, wanParameterModel, parameterDataset), /prompt.*duration/);
assert.throws(() => validateDurationSourceConfiguration({
  datasetId: serviceDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    referenceImageColumns: [],
    referenceAudioColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { duration: 9 },
  perCaseControlColumns: { duration: 'duration_column' },
  durationSource: { mode: 'uniform' },
}, hailuoH3Model), /Uniform duration cannot be combined/);


const cliShapeCase = preflightGenerationCase(cliShapeModel, {
  caseId: 'case-cli-shape',
  datasetItemId: 'item-cli-shape',
  rowIndex: 5,
  prompt: 'Animate the reference.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: [],
  controls: { duration: 5, resolution: '1080p' },
});
assert.equal(cliShapeCase.valid, true);
const cliShapeCost = estimateGenerationCost(cliShapeModel, [cliShapeCase.resolvedCase]);
assert.equal(cliShapeCost.known, true);
assert.equal(cliShapeCost.totalCredits, 400);
assert.equal(cliShapeCost.unitLabel, 'second (upper rate)');

const audioArrayCase = preflightGenerationCase(cliShapeModel, {
  caseId: 'case-audio-array',
  datasetItemId: 'item-audio-array',
  rowIndex: 6,
  prompt: 'Animate with the reference audio.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: ['https://assets.example.com/voice.wav'],
  controls: { duration: 5, resolution: '1080p' },
});
assert.equal(audioArrayCase.valid, true);
const audioArrayRequest = buildAionGenerationRequest(cliShapeModel, audioArrayCase.resolvedCase);
assert.deepEqual(audioArrayRequest.body.audios, [{ url: 'https://assets.example.com/voice.wav' }]);
assert.equal(audioArrayRequest.body.audio_url, undefined);

const audioUrlOnlyModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'provider/audio-url-only',
  options: {
    ...camelCaseVideoModel.options,
    supportedParams: ['prompt', 'image_urls', 'audio_url', 'duration', 'resolution'],
  },
});
const rangedAudioCase = preflightGenerationCase(audioUrlOnlyModel, {
  caseId: 'case-ranged-audio',
  datasetItemId: 'item-ranged-audio',
  rowIndex: 7,
  prompt: 'Animate with a selected audio range.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: ['https://assets.example.com/voice.wav'],
  audioInputs: [{
    url: 'https://assets.example.com/voice.wav',
    range: [1, 4],
  }],
  controls: { duration: 5, resolution: '1080p' },
});
assert.equal(rangedAudioCase.valid, false);
assert.ok(rangedAudioCase.errors.some(item =>
  item.code === 'AUDIO_RANGE_REQUIRES_AUDIOS'));

const v3AudioContractCase = preflightGenerationCase(audioUrlOnlyModel, {
  caseId: 'case-v3-audio-contract',
  datasetItemId: 'item-v3-audio-contract',
  rowIndex: 8,
  prompt: 'Use the reference audio.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: ['https://assets.example.com/voice.wav'],
  audioInputs: [{ url: 'https://assets.example.com/voice.wav' }],
  controls: { duration: 5, resolution: '1080p' },
  generationType: 'image_to_video',
  compilerAudit: {
    compilerVersion: '3',
    compatibilityApplied: false,
    originalInput: {},
    compiledInput: {},
    bindings: { images: [], elements: [], audios: [] },
  },
});
assert.ok(v3AudioContractCase.errors.some(item =>
  item.code === 'UNSUPPORTED_INPUT' && item.field === 'audios'));
const v3AudioContractRequest = buildAionGenerationRequest(
  audioUrlOnlyModel,
  v3AudioContractCase.resolvedCase,
);
assert.deepEqual(v3AudioContractRequest.body.audios, [{ url: 'https://assets.example.com/voice.wav' }]);
assert.equal(v3AudioContractRequest.body.audio_url, undefined);

const multipleAudioUrlCase = preflightGenerationCase(audioUrlOnlyModel, {
  ...rangedAudioCase.resolvedCase,
  caseId: 'case-multiple-audio-url',
  datasetItemId: 'item-multiple-audio-url',
  audioUrls: ['https://assets.example.com/one.wav', 'https://assets.example.com/two.wav'],
  audioInputs: [],
});
assert.equal(multipleAudioUrlCase.valid, false);
assert.ok(multipleAudioUrlCase.errors.some(item =>
  item.code === 'MULTIPLE_AUDIOS_REQUIRE_AUDIOS'));

const tooManyAudios = preflightGenerationCase(cliShapeModel, {
  ...audioArrayCase.resolvedCase,
  caseId: 'case-too-many-audios',
  datasetItemId: 'item-too-many-audios',
  audioUrls: ['https://assets.example.com/one.wav', 'https://assets.example.com/two.wav'],
});
assert.equal(tooManyAudios.valid, false);
assert.ok(tooManyAudios.errors.some(item => item.code === 'INPUT_COUNT_OUT_OF_RANGE'));

const unsupportedExtraInputCase = preflightGenerationCase(audioUrlOnlyModel, {
  ...rangedAudioCase.resolvedCase,
  caseId: 'case-unsupported-extra-input',
  audioInputs: undefined,
  extraInputs: { custom_provider_field: 'value' },
});
assert.ok(unsupportedExtraInputCase.errors.some(item =>
  item.code === 'UNSUPPORTED_INPUT' && item.field === 'custom_provider_field'));

const mcpImageModel = normalizeAionModelConfig({
  name: 'provider/mcp-image-model',
  displayName: 'MCP image model',
  type: 'image',
  provider: 'provider',
  capabilities: { image2image: true },
  options: {
    supported_params: ['prompt', 'images'],
    required_params: { image_to_image: ['images'] },
  },
  priceItems: [{ unit: 'image', credits: 1 }],
});
const mcpImageCase = preflightGenerationCase(mcpImageModel, {
  caseId: 'case-mcp-image',
  datasetItemId: 'item-mcp-image',
  rowIndex: 8,
  prompt: 'Restyle @image1.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: [],
  controls: {},
});
assert.equal(mcpImageCase.valid, true);
const mcpImageRequest = buildAionGenerationRequest(mcpImageModel, mcpImageCase.resolvedCase);
assert.deepEqual(mcpImageRequest.body.image_urls, ['https://assets.example.com/reference.png']);

const validTextCase = preflightGenerationCase(videoModel, {
  caseId: 'case-1',
  datasetItemId: 'item-1',
  rowIndex: 0,
  prompt: 'A runner crosses the finish line.',
  imageUrls: [],
  audioUrls: [],
  controls: {
    duration: 5,
    aspect_ratio: '16:9',
    resolution: '720p',
  },
});
assert.equal(validTextCase.valid, true);
assert.equal(validTextCase.generationType, 'text_to_video');

const promptTooLongCase = preflightGenerationCase(videoModel, {
  ...validTextCase.resolvedCase,
  caseId: 'case-prompt-too-long',
  datasetItemId: 'item-prompt-too-long',
  prompt: '123456',
}, { promptMaxLength: 5 });
assert.equal(promptTooLongCase.valid, false);
assert.ok(promptTooLongCase.errors.some(item => (
  item.code === 'PROMPT_TOO_LONG' && item.field === 'prompt'
)));
const promptTooLongIssue = promptTooLongCase.errors.find(item => item.code === 'PROMPT_TOO_LONG');
assert.deepEqual(promptTooLongIssue?.promptLength, {
  measuredLength: 6,
  maximumLength: 5,
  unit: 'unicode_code_points',
  scope: 'string',
  source: 'manueval_compatibility',
});
const promptTooLongPresentation = getGenerationIssuePresentation(promptTooLongIssue as any, 'error');
assert.match(promptTooLongPresentation.description, /6 \/ 5 Unicode/);
assert.match(promptTooLongPresentation.description, /不是单词数或 Token 数/);

const structuredPromptModel = {
  ...videoModel,
  inputSchema: {
    ...videoModel.inputSchema,
    properties: { prompt: { type: 'string', maxLength: 5 } },
  },
};
assert.deepEqual(generationValidationForModel(structuredPromptModel, {
  [videoModel.modelName]: { promptMaxLength: 10 },
}), {
  promptLength: {
    unit: 'unicode_code_points',
    string: { maxLength: 5, source: 'aion_input_schema' },
  },
});

const unionPromptModel = {
  ...videoModel,
  inputSchema: {
    ...videoModel.inputSchema,
    properties: {
      prompt: {
        oneOf: [
          { type: 'string', maxLength: 8 },
          {
            type: 'array',
            items: {
              type: 'object',
              properties: { prompt: { type: 'string', maxLength: 4 } },
            },
          },
        ],
      },
    },
  },
};
assert.deepEqual(generationValidationForModel(unionPromptModel, {}), {
  promptLength: {
    unit: 'unicode_code_points',
    string: { maxLength: 8, source: 'aion_input_schema' },
    array: { scope: 'array_item', maxLength: 4, source: 'aion_input_schema' },
  },
});
const anyOfPromptModel = {
  ...videoModel,
  inputSchema: {
    ...videoModel.inputSchema,
    properties: {
      prompt: {
        anyOf: [
          { type: 'string', maxLength: 12 },
          {
            type: 'array',
            items: {
              anyOf: [{
                type: 'object',
                properties: { prompt: { type: 'string', maxLength: 6 } },
              }],
            },
          },
        ],
      },
    },
  },
};
assert.deepEqual(generationValidationForModel(anyOfPromptModel, {}), {
  promptLength: {
    unit: 'unicode_code_points',
    string: { maxLength: 12, source: 'aion_input_schema' },
    array: { scope: 'array_item', maxLength: 6, source: 'aion_input_schema' },
  },
});
const parameterSchemaPromptModel = {
  ...videoModel,
  options: {
    ...videoModel.options,
    parameter_schema: {
      properties: { prompt: { type: 'string', maxLength: 7 } },
    },
    prompt_max_length: 20,
  },
};
assert.deepEqual(generationValidationForModel(parameterSchemaPromptModel, {}), {
  promptLength: {
    unit: 'unicode_code_points',
    string: { maxLength: 7, source: 'aion_parameter_schema' },
  },
});
const optionsPromptModel = {
  ...videoModel,
  options: { ...videoModel.options, prompt_max_length: 20 },
};
assert.deepEqual(generationValidationForModel(optionsPromptModel, {}), {
  promptLength: {
    unit: 'unicode_code_points',
    string: { maxLength: 20, source: 'aion_options' },
  },
});

const unicodePromptLength = preflightGenerationCase(videoModel, {
  ...validTextCase.resolvedCase,
  caseId: 'case-unicode-prompt-length',
  datasetItemId: 'item-unicode-prompt-length',
  prompt: '中😀e\u0301',
}, { promptMaxLength: 3 });
assert.equal(unicodePromptLength.errors[0]?.promptLength?.measuredLength, 4);
const trimmedPromptLength = preflightGenerationCase(videoModel, {
  ...validTextCase.resolvedCase,
  caseId: 'case-trimmed-prompt-length',
  datasetItemId: 'item-trimmed-prompt-length',
  prompt: ' 12345 ',
}, { promptMaxLength: 5 });
assert.equal(trimmedPromptLength.valid, true, 'string Prompt length must use the trimmed value sent to Aion');
const wordCountIsNotCharacterCount = preflightGenerationCase(videoModel, {
  ...validTextCase.resolvedCase,
  caseId: 'case-word-character-count',
  datasetItemId: 'item-word-character-count',
  prompt: 'longword '.repeat(700).trim(),
}, { promptMaxLength: 5000 });
assert.equal(wordCountIsNotCharacterCount.errors[0]?.promptLength?.measuredLength, 6299);

const multiPromptCase = {
  ...validTextCase.resolvedCase,
  caseId: 'case-multi-prompt-length',
  datasetItemId: 'item-multi-prompt-length',
  prompt: [
    { prompt: '1234', duration: 2 },
    { prompt: '5678', duration: 2 },
  ],
};
const perItemPromptLength = preflightGenerationCase(unionPromptModel, {
  ...multiPromptCase,
  prompt: [
    { prompt: '12345', duration: 2 },
    { prompt: '6789', duration: 2 },
  ],
}, generationValidationForModel(unionPromptModel, {}));
assert.ok(perItemPromptLength.errors.some(item => (
  item.code === 'PROMPT_TOO_LONG'
  && item.field === 'prompt[0]'
  && item.promptLength?.measuredLength === 5
  && item.promptLength?.maximumLength === 4
  && item.promptLength?.scope === 'array_item'
)));
const validPerItemPromptLength = preflightGenerationCase(
  unionPromptModel,
  multiPromptCase,
  generationValidationForModel(unionPromptModel, {}),
);
assert.equal(validPerItemPromptLength.valid, true, 'per-item limits must not be applied to the combined array length');
assert.match(
  getGenerationIssuePresentation(perItemPromptLength.errors[0] as any, 'error').description,
  /Aion input schema/,
);

const joinedPromptPolicy = generationValidationForModel(videoModel, {
  [videoModel.modelName]: structuredValidationOverrides['provider/future-video'],
});
const joinedPromptLength = preflightGenerationCase(videoModel, multiPromptCase, {
  promptLength: {
    ...joinedPromptPolicy.promptLength,
    array: {
      scope: 'array_joined',
      maxLength: 8,
      separator: '\n',
      trimItems: true,
      omitEmptyItems: true,
      source: 'manueval_compatibility',
    },
  },
});
assert.ok(joinedPromptLength.errors.some(item => (
  item.code === 'PROMPT_TOO_LONG'
  && item.field === 'prompt'
  && item.promptLength?.measuredLength === 9
  && item.promptLength?.scope === 'array_joined'
)));
const normalizedJoinedPromptLength = preflightGenerationCase(videoModel, {
  ...multiPromptCase,
  prompt: [
    { prompt: ' 12 ', duration: 2 },
    { prompt: '', duration: 1 },
    { prompt: '34', duration: 2 },
  ],
}, {
  promptLength: {
    unit: 'unicode_code_points',
    array: {
      scope: 'array_joined',
      maxLength: 5,
      separator: '\n',
      trimItems: true,
      omitEmptyItems: true,
      source: 'manueval_compatibility',
    },
  },
});
assert.equal(normalizedJoinedPromptLength.valid, true);
assert.equal(normalizedJoinedPromptLength.resolvedCase.promptLengthAudit?.[0]?.measuredLength, 5);

const unknownArrayLength = preflightGenerationCase(videoModel, multiPromptCase, {
  promptMaxLength: 5,
});
assert.equal(unknownArrayLength.valid, true, 'an unknown array-length contract must not invent a blocking limit');
assert.ok(unknownArrayLength.warnings.some(item => (
  item.code === 'PROMPT_LENGTH_NOT_VERIFIED'
  && item.promptLength?.scope === 'array_unverified'
)));
assert.deepEqual(
  buildAionGenerationRequest(videoModel, unknownArrayLength.resolvedCase).body.prompt,
  multiPromptCase.prompt,
  'length auditing must not rewrite the Aion Prompt payload',
);

const invalidDuration = preflightGenerationCase(videoModel, {
  caseId: 'case-2',
  datasetItemId: 'item-2',
  rowIndex: 1,
  prompt: 'A runner crosses the finish line.',
  imageUrls: [],
  audioUrls: [],
  controls: { duration: 7 },
});
assert.equal(invalidDuration.valid, false);
assert.ok(invalidDuration.errors.some(item => item.code === 'UNSUPPORTED_CONTROL_VALUE'));

const singleResolutionModel = normalizeAionModelConfig({
  ...rawVideoModel,
  name: 'provider/single-resolution',
  options: {
    supported_params: ['prompt', 'generation_type', 'resolution'],
    resolution_options: ['1440p'],
    input_schema: {
      supported_inputs: ['prompt'],
      required_inputs: { text_to_video: ['prompt'] },
      required_one_of_inputs: {},
    },
  },
  input_schema: {
    supported_inputs: ['prompt'],
    required_inputs: { text_to_video: ['prompt'] },
    required_one_of_inputs: {},
  },
});
assert.equal(singleResolutionModel.controls.find(control => control.key === 'resolution')?.optionSource, 'aion_options');
const unsupportedResolution = preflightGenerationCase(singleResolutionModel, {
  caseId: 'unsupported-resolution',
  datasetItemId: 'unsupported-resolution',
  rowIndex: 0,
  prompt: 'A camera pans across a city.',
  imageUrls: [],
  audioUrls: [],
  controls: { resolution: '720p' },
  parameterAudit: {
    resolution: {
      source: 'column',
      column: 'resolution',
      rawValue: '720p',
      value: '720p',
      verified: true,
      destination: 'control',
    },
  },
});
const unsupportedResolutionIssue = unsupportedResolution.errors.find(issue => (
  issue.code === 'UNSUPPORTED_CONTROL_VALUE' && issue.field === 'resolution'
));
assert.deepEqual(unsupportedResolutionIssue?.evidence, {
  rawValue: '720p',
  normalizedValue: '720p',
  source: 'column',
  sourceColumn: 'resolution',
  allowedValues: ['1440p'],
  valueType: 'string',
  ruleSource: 'aion_options',
  modelConfigFingerprint: singleResolutionModel.configFingerprint,
});
assert.deepEqual(unsupportedResolutionIssue?.repairActions, [
  { kind: 'set_parameter', field: 'resolution', allowedValues: ['1440p'], valueType: 'string' },
  { kind: 'use_parameter_column', field: 'resolution', valueType: 'string' },
  { kind: 'omit_parameter', field: 'resolution' },
]);

const imageCase = preflightGenerationCase(videoModel, {
  caseId: 'case-3',
  datasetItemId: 'item-3',
  rowIndex: 2,
  prompt: 'The subject turns toward camera.',
  imageUrls: ['https://assets.example.com/start.png'],
  audioUrls: [],
  controls: { duration: 5 },
});
assert.equal(imageCase.generationType, 'image_to_video');

const referenceCapableModel = {
  ...videoModel,
  capabilities: [...videoModel.capabilities, 'reference_to_video'],
};
const referenceModeCase = preflightGenerationCase(referenceCapableModel, {
  caseId: 'case-reference-mode',
  datasetItemId: 'item-reference-mode',
  rowIndex: 7,
  prompt: 'Keep both reference subjects.',
  imageUrls: referenceImageInputs.imageUrls,
  audioUrls: [],
  controls: { duration: 5 },
  generationType: referenceImageInputs.generationType,
});
assert.equal(referenceModeCase.valid, true);
assert.equal(referenceModeCase.generationType, 'reference_to_video');
assert.equal(
  buildAionGenerationRequest(referenceCapableModel, referenceModeCase.resolvedCase).body.generation_type,
  'reference_to_video',
);

const request = buildAionGenerationRequest(videoModel, imageCase.resolvedCase);
assert.equal(request.path, '/model/api/v1/model/generate-video');
assert.equal(request.body.model_name, rawVideoModel.name);
assert.equal(request.body.generation_type, 'image_to_video');
assert.deepEqual(request.body.image_urls, ['https://assets.example.com/start.png']);
assert.equal(request.body.features.auto_adjust_duration_to_supported, false);

const customInputModel = {
  ...videoModel,
  capabilities: [...videoModel.capabilities, 'reference_to_video'],
  inputSchema: {
    properties: {
      conditioning_assets: { type: 'array' },
    },
    required_inputs: {
      reference_to_video: ['conditioning_assets'],
    },
  },
};
const customInputCase = preflightGenerationCase(customInputModel, {
  caseId: 'case-custom-input',
  datasetItemId: 'item-custom-input',
  rowIndex: 4,
  prompt: 'Use the conditioning assets.',
  imageUrls: [],
  audioUrls: [],
  controls: { duration: 5 },
  generationType: 'reference_to_video',
  extraInputs: {
    conditioning_assets: [{ image_url: 'https://assets.example.com/character.png' }],
    model_name: 'untrusted-model',
    features: { auto_adjust_duration_to_supported: true },
  },
});
assert.equal(customInputCase.valid, true);
const customInputRequest = buildAionGenerationRequest(customInputModel, customInputCase.resolvedCase);
assert.deepEqual(customInputRequest.body.conditioning_assets, [
  { image_url: 'https://assets.example.com/character.png' },
]);
assert.equal(customInputRequest.body.model_name, rawVideoModel.name);
assert.equal(customInputRequest.body.features.auto_adjust_duration_to_supported, false);

const cost = estimateGenerationCost(videoModel, 3);
assert.equal(cost.known, true);
assert.equal(cost.totalCredits, 36);

const unknownCost = estimateGenerationCost({
  ...videoModel,
  priceItems: [{ formula: 'provider-specific' }],
}, 3);
assert.equal(unknownCost.known, false);

const assets = [
  { id: 'asset-1', relativePath: 'characters/p1.png', fileName: 'p1.png' },
  { id: 'asset-2', relativePath: 'looks/p2.png', fileName: 'p2.png' },
  { id: 'asset-3', relativePath: 'alternate/p2.png', fileName: 'p2.png' },
];
assert.equal(matchUploadedAsset('characters\\p1.png', assets).assetId, 'asset-1');
assert.equal(matchUploadedAsset('p1.png', assets).assetId, 'asset-1');
assert.equal(matchUploadedAsset('p2.png', assets).errorCode, 'AMBIGUOUS_ASSET');
assert.equal(matchUploadedAsset('missing.png', assets).errorCode, 'MISSING_ASSET');

const invalidUrl = preflightGenerationCase(videoModel, {
  caseId: 'case-4',
  datasetItemId: 'item-4',
  rowIndex: 3,
  prompt: 'Prompt',
  imageUrls: ['file:///tmp/reference.png'],
  audioUrls: [],
  controls: { duration: 5 },
});
assert.equal(invalidUrl.valid, false);
assert.ok(invalidUrl.errors.some(item => item.code === 'INVALID_ASSET_URL'));

const wrappedProviderPayload = normalizeProviderPayload({
  data: {
    taskId: 'task-wrapped',
    taskStatus: 'succeeded',
    endpointType: 'video',
    videos: [{ url: 'https://assets.example.com/result.mp4', previewUrl: 'https://assets.example.com/preview.jpg' }],
  },
});
assert.equal(wrappedProviderPayload.task_id, 'task-wrapped');
assert.equal(wrappedProviderPayload.task_status, 'succeeded');
const wrappedProviderResult = providerResult({ data: wrappedProviderPayload });
assert.equal(wrappedProviderResult?.originalResultUrl, 'https://assets.example.com/result.mp4');
assert.equal(wrappedProviderResult?.resultUrl, 'https://assets.example.com/result.mp4');
assert.equal(wrappedProviderResult?.durability, 'temporary');
assert.equal(wrappedProviderResult?.previewUrl, 'https://assets.example.com/preview.jpg');

const vidMuseAssetOptions = {
  mediaType: 'video' as const,
  expectedUserId: '796854911166661',
  imageBaseUrl: 'https://vidmuse-dev.sandcdn.com',
  videoBaseUrl: 'https://vidmuse-dev-video.sandcdn.com',
};
const providerTemporaryUrl = 'https://provider.example.com/generated.mp4?expires=soon';
const stableVideoUrl = 'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/%E7%BB%93%E6%9E%9C%201.mp4';
assert.equal(
  aionUserAssetPathToUrl(
    '/work/aion-user-base-dev/796854911166661/assets/videos/\u7ed3\u679c 1.mp4',
    vidMuseAssetOptions,
  ),
  stableVideoUrl,
);
assert.equal(
  aionUserAssetPathToUrl(
    '/work/aion-user-base-dev/796854911166661/assets/images/result image.png',
    { ...vidMuseAssetOptions, mediaType: 'image' },
  ),
  'https://vidmuse-dev.sandcdn.com/user/796854911166661/assets/images/result%20image.png',
);
assert.equal(
  aionUserAssetPathToUrl(
    'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/already-stable.mp4',
    vidMuseAssetOptions,
  ),
  'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/already-stable.mp4',
);
for (const unsafePath of [
  '/work/aion-user-base-dev/999/assets/videos/result.mp4',
  '/work/aion-user-base-dev/796854911166661/assets/images/result.mp4',
  '/work/aion-user-base-dev/796854911166661/assets/videos/../secrets.mp4',
  '/work/aion-runtime-dev/thread_1/result.mp4',
  'https://vidmuse-dev-video.sandcdn.com/user/999/assets/videos/wrong-user.mp4',
  'https://attacker.example.com/user/796854911166661/assets/videos/result.mp4',
]) {
  assert.equal(aionUserAssetPathToUrl(unsafePath, vidMuseAssetOptions), undefined);
}

const persistedProviderResult = providerResult({
  data: {
    taskStatus: 'succeeded',
    videos: [{
      url: providerTemporaryUrl,
      local_path: '/work/aion-user-base-dev/796854911166661/assets/videos/\u7ed3\u679c 1.mp4',
    }],
  },
}, vidMuseAssetOptions);
assert.deepEqual(persistedProviderResult, {
  originalResultUrl: providerTemporaryUrl,
  resultUrl: stableVideoUrl,
  durability: 'vidmuse_asset',
  previewUrl: undefined,
});
assert.deepEqual(
  unarchivedGenerationResult({}, persistedProviderResult!, 'video'),
  {
    originalResultUrl: providerTemporaryUrl,
    resultUrl: stableVideoUrl,
    durability: 'vidmuse_asset',
    previewUrl: undefined,
    mediaType: 'video',
  },
);
assert.deepEqual(
  archivedGenerationResult({}, persistedProviderResult!, 'https://eval.example.com/stable/video.mp4', 'video'),
  {
    originalResultUrl: providerTemporaryUrl,
    resultUrl: 'https://eval.example.com/stable/video.mp4',
    mediaType: 'video',
    durability: 'manueval_oss',
  },
);

const camelCasePersistedResult = providerResult({
  videos: [{
    url: providerTemporaryUrl,
    localPath: '/work/aion-user-base-dev/796854911166661/assets/videos/camel-case.mp4',
  }],
}, vidMuseAssetOptions);
assert.equal(
  camelCasePersistedResult?.resultUrl,
  'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/camel-case.mp4',
);
assert.equal(camelCasePersistedResult?.durability, 'vidmuse_asset');

const topLevelFilePathResult = providerResult({
  videos: [{ url: providerTemporaryUrl }],
  filePath: '/work/aion-user-base-dev/796854911166661/assets/videos/top-level.mp4',
}, vidMuseAssetOptions);
assert.equal(
  topLevelFilePathResult?.resultUrl,
  'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/top-level.mp4',
);
assert.equal(topLevelFilePathResult?.durability, 'vidmuse_asset');

const rejectedPersistedResult = providerResult({
  videos: [{
    url: providerTemporaryUrl,
    file_path: '/work/aion-user-base-dev/999/assets/videos/wrong-user.mp4',
  }],
}, vidMuseAssetOptions);
assert.equal(rejectedPersistedResult?.resultUrl, providerTemporaryUrl);
assert.equal(rejectedPersistedResult?.durability, 'temporary');
assert.equal(JSON.stringify(rejectedPersistedResult).includes('/work/'), false);
assert.equal(
  generationAssetService.isExecutionReady(),
  generationAssetService.usesTemporaryUrls() || generationAssetService.isConfigured(),
);

const taskWorkerSubmission = buildTaskWorkerSubmission(
  '/model/api/v1/model/generate-video',
  {
    model_name: 'provider/video-pro',
    prompt: 'Animate this.',
    resolution: '720p',
    features: { auto_adjust_duration_to_supported: false },
  },
);
assert.equal(taskWorkerSubmission.modality, 'video');
assert.equal(taskWorkerSubmission.request.event_type, 'vidflow/remix-shot-video.triggered');
assert.equal(taskWorkerSubmission.request.data.standalone, true);
assert.equal(taskWorkerSubmission.request.data.features, undefined);
assert.throws(() => buildTaskWorkerSubmission(
  '/model/api/v1/model/generate-video',
  {
    model_name: 'provider/video-pro',
    prompt: 'Do not silently discard this seed.',
    extra_params: { seed: 0 },
  },
), /task_worker.*Seed/i);
assert.equal(
  taskWorkerFilePathToUrl(
    '/work/aion-user-base-dev/987654/images/result image.png',
    'image',
    'https://image.example.com',
    'https://video.example.com',
  ),
  'https://image.example.com/user/987654/images/result%20image.png',
);
assert.deepEqual(
  normalizeTaskWorkerTask({
    id: 'rtc-1',
    status: 'success',
    data: {
      model_request_id: 'request-1',
      result: { file_path: '/work/aion-user-base-dev/987654/images/result.png' },
    },
  }, 'image', 'https://image.example.com', 'https://video.example.com'),
  {
    task_id: 'rtc-1',
    task_status: 'succeed',
    task_status_msg: undefined,
    endpoint_type: 'image',
    model_request_id: 'request-1',
    images: [{
      url: 'https://image.example.com/user/987654/images/result.png',
      file_path: '/work/aion-user-base-dev/987654/images/result.png',
    }],
  },
);

const aionRequests: Array<{ url: string; init?: RequestInit }> = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  aionRequests.push({ url, init });
  if (url.includes('/public/api/v1/configs/model-configs')) {
    return new Response(JSON.stringify({
      data: [
        camelCaseVideoModel,
        {
          ...camelCaseVideoModel,
          name: 'disabled-video-model',
          is_enabled: false,
        },
      ],
      limit: 20,
      offset: 0,
      total: 2,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ task_id: 'task-1', task_status: 'submitted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const aionClient = new AionGenerationClient(
  'https://aion.example.com',
  '987654',
  fakeFetch,
  'https://model.example.com/private/api/v1/model',
  'model_api',
);
const listedModels = await aionClient.listModels(['video']);
assert.equal(listedModels.length, 1);
assert.equal(listedModels[0].modelName, camelCaseVideoModel.name);
await aionClient.submit('/model/api/v1/model/generate-video', { model_name: rawVideoModel.name });
const submitRequest = aionRequests.at(-1);
assert.equal(submitRequest?.url, 'https://model.example.com/private/api/v1/model/generate-video');
assert.equal(new Headers(submitRequest?.init?.headers).get('x-auth-user-id'), '987654');

const structuredErrorClient = new AionGenerationClient(
  'https://aion.example.com',
  '987654',
  async () => new Response(JSON.stringify({
    detail: 'Too many requests',
    error: { code: 'rate_limited', retryable: true },
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '7',
      'X-Model-Api-Error-Type': 'rpm',
      'X-Model-Api-Error-Code': 'rate_limited',
      'X-Model-Api-Error-Retryable': 'true',
    },
  }),
  '',
  'model_api',
);
await assert.rejects(
  () => structuredErrorClient.submit('/model/api/v1/model/generate-video', {}),
  (error: any) => {
    assert.equal(error.status, 429);
    assert.equal(error.errorType, 'rpm');
    assert.equal(error.errorCode, 'rate_limited');
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 7_000);
    assert.deepEqual(generationSubmissionErrorDiagnostics(error), {
      httpStatus: 429,
      errorName: 'Error',
      errorType: 'rpm',
      errorCode: 'rate_limited',
      retryable: true,
      retryAfterMs: 7_000,
      responseReceived: true,
      definitelyRejected: true,
    });
    return true;
  },
);

const receivedHttpErrorClient = new AionGenerationClient(
  'https://aion.example.com',
  '987654',
  async () => new Response(JSON.stringify({
    code: 'provider_crashed',
    detail: { message: 'The configured provider rejected this request.' },
    retryable: true,
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  }),
  '',
  'model_api',
);
await assert.rejects(
  () => receivedHttpErrorClient.submit('/model/api/v1/model/generate-video', {}),
  (error: any) => {
    assert.equal(error.status, 500);
    assert.equal(error.errorCode, 'provider_crashed', 'top-level Aion error codes must be retained');
    assert.equal(error.retryable, true);
    assert.equal(error.message, 'The configured provider rejected this request.');
    assert.equal(generationSubmissionFailure(error).status, 'failed');
    return true;
  },
);

const taskWorkerRequests: Array<{ url: string; init?: RequestInit }> = [];
const taskWorkerFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  taskWorkerRequests.push({ url, init });
  if (init?.method === 'POST') {
    return new Response(JSON.stringify({ status: 'accepted', task_ids: ['rtc-1'] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify([{
    id: 'rtc-1',
    status: 'success',
    data: {
      model_request_id: 'request-1',
      result: { file_path: '/work/aion-user-base-dev/987654/images/result.png' },
    },
  }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const taskWorkerClient = new AionGenerationClient(
  'https://catalog.example.com',
  '987654',
  taskWorkerFetch,
  '',
  'task_worker',
  'https://manager.example.com/manager',
  'thread-1',
  'https://image.example.com',
  'https://video.example.com',
);
const submittedTaskWorker = await taskWorkerClient.submit(
  '/model/api/v1/model/generate-image',
  { model_name: 'xai/grok-imagine-image', prompt: 'A red teapot.' },
);
assert.equal(submittedTaskWorker.task_id, 'rtc-1');
assert.equal(taskWorkerRequests[0].url, 'https://manager.example.com/manager/api/v2/threads/thread-1/task-worker/create-task');
assert.equal(new Headers(taskWorkerRequests[0].init?.headers).get('x-auth-thread-id'), 'thread-1');
const polledTaskWorker = await taskWorkerClient.getTask('rtc-1', 'xai/grok-imagine-image', 'image');
assert.equal(polledTaskWorker.task_status, 'succeed');
assert.equal(polledTaskWorker.images[0].url, 'https://image.example.com/user/987654/images/result.png');

await assert.rejects(
  () => generationAssetService.createUpload({
    datasetId: 'dataset-1',
    fileName: 'payload.exe',
    relativePath: 'payload.exe',
    contentType: 'application/octet-stream',
    sizeBytes: 100,
  }, {
    id: 'user-1',
    displayName: 'Tester',
    email: 'tester@example.com',
    organizationId: 'default',
  }),
  generationAssetService.usesTemporaryUrls()
    ? /Local asset upload is unavailable in temporary URL mode/
    : /Unsupported generation asset type/,
);

const oversizedStream = Readable.from([Buffer.alloc(6)]).pipe(createByteLimitStream(5));
await assert.rejects(async () => {
  for await (const _chunk of oversizedStream) {
    // Consume the stream so the byte limiter observes every chunk.
  }
}, /Remote asset exceeds 5 bytes/);
console.log('Generation planning and client tests passed.');
