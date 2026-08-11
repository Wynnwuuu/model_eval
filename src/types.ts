export type ProjectType = '重度评测 (周期/版本)' | '轻度评测 (快速/专项)';
export type Priority = 'P0' | 'P1' | 'P2';
export type Category = '产品上游模型能力评测' | '生成效果评测-中间态' | '生成效果评测-成片' | '工程团队专项';

export interface Dataset {
  id: string;
  name: string;
  description: string;
  size: string;
  type: string;
  creatorUid?: string;
  creatorName?: string;
  createdAt?: number;
}

export interface ModelBaseline {
  id: string;
  modelName: string;
  provider: string;
  modality: string;
  version: string;
  updateDate: string;
  scores: { datasetName: string; score: string | number }[];
}

export interface Dimension {
  name: string;
  definition: string;
  type: '主观' | '客观' | '混合';
}

export interface EvaluationStep {
  id: number;
  name: string;
  owner: string;
  status: 'pending' | 'in-progress' | 'completed';
  executionType?: 'internal' | 'external';
  resultNote?: string;
  materialFile?: { name: string; url: string };
}

export interface EvaluationProject {
  id: string;
  name: string;
  category: Category;
  priority: Priority;
  type: ProjectType;
  initiator?: string;
  initiatorUid?: string;
  initiatorName?: string;
  goal: string;
  cycle: string;
  support: string[];
  progress: number;
  steps: EvaluationStep[];
  resultSummary: string;
  link: string;
  datasetIds: string[];
  dimensions: Dimension[];
  generatedDataStatus: string;
  analysis: string;
  lastUpdated: string | number;
  createdAt?: number;
}

export type ArenaSamplingPhase = 'coverage' | 'adaptive';

export interface PairwiseVoteContext {
  pairId?: string;
  originalItemId?: string;
  assignmentId?: string;
  modelAId: string;
  modelAName: string;
  modelBId: string;
  modelBName: string;
  leftModelId?: string;
  rightModelId?: string;
  samplingPhase?: ArenaSamplingPhase;
  samplingProbability?: number;
  eligiblePairCount?: number;
  schedulerVersion?: string;
}

export interface ArenaBattleAssignment {
  assignmentId: string;
  itemId: string;
  originalItemId: string;
  modelAId: string;
  modelAName: string;
  modelAUrl: string;
  modelBId: string;
  modelBName: string;
  modelBUrl: string;
  leftModelId: string;
  rightModelId: string;
  isSwapped: boolean;
  samplingPhase: ArenaSamplingPhase;
  samplingProbability: number;
  eligiblePairCount: number;
  schedulerVersion: string;
  pairContext: PairwiseVoteContext;
}

export interface EvaluationItem {
  id: string;
  modelA_Url: string; // Control or Model A
  modelB_Url: string; // Treatment or Model B
  modelOutputs?: ModelOutput[]; // Arena-rank multi-model outputs
  prompt?: string;    // The prompt used to generate
  inputs?: Record<string, any>; // Flexible input columns
  dimensionValues?: Record<string, string>; // Optional case-level analysis dimensions
  startImageUrl?: string; // New: Specific field for start image
  referenceUrls?: string[]; // Changed from single string to array
  type: 'text' | 'image' | 'video' | 'audio' | 'markdown' | 'unknown';
  isSwapped?: boolean; // New: If true, UI displays B on left and A on right for blind testing
  pairContext?: PairwiseVoteContext;
  originalItemId?: string;
  originalData?: Record<string, any>;
  itemOrder?: number;
  sourceDatasetItemId?: string;
  sourceDatasetVersion?: number;
  archivedAt?: number;
  archivedReason?: string;
}

export interface VoteItemSnapshot {
  itemId: string;
  prompt?: string;
  inputs?: Record<string, any>;
  dimensionValues?: Record<string, string>;
  modelOutputs?: ModelOutput[];
  modelA_Url?: string;
  modelB_Url?: string;
  startImageUrl?: string;
  referenceUrls?: string[];
  type?: EvaluationItem['type'];
  pairContext?: PairwiseVoteContext;
  originalItemId?: string;
  originalData?: Record<string, any>;
  sourceDatasetItemId?: string;
  sourceDatasetVersion?: number;
}

