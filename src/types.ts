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
  type: 'image' | 'video' | 'unknown';
  isSwapped?: boolean; // New: If true, UI displays B on left and A on right for blind testing
}

export type EvalParadigm = 'GSB' | 'MOS' | 'Arena' | 'Arena-rank';

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
  timestamp: number;
  user?: string; // Who voted
}

export type AppState = 'setup' | 'voting' | 'results' | 'analysis' | 'history';

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

export type SchemaFieldType = 'text' | 'image_url' | 'video_url' | 'chat_history';

export interface DatasetSchemaField {
  key: string;
  label: string;
  type: SchemaFieldType;
}

export interface EvalDataset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputSchema: DatasetSchemaField[];
  items: Record<string, any>[]; // The actual data rows
  inputType?: 'text' | 'text_image' | 'text_audio' | 'multi_turn' | 'other';
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EvalDimension {
  id: string;
  name: string;
  description: string;
  type: 'star_rating' | 'radio_select' | 'text_input';
  options?: string[];
  weight?: number;
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
  models: { id: string; name: string }[];
  dimensionColumns?: string[];
  outputType: 'text' | 'image' | 'video' | 'markdown';
  inputType?: 'text' | 'text_image' | 'text_audio' | 'multi_turn' | 'other';
  assignees?: string[];
  progress?: Record<string, number>; // Progress per assignee
  totalItems?: number; // Total number of items in the task
  status: 'draft' | 'active' | 'completed';
  externalResultsLink?: string; // Link to externally generated results
  hasImportedData?: boolean; // Flag to indicate if CSV data was imported
  creatorUid?: string;
  creatorName?: string;
  createdAt: number;
}
