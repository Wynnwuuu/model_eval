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
}

export type EvalParadigm = 'GSB' | 'MOS' | 'Arena' | 'Arena-rank' | 'Pairwise' | 'RubricScore' | 'BenchmarkPreview';

export type EvaluationMethod = 'ab_preference' | 'pairwise' | 'direct_score' | 'rubric_score' | 'rank_order' | 'benchmark_preview';

export type TiePolicy = 'allow' | 'disallow';
export type PairwiseMode = 'all_pairs' | 'adjacent_pairs';
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
  pairContext?: {
    pairId?: string;
    originalItemId?: string;
    modelAId: string;
    modelAName: string;
    modelBId: string;
    modelBName: string;
  };
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
  validationSummary?: DatasetValidationSummary;
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
  updatedAt: number;
}

export type GenerationOutputModality = DatasetModality;
export type GenerationJobStatus = 'draft' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type GenerationItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GenerationSeedMode = 'fixed' | 'derive_from_case' | 'column';

export interface GenerationControlDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  defaultValue?: string | number;
  unit?: string;
}

export interface GenerationModelConfig {
  id: string;
  displayName: string;
  provider: string;
  outputModality: GenerationOutputModality;
  previewType: DatasetPreviewType;
  capabilities: string[];
  supportedAspectRatios?: string[];
  supportedResolutions?: string[];
  supportedDurations?: Array<string | number>;
  controls: GenerationControlDefinition[];
}

export interface GenerationInputMapping {
  promptColumn?: string;
  referenceImageColumns: string[];
  referenceAudioColumns: string[];
  startImageColumn?: string;
  endImageColumn?: string;
  lyricsOrDialogueColumn?: string;
  extraInputColumns: string[];
}

export interface DatasetGenerationJob {
  id: string;
  datasetId: string;
  datasetName?: string;
  datasetVersion?: number;
  modelConfig: GenerationModelConfig;
  targetColumn: string;
  inputMapping: GenerationInputMapping;
  defaultControls: Record<string, string | number>;
  perCaseControlColumns: Record<string, string>;
  seedMode: GenerationSeedMode;
  fixedSeed?: number;
  seedColumn?: string;
  status: GenerationJobStatus;
  total: number;
  succeeded: number;
  failed: number;
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
  status: GenerationItemStatus;
  requestId?: string;
  providerJobId?: string;
  resolvedInputs: Record<string, any>;
  resolvedControls: Record<string, any>;
  seed?: number;
  resultUrl?: string;
  resultText?: string;
  mediaType?: DatasetPreviewType;
  error?: {
    code?: string;
    message: string;
  };
  startedAt?: number;
  finishedAt?: number;
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
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
}