export type EvalParadigm = 'GSB' | 'MOS' | 'Arena' | 'Arena-rank' | 'Pairwise' | 'RubricScore' | 'BenchmarkPreview';

export type EvaluationMethod = 'ab_preference' | 'pairwise' | 'direct_score' | 'rubric_score' | 'rank_order' | 'benchmark_preview';

export type TiePolicy = 'allow' | 'disallow';
export type PairwiseMode = 'arena_sampled' | 'all_pairs' | 'adjacent_pairs';
export type DimensionScope = 'primary' | 'secondary' | 'rationale';
export type DimensionAggregationRole = 'score' | 'preference' | 'rationale' | 'metadata';

export interface ScoreScaleLevel {
  value: number;
  label: string;
  description?: string;
}

export interface EvaluationConfig {
  method: EvaluationMethod;
  blind?: boolean;
  tiePolicy?: TiePolicy;
  scale?: {
    min: number;
    max: number;
    labels?: ScoreScaleLevel[];
  };
  dimensions?: EvalDimension[];
  pairwiseMode?: PairwiseMode;
  arenaSampling?: ArenaSamplingConfig;
  requireReason?: boolean;
  sourceRubricId?: string;
  rubricName?: string;
}

export interface ModelOutput {
  modelId: string;
  modelName: string;
  url: string;
}

export type VoteType = 'A' | 'B' | 'Tie';

export interface RankingEntry {
  modelId: string;
  modelName: string;
  rank: number;
}

export interface VoteRecord {
  itemId: string;
  itemSnapshot?: VoteItemSnapshot;
  evaluatedItemSnapshot?: VoteItemSnapshot;
  datasetVersionEvaluated?: number;
  datasetVersionCurrent?: number;
  contentUpdatedAfterVote?: boolean;
  archivedAt?: number;
  archivedReason?: string;
  vote?: VoteType;
  ranking?: RankingEntry[];
  method?: EvaluationMethod;
  choice?: VoteType | string;
  scores?: Record<string, number>;
  rubricResponses?: Record<string, {
    modelId: string;
    modelName: string;
    scores: Record<string, number>;
    answers?: Record<string, string>;
    reason?: string;
  }>;
  pairContext?: PairwiseVoteContext;
  reason?: string;
  timestamp: number;
  user?: string; // Who voted
}

export interface TaskVoteGroup {
  user: string;
  userId?: string;
  displayName?: string;
  email?: string;
  votes: VoteRecord[];
  archivedVotes?: VoteRecord[];
}

export type ResultsVoteScope = 'mine' | 'all';

export type AppRoute =
  | 'overview'
  | 'projects'
  | 'datasets'
  | 'generation'
  | 'templates'
  | 'tasks'
  | 'evaluation'
  | 'insights'
  | 'history'
  | 'voting'
  | 'results';

export type AppState = AppRoute | 'setup' | 'analysis' | 'dashboard' | 'dataset_repo' | 'template_repo' | 'task_builder';

export interface RouteContext {
  projectId?: string;
  taskId?: string;
  templateId?: string;
  materialId?: string;
  materialStatusFilter?: 'draft' | 'active' | 'completed';
  datasetId?: string;
  generationBatchId?: string;
  generationView?: 'tasks' | 'new';
  taskDatasetId?: string;
  taskModelColumns?: string[];
  source?: 'dashboard' | 'task' | 'dataset';
  taskBuilderMode?: 'create' | 'list';
}

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  route: AppRoute;
  badge?: string | number;
  children?: NavItem[];
}

export interface VotingStats {
  total: number;
  aCount: number;
  bCount: number;
  tieCount: number;
}

export interface HistorySession {
  id: string; // Unique session ID
  timestamp: number;
  userName: string;
  modelNames: { a: string; b: string };
  models?: { id: string; name: string }[];
  paradigm?: EvalParadigm;
  evaluationConfig?: EvaluationConfig;
  items: EvaluationItem[];
  votes: VoteRecord[];
}

// For the analysis screen
export interface AggregatedResult {
  itemId: string;
  prompt?: string;
  dimensionValues?: Record<string, string>;
  votes: {
    A: number;
    B: number;
    Tie: number;
  };
  voters: string[]; // List of people who voted on this
}

// ==========================================
// New Architecture: Dataset & Templates
// ==========================================

export type SchemaFieldType = 'text' | 'image_url' | 'video_url' | 'audio_url' | 'url' | 'chat_history';
export type DatasetFieldRole = 'case_id' | 'input' | 'output' | 'dimension' | 'reference' | 'media' | 'metadata' | 'rubric' | 'system';
export type DatasetPreviewType = 'none' | 'text' | 'image' | 'video' | 'audio' | 'link';
export type DatasetModality = 'image' | 'video' | 'audio' | 'text' | 'multimodal' | 'other';

export interface DatasetSchemaField {
  key: string;
  label: string;
  type: SchemaFieldType;
  role?: DatasetFieldRole;
  canonicalKey?: string;
  sourceKey?: string;
  previewType?: DatasetPreviewType;
  required?: boolean;
}

export interface DatasetStandardFieldDefinition {
  canonicalKey: string;
  label: string;
  role: DatasetFieldRole;
  type: SchemaFieldType;
  previewType?: DatasetPreviewType;
  required?: boolean;
  aliases?: string[];
  group?: string;
}

export interface DatasetColumnMappings {
  caseId?: string;
  inputColumns: string[];
  outputColumns: string[];
  dimensionColumns: string[];
  referenceColumns: string[];
  standard: Record<string, string>;
}

export interface DatasetCard {
  applicableTasks: string[];
  applicableStages: string[];
  source: string;
  sampleSize: number;
  modality: DatasetModality;
  tagDistribution: Record<string, number>;
  dimensionDistribution: Record<string, Record<string, number>>;
  rubricBinding: string;
  coverageGaps: string[];
  latestChange: string;
  updatedAt: number;
}

export interface DatasetVersionEntry {
  version: number;
  changedAt: number;
  changedBy: string;
  changeSummary: string;
  itemCountBefore: number;
  itemCountAfter: number;
  syncSummary?: DatasetSyncSummary;
}

export interface DatasetSyncSummary {
  projects: number;
  tasks: number;
  taskItemsUpdated: number;
  taskItemsAdded: number;
  taskItemsArchived: number;
  votesUpdated: number;
  votesArchived: number;
  warnings: string[];
}

export interface DatasetTaskBinding {
  datasetId: string;
  datasetVersion: number;
  inputColumns: string[];
  dimensionColumns: string[];
  referenceColumns: string[];
  modelColumns: Record<string, string>;
}

export interface DatasetValidationSummary {
  status: 'ok' | 'warning' | 'error';
  missingCaseIdCount: number;
  duplicateCaseIdCount: number;
  invalidUrlCount: number;
  missingInputCount: number;
  emptyOutputCells: number;
  dimensionDistribution: Record<string, Record<string, number>>;
  warnings: string[];
}

export interface DatasetCopySource {
  datasetId: string;
  datasetName: string;
  datasetVersion: number;
  copiedAt: number;
}

export interface ArenaSamplingConfig {
  suggestedBattlesPerReviewer: number;
  warmupBattlesPerModel: number;
  explorationRate: number;
  schedulerVersion: string;
  seed: string;
}

export interface DatasetVersionSnapshot {
  version: number;
  name?: string;
  description?: string;
  tags?: string[];
  inputSchema: DatasetSchemaField[];
  items: Record<string, any>[];
  inputType?: 'text' | 'text_image' | 'text_audio' | 'multi_turn' | 'other';
  modality?: DatasetModality;
  categoryPath?: string[];
  columnMappings?: DatasetColumnMappings;
  datasetCard?: DatasetCard;
  validationSummary?: DatasetValidationSummary;
  standardFields?: DatasetStandardFieldDefinition[];
  syncSummary?: DatasetSyncSummary;
  copiedFrom?: DatasetCopySource;
  updatedAt: number;
}

export interface EvalDataset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputSchema: DatasetSchemaField[];
  items: Record<string, any>[]; // The actual data rows
  inputType?: 'text' | 'text_image' | 'text_audio' | 'multi_turn' | 'other';
  modality?: DatasetModality;
  categoryPath?: string[];
  standardFields?: DatasetStandardFieldDefinition[];
  columnMappings?: DatasetColumnMappings;
  datasetCard?: DatasetCard;
  version?: number;
  versionHistory?: DatasetVersionEntry[];
  versionSnapshots?: Record<string, DatasetVersionSnapshot>;
  validationSummary?: DatasetValidationSummary;
  syncSummary?: DatasetSyncSummary;
  copiedFrom?: DatasetCopySource;
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
  updatedAt: number;
}

export type GenerationOutputModality = DatasetModality;
export type GenerationJobStatus = 'draft' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'writeback_conflict';
export type GenerationItemStatus =
  | 'pending' | 'submitting' | 'submitted' | 'processing' | 'reconciling' | 'archiving'
  | 'running' | 'succeeded' | 'completed' | 'failed' | 'submission_unknown' | 'cancelled';
export type GenerationSeedMode = 'unused' | 'fixed' | 'derive_from_case' | 'column';
export type GenerationTargetMode = 'new' | 'fill_existing';
export type GenerationAssetDurability = 'vidmuse_asset' | 'temporary' | 'manueval_oss';
export type GenerationItemResolutionStatus = 'open' | 'skipped' | 'retrying' | 'resolved';

export interface GenerationStatusCounts {
  pending: number;
  submitting: number;
  submitted: number;
  processing: number;
  archiving: number;
  reconciling: number;
  succeeded: number;
  failed: number;
  submissionUnknown: number;
  cancelled: number;
  unresolved: number;
}

export interface GenerationQueueLane {
  limit: number;
  active: number;
  pending: number;
  models?: GenerationModelQueueState[];
  reconciling: number;
  hardLimit?: number;
  recommendedLimit?: number;
  adaptiveEnabled?: boolean;
  adaptiveEnforced?: boolean;
  shadowEndsAt?: number;
  phase?: GenerationCapacityPhase;
  submitRatePerMinute?: number;
  submitWorkers?: number;
  pollWorkers?: number;
  strategy?: 'optimistic_waves';
  optimisticWaves?: number[];
}

export type GenerationCapacityPhase =
  | 'slow_start'
  | 'stable'
  | 'congestion_avoidance'
  | 'rate_limited'
  | 'cooling'
  | 'circuit_open';

export interface GenerationCapacityBucketQueueState {
  capacityKey: string;
  modelConfigId: string;
  modelConfigIds?: string[];
  groupId?: string;
  generationType: string;
  generationTypes?: string[];
  active: number;
  pending: number;
  organizationActive: number;
  organizationPending: number;
  currentLimit: number;
  nextLimit?: number;
  acceptedInWave?: number;
  requiredAcceptances?: number;
  verifiedLimit: number;
  submitRatePerMinute: number;
  phase: GenerationCapacityPhase;
  cooldownUntil?: number;
  circuitOpenUntil?: number;
  lastEvidence?: string;
  lastEvidenceAt?: number;
  nextProbeRequires: number;
  saturatedSuccesses: number;
  probeInFlight: boolean;
}

export interface GenerationModelQueueState {
  modelName: string;
  modelNames?: string[];
  active: number;
  pending: number;
  organizationActive: number;
  organizationPending: number;
  minLimit: number;
  initialLimit: number;
  maxLimit: number;
  effectiveLimit: number;
  sampleSize: number;
  successStreak: number;
  lastCapacityFailureAt?: number;
  reconciling: number;
  capacityFailures: number;
  capacityFailureRate: number;
  mode: 'initial' | 'ramping' | 'maximum' | 'minimum';
  phase?: GenerationCapacityPhase;
  reason: string;
  buckets?: GenerationCapacityBucketQueueState[];
}


export interface GenerationQueueState {
  image: GenerationQueueLane;
  video: GenerationQueueLane;
  taskTimeoutMs: number;
  updatedAt: number;
}

export interface GenerationJobEvent {
  id: string;
  jobId: string;
  action: string;
  itemIds: string[];
  actorId?: string;
  actorName?: string;
  details?: Record<string, any>;
  createdAt: number;
}

export interface GenerationSelectionSummary {
  datasetTotal: number;
  selected: number;
  valid: number;
  invalid: number;
  unselected: number;
}

export interface GenerationControlDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'toggle' | 'json';
  options?: string[];
  defaultValue?: string | number | boolean;
  unit?: string;
}

export type GenerationParameterValueType = 'string' | 'number' | 'boolean' | 'json';

export type GenerationParameterBinding =
  | { source: 'unused' }
  | { source: 'uniform'; value: unknown; valueType?: GenerationParameterValueType }
  | { source: 'column'; column: string; valueType?: GenerationParameterValueType };

export interface GenerationAdvancedParameterDefinition {
  key: string;
  label: string;
  verified: false;
  destination: 'extra_params';
}

export interface GenerationInvalidParameterDefinition {
  key: string;
  label: string;
  message: string;
  replacement: string;
}

export interface GenerationParameterAuditEntry {
  source: 'uniform' | 'column' | 'unused' | 'case_override';
  column?: string;
  value?: unknown;
  verified: boolean;
  destination: 'control' | 'extra_params' | 'omitted' | 'blocked';
}

export interface GenerationModelConfig {
  id: string;
  configId?: string;
  modelName?: string;
  description?: string;
  displayName: string;
  provider: string;
  outputModality: GenerationOutputModality;
  previewType: DatasetPreviewType;
  capabilities: string[];
  supportsSeed: boolean;
  supportedAspectRatios?: string[];
  supportedResolutions?: string[];
  supportedDurations?: Array<string | number>;
  controls: GenerationControlDefinition[];
  advancedParameters: GenerationAdvancedParameterDefinition[];
  invalidParameters: GenerationInvalidParameterDefinition[];
  inputSchema?: Record<string, any>;
  options?: Record<string, any>;
  priceItems?: Array<Record<string, any>>;
  costItems?: Array<Record<string, any>>;
  configFingerprint?: string;
  updatedAt?: string;
}

export type GenerationInputMappingMode = 'assisted' | 'mcp';
export type GenerationPromptFormat = 'text' | 'multi_prompt_json' | 'typed';

export type GenerationKeyframeBinding =
  | { source: 'unused' }
  | { source: 'columns'; firstColumn: string; lastColumn?: string }
  | { source: 'array_column'; column: string };

export type GenerationElementMode = 'image' | 'video' | 'element_id';

export type GenerationElementBinding = {
  id: string;
  mode: GenerationElementMode;
  frontalImageColumn?: string;
  referenceImageColumns?: string[];
  referenceImageArrayColumn?: string;
  videoColumn?: string;
  elementIdColumn?: string;
};

export type GenerationElementsBinding =
  | { source: 'unused' }
  | { source: 'builder'; items: GenerationElementBinding[] }
  | { source: 'array_column'; column: string };

export type GenerationAudioRangeSource = 'none' | 'fixed' | 'column' | 'columns';

export type GenerationAudioBinding = {
  id: string;
  urlColumn: string;
  rangeSource: GenerationAudioRangeSource;
  fixedRange?: [number, number];
  rangeColumn?: string;
  rangeStartColumn?: string;
  rangeEndColumn?: string;
};

export type GenerationAudiosBinding =
  | { source: 'unused' }
  | { source: 'builder'; items: GenerationAudioBinding[] }
  | { source: 'array_column'; column: string };

export interface GenerationContentMappingV2 {
  version: 2;
  prompt: {
    column: string;
    format: GenerationPromptFormat;
  };
  keyframes: GenerationKeyframeBinding;
  elements: GenerationElementsBinding;
  audios: GenerationAudiosBinding;
}

export type GenerationInputPresetId = 'vidmuse_evaluation_v1';


export type GenerationCompatibilityMode = 'strict' | 'reference_fallback';

export interface GenerationInputMapping {
  presetId?: GenerationInputPresetId;
  contentMappingVersion?: 2;
  contentMapping?: GenerationContentMappingV2;
  mappingMode?: GenerationInputMappingMode;
  compatibilityMode?: GenerationCompatibilityMode;
  canonicalFieldMappings?: Record<string, string>;
  promptColumn?: string;
  referenceImageColumns: string[];
  referenceAudioColumns: string[];
  referenceVideoColumns?: string[];
  startImageColumn?: string;
  endImageColumn?: string;
  lyricsOrDialogueColumn?: string;
  extraInputColumns: string[];
  extraInputMappings?: Record<string, string>;
}

export type GenerationDurationSourceMode = 'uniform' | 'column' | 'reference_audio';

export interface GenerationReferenceAudioDuration {
  audioUrl: string;
  detectedSeconds: number;
  resolvedDuration: number;
}

export interface GenerationDurationSource {
  mode: GenerationDurationSourceMode;
  column?: string;
  referenceAudio?: Record<string, GenerationReferenceAudioDuration>;
}
export interface DatasetGenerationJob {
  id: string;
  datasetId: string;
  datasetName?: string;
  datasetVersion?: number;
  modelConfig: GenerationModelConfig;
  targetColumn: string;
  targetMode?: GenerationTargetMode;
  selectionSummary?: GenerationSelectionSummary;
  inputMapping: GenerationInputMapping;
  defaultControls: Record<string, string | number | boolean>;
  perCaseControlColumns: Record<string, string>;
  parameterBindings?: Record<string, GenerationParameterBinding>;
  caseReviews?: Record<string, GenerationCaseReview>;
  seedMode: GenerationSeedMode;
  seedPolicyVersion?: 2;
  fixedSeed?: number;
  seedColumn?: string;
  status: GenerationJobStatus;
  total: number;
  cancelRequested?: boolean;
  writebackStatus?: 'pending' | 'running' | 'completed' | 'conflict' | 'failed';
  writebackDatasetVersion?: number;
  succeeded: number;
  failed: number;
  statusCounts?: GenerationStatusCounts;
  unresolved?: number;
  queueReason?: string;
  retryOfJobId?: string;
  createdByUid?: string;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DatasetGenerationJobItem {
  id: string;
  jobId: string;
  datasetId: string;
  rowIndex: number;
  caseId: string;
  datasetItemId?: string;
  retryOfItemId?: string;
  resolutionStatus?: GenerationItemResolutionStatus;
  resolutionBy?: string;
  resolutionAt?: number;
  status: GenerationItemStatus;
  requestId?: string;
  providerJobId?: string;
  resolvedInputs: Record<string, any>;
  providerStatus?: string;
  attempt?: number;
  resolvedControls: Record<string, any>;
  seed?: number;
  resultUrl?: string;
  originalResultUrl?: string;
  durability?: GenerationAssetDurability;
  resultText?: string;
  mediaType?: DatasetPreviewType;
  error?: {
    code?: string;
    message: string;
    httpStatus?: number;
    errorName?: string;
    transportCode?: string;
  };
  startedAt?: number;
  submissionStartedAt?: number;
  timeoutAt?: number;
  finishedAt?: number;
  reconciliationStartedAt?: number;
  reconciliationDeadlineAt?: number;
  lastPollSucceededAt?: number;
  consecutivePollFailures?: number;
}

export interface GenerationAssetBinding {
  id: string;
  relativePath: string;
  fileName: string;
  contentType?: string;
}

export interface GenerationPromptLengthAudit {
  measuredLength: number;
  maximumLength?: number;
  unit: 'unicode_code_points';
  scope: 'string' | 'array_item' | 'array_joined' | 'array_unverified';
  source?:
    | 'aion_input_schema'
    | 'aion_parameter_schema'
    | 'aion_options'
    | 'manueval_compatibility';
  itemIndex?: number;
}

export interface GenerationPreflightIssue {
  code: string;
  message: string;
  field?: string;
  promptLength?: GenerationPromptLengthAudit;
}

export interface GenerationContractProposal {
  kind: 'prompt_rewrite' | 'keyframes_to_elements';
  prompt?: unknown;
  compiledInput?: Record<string, unknown>;
}

export interface GenerationContractFinding extends GenerationPreflightIssue {
  id: string;
  ruleId: string;
  source: 'mcp_revision_1813' | 'aion_live_config' | 'plugin_snapshot';
  sourceVersion: string;
  disposition: 'suggestion' | 'review_required' | 'force_required';
  proposal?: GenerationContractProposal;
}

export type GenerationCaseOverrideAction =
  | { action: 'set'; value: unknown }
  | { action: 'omit' };

export interface GenerationCaseInputOverrideV1 {
  version: 1;
  content?: Partial<Record<
    'prompt' | 'image_urls' | 'images' | 'elements' | 'audios',
    GenerationCaseOverrideAction
  >>;
  parameters?: Record<string, GenerationCaseOverrideAction>;
}

export interface GenerationPromptColumnOverrideV1 {
  version: 1;
  column: string;
}

export interface GenerationCaseReview {
  acceptedFindingIds?: string[];
  rejectedFindingIds?: string[];
  promptOverride?: unknown;
  promptColumnOverride?: GenerationPromptColumnOverrideV1;
  inputOverride?: GenerationCaseInputOverrideV1;
  finalAionRequest?: Record<string, unknown>;
  force?: {
    reason: string;
    duplicateBillingRiskConfirmed: boolean;
    ruleCodes?: string[];
  };
}

export interface GenerationPreflightCase {
  valid: boolean;
  generationType: string;
  errors: GenerationPreflightIssue[];
  warnings: GenerationPreflightIssue[];
  resolvedCase: Record<string, any>;
}

export interface GenerationPreflightResult {
  id: string;
  model: GenerationModelConfig;
  configFingerprint: string;
  validCount: number;
  invalidCount: number;
  total: number;
  selectionSummary?: GenerationSelectionSummary;
  batchWarnings?: GenerationPreflightIssue[];
  costEstimate: {
    known: boolean;
    totalCredits: number | null;
    unitCredits: number | null;
    unitLabel?: string;
    source?: unknown;
  };
  cases: GenerationPreflightCase[];
  requestHash: string;
  expiresAt: number;
}

export interface EvalDimension {
  id: string;
  name: string;
  description: string;
  type: 'star_rating' | 'radio_select' | 'text_input';
  options?: string[];
  weight?: number;
  scope?: DimensionScope;
  required?: boolean;
  scale?: ScoreScaleLevel[];
  aggregationRole?: DimensionAggregationRole;
}

export interface EvalTemplate {
  id: string;
  name: string;
  description: string;
  paradigm: EvalParadigm;
  dimensions: EvalDimension[];
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
}

export interface EvalTask {
  id: string;
  name: string;
  projectId?: string;
  datasetId: string;
  datasetBinding?: DatasetTaskBinding;
  templateId: string;
  evaluationConfig?: EvaluationConfig;
  models: { id: string; name: string }[];
  dimensionColumns?: string[];
  outputType: 'text' | 'image' | 'video' | 'audio' | 'markdown';
  inputType?: 'text' | 'text_image' | 'text_audio' | 'multi_turn' | 'other';
  assignees?: string[];
  progress?: Record<string, number>; // Progress per assignee
  reviewerNames?: Record<string, string>; // Resolved display name per progress/assignee key (e.g. Feishu userId -> 姓名)
  totalItems?: number; // Total number of items in the task
  status: 'draft' | 'active' | 'completed';
  externalResultsLink?: string; // Link to externally generated results
  hasImportedData?: boolean; // Flag to indicate if CSV data was imported
  hasTaskItemEdits?: boolean; // Local compatibility: prevents deleted task items from being regenerated from dataset fallback
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
}
