import React, { useState, useEffect, useMemo } from 'react';
import { Upload, FileText, BarChart3, Users, AlertCircle, PlusCircle, Download, ArrowRight, Database, Loader2, ExternalLink, Layers } from 'lucide-react';
import { AggregatedResult, EvalParadigm, EvaluationConfig, EvalTask, EvalTemplate, EvaluationItem, EvaluationProject, ModelOutput, RankingEntry, VoteRecord, VoteType } from '../types';
import { ArenaRankPromptItem, calculateArenaRankCaseSummaries, calculateArenaRankModelStats, formatConsensusRanking, formatRanking, getArenaRankModelOutputUrl, getModelOutputsForItem, getRankingTieSummary, isArenaRankVote, normalizeRanking, resolveEvaluationItemPrompt, sortRanking, validateRanking } from '../rankingUtils';
import { VIDEO_EXTENSIONS } from '../constants';
import { db, handlePersistenceError } from '../auth';
import { collection, getDocs, query, orderBy } from '../datastore';
import ArenaRankVideoPreviewList from './ArenaRankVideoPreviewList';
import MediaRenderer from './MediaRenderer';
import DimensionChips from './DimensionChips';
import ResultsInsightsScreen from './ResultsInsightsScreen';
import ScoreInsightsScreen from './ScoreInsightsScreen';
import { calculateRankDimensionSummaries, calculateVoteDimensionSummaries, getDimensionColumnsForCsv, getDimensionCsvValues, getDimensionValuesForItem, getDimensionValuesFromRecord } from '../dimensionUtils';
import Papa from 'papaparse';
import { getDefaultEvaluationConfig, getParadigmFromMethod, isPairwiseMethod, isScoreMethod, normalizeEvaluationConfig } from '../evaluationMethods';
import { subscribeProjects } from '../features/projects/api';
import { subscribeTemplates } from '../features/templates/api';
import { loadTaskItems, loadTaskVotes, USE_TASK_API_BACKEND } from '../features/tasks/api';
import { subscribeTasks } from '../features/tasks/api';

interface AnalysisScreenProps {
  onBack: () => void;
  onGoToDashboard?: () => void;
  initialProjectId?: string;
  initialMaterialId?: string;
  initialStatusFilter?: EvalTask['status'];
}

const normalizeCsvHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');

interface AnalysisModelNames {
  a: string;
  b: string;
}

interface AnalysisVoteRow {
  itemId: string;
  vote: VoteType;
  timestamp: number;
  user: string;
}

interface CsvModelData {
  names: AnalysisModelNames;
  urls: AnalysisModelNames;
}

interface ImportedMaterialResult {
  task: EvalTask;
  paradigm: EvalParadigm;
  evaluationConfig: EvaluationConfig;
  modelNames: AnalysisModelNames;
  modelList: { id: string; name: string }[];
  aggregatedData: AggregatedResult[];
  analysisItems: EvaluationItem[];
  voteRows: AnalysisVoteRow[];
  rankVotes: VoteRecord[];
  rankItems: ArenaRankPromptItem[];
  methodVotes: VoteRecord[];
  voters: Set<string>;
}

const DEFAULT_ANALYSIS_MODELS: AnalysisModelNames = { a: 'Model A', b: 'Model B' };

const taskStatusLabel = (status?: EvalTask['status']) => {
  if (status === 'active') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'draft') return '草稿';
  return status || '未知';
};

const ITEM_ID_KEYS = ['ItemID', 'Item ID', 'item_id', 'id', '项目 ID', '项目ID'];
const PROMPT_KEYS = ['Prompt', 'prompt', 'Video Prompt', 'input', 'Input', 'question', 'Question', '提示词'];
const USER_KEYS = ['User', 'user', 'Voter', 'voter', 'Evaluator', '评测人', '投票人'];
const TIMESTAMP_KEYS = ['Timestamp', 'timestamp', 'Time', 'time', 'CreatedAt', 'created_at', '时间'];
const VOTE_SIDE_KEYS = ['VoteSide', 'WinnerSide', 'Winner', 'Result', 'Vote', 'vote', '获胜者', '结果'];
const VOTERS_KEYS = ['Voters', 'voters', '参与者', '投票人列表'];
const REFERENCE_URL_KEYS = ['ReferenceURLs', 'References', 'referenceUrls', 'Reference URLs', '参考链接', '参考图'];
const MODEL_A_NAME_KEYS = ['ModelA_Name', 'Model A Name', 'model_a_name', 'A_Model_Name', '模型A名称', '模型 A 名称'];
const MODEL_B_NAME_KEYS = ['ModelB_Name', 'Model B Name', 'model_b_name', 'B_Model_Name', '模型B名称', '模型 B 名称'];
const MODEL_A_URL_KEYS = ['ModelA_URL', 'Model A URL', 'modelA_Url', 'model_a_url', 'A_URL', 'Model A', '模型A链接', '模型A视频链接', '模型 A'];
const MODEL_B_URL_KEYS = ['ModelB_URL', 'Model B URL', 'modelB_Url', 'model_b_url', 'B_URL', 'Model B', '模型B链接', '模型B视频链接', '模型 B'];

const findCsvKey = (keys: string[], candidates: string[]) => {
  const normalizedCandidates = new Set(candidates.map(normalizeCsvHeader));
  return keys.find(key => normalizedCandidates.has(normalizeCsvHeader(key)));
};

const getCsvField = (row: any, keys: string[], candidates: string[]) => {
  const key = findCsvKey(keys, candidates);
  return {
    key,
    value: key ? String(row[key] ?? '').trim() : ''
  };
};

const splitListField = (value: string) =>
  value
    .split(/\s*\|\s*|\s*;\s*/)
    .map(part => part.trim())
    .filter(Boolean);

const parseCsvTimestamp = (value: string) => {
  if (!value) return Date.now();
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const getTaskModelNames = (task?: EvalTask): AnalysisModelNames => ({
  a: task?.models?.[0]?.name || DEFAULT_ANALYSIS_MODELS.a,
  b: task?.models?.[1]?.name || DEFAULT_ANALYSIS_MODELS.b
});

const inferModelNameFromUrlKey = (key: string | undefined, genericCandidates: string[]) => {
  if (!key) return '';
  const genericKeys = new Set(genericCandidates.map(normalizeCsvHeader));
  return genericKeys.has(normalizeCsvHeader(key)) ? '' : key;
};

const resolveCsvModelData = (row: any, keys: string[], task?: EvalTask): CsvModelData => {
  const taskAName = task?.models?.[0]?.name || '';
  const taskBName = task?.models?.[1]?.name || '';
  const aName = getCsvField(row, keys, MODEL_A_NAME_KEYS).value;
  const bName = getCsvField(row, keys, MODEL_B_NAME_KEYS).value;
  const aUrl = getCsvField(row, keys, [...MODEL_A_URL_KEYS, taskAName].filter(Boolean)).value;
  const bUrl = getCsvField(row, keys, [...MODEL_B_URL_KEYS, taskBName].filter(Boolean)).value;
  const aUrlKey = getCsvField(row, keys, [...MODEL_A_URL_KEYS, taskAName].filter(Boolean)).key;
  const bUrlKey = getCsvField(row, keys, [...MODEL_B_URL_KEYS, taskBName].filter(Boolean)).key;

  return {
    names: {
      a: aName || taskAName || inferModelNameFromUrlKey(aUrlKey, MODEL_A_URL_KEYS) || DEFAULT_ANALYSIS_MODELS.a,
      b: bName || taskBName || inferModelNameFromUrlKey(bUrlKey, MODEL_B_URL_KEYS) || DEFAULT_ANALYSIS_MODELS.b
    },
    urls: {
      a: aUrl,
      b: bUrl
    }
  };
};

const normalizeVoteSide = (value: any, modelNames: AnalysisModelNames): VoteType | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeCsvHeader(raw);

  if (['a', 'modela', '模型a'].includes(normalized)) return 'A';
  if (['b', 'modelb', '模型b'].includes(normalized)) return 'B';
  if (['tie', 'draw', 'equal', 'same', '平局', '一样', '相同'].includes(normalized) || raw.includes('平')) return 'Tie';
  if (normalized === normalizeCsvHeader(modelNames.a)) return 'A';
  if (normalized === normalizeCsvHeader(modelNames.b)) return 'B';
  return null;
};

const parseCsvCount = (row: any, keys: string[], candidates: string[]) => {
  const { key, value } = getCsvField(row, keys, candidates);
  if (!key || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getCsvAggregateCounts = (row: any, keys: string[]) => {
  const a = parseCsvCount(row, keys, ['Votes_A', 'A', 'A_Count', 'ModelA_Votes', '模型A票数']);
  const b = parseCsvCount(row, keys, ['Votes_B', 'B', 'B_Count', 'ModelB_Votes', '模型B票数']);
  const tie = parseCsvCount(row, keys, ['Votes_Tie', 'Tie', 'Tie_Count', '平局票数']);
  if (a === null && b === null && tie === null) return null;
  return { A: a || 0, B: b || 0, Tie: tie || 0 };
};

const getCsvPrompt = (row: any, keys: string[], itemId: string) => {
  const explicitPrompt = getCsvField(row, keys, PROMPT_KEYS).value;
  if (explicitPrompt) return explicitPrompt;
  return resolveEvaluationItemPrompt({ id: itemId, inputs: row, originalData: row });
};

const getCsvReferenceUrls = (row: any, keys: string[]) => {
  const value = getCsvField(row, keys, REFERENCE_URL_KEYS).value;
  return value ? splitListField(value) : [];
};

const normalizeOutputMediaType = (outputType: EvalTask['outputType'] | undefined, urls: string[]): EvaluationItem['type'] => {
  if (outputType === 'video' || outputType === 'image') return outputType;
  const firstUrl = urls.find(Boolean);
  if (!firstUrl) return 'unknown';
  const cleanUrl = firstUrl.trim().split('?')[0].split('#')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => cleanUrl.endsWith(`.${ext}`)) ? 'video' : 'image';
};

const getRankVideoUrlFromRow = (row: any, keys: string[], rank: number): string => {
  const candidates = new Set([
    `排名${rank}视频链接`,
    `rank_${rank}_video_url`,
    `rank_${rank}_url`,
    `ranking_${rank}_video_url`,
    `ranking_${rank}_url`
  ].map(normalizeCsvHeader));
  const key = keys.find(candidate => candidates.has(normalizeCsvHeader(candidate)));
  const value = key ? row[key] : '';
  return String(value ?? '').trim();
};

const buildModelOutputsFromRanking = (row: any, keys: string[], ranking: RankingEntry[]): ModelOutput[] =>
  sortRanking(ranking)
    .map((entry, index) => ({
      modelId: entry.modelId,
      modelName: entry.modelName,
      // Video-link columns are positional for backward compatibility. With
      // ties, two entries can share a rank but still occupy separate columns.
      url: getRankVideoUrlFromRow(row, keys, index + 1)
    }))
    .filter(output => output.url);

const mergeModelOutputs = (existing: ModelOutput[] = [], incoming: ModelOutput[] = []): ModelOutput[] => {
  const merged = new Map<string, ModelOutput>();
  const addOutput = (output: ModelOutput) => {
    if (!output.url) return;
    const key = `${output.modelId || ''}::${output.modelName || ''}`.toLowerCase();
    if (!merged.has(key)) merged.set(key, output);
  };

  existing.forEach(addOutput);
  incoming.forEach(addOutput);
  return Array.from(merged.values());
};

const buildAnalysisItemFromCsv = (
  itemId: string,
  prompt: string,
  modelData: CsvModelData,
  row: any,
  outputType?: EvalTask['outputType'],
  dimensionColumns: string[] = []
): EvaluationItem => ({
  id: itemId,
  prompt,
  inputs: row,
  modelA_Url: modelData.urls.a,
  modelB_Url: modelData.urls.b,
  modelOutputs: [
    { modelId: 'model-a', modelName: modelData.names.a, url: modelData.urls.a },
    { modelId: 'model-b', modelName: modelData.names.b, url: modelData.urls.b }
  ].filter(output => output.url),
  dimensionValues: getDimensionValuesFromRecord(row, dimensionColumns),
  referenceUrls: getCsvReferenceUrls(row, Object.keys(row)),
  type: normalizeOutputMediaType(outputType, [modelData.urls.a, modelData.urls.b])
});

const upsertAnalysisItem = (itemsById: Map<string, EvaluationItem>, incoming: EvaluationItem) => {
  const existing = itemsById.get(incoming.id);
  if (!existing) {
    itemsById.set(incoming.id, incoming);
    return;
  }

  itemsById.set(incoming.id, {
    ...existing,
    prompt: existing.prompt || incoming.prompt,
    inputs: existing.inputs || incoming.inputs,
    modelA_Url: existing.modelA_Url || incoming.modelA_Url,
    modelB_Url: existing.modelB_Url || incoming.modelB_Url,
    modelOutputs: mergeModelOutputs(existing.modelOutputs, incoming.modelOutputs),
    dimensionValues: { ...(incoming.dimensionValues || {}), ...(existing.dimensionValues || {}) },
    referenceUrls: existing.referenceUrls?.length ? existing.referenceUrls : incoming.referenceUrls,
    type: existing.type !== 'unknown' ? existing.type : incoming.type
  });
};

const getWinnerSide = (votes: AggregatedResult['votes']): VoteType => {
  const maxVotes = Math.max(votes.A, votes.B, votes.Tie);
  const winners = [
    votes.A === maxVotes ? 'A' : null,
    votes.B === maxVotes ? 'B' : null,
    votes.Tie === maxVotes ? 'Tie' : null
  ].filter(Boolean);

  return winners.length === 1 && winners[0] !== 'Tie' ? winners[0] as VoteType : 'Tie';
};

const getWinnerLabel = (winner: VoteType, modelNames: AnalysisModelNames) => {
  if (winner === 'A') return modelNames.a;
  if (winner === 'B') return modelNames.b;
  return '平局';
};

const formatRatio = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator).toFixed(4) : '';

const getCaseModelOutputs = (item: EvaluationItem | undefined, modelNames: AnalysisModelNames) => {
  if (!item) {
    return {
      a: { modelName: modelNames.a, url: '' },
      b: { modelName: modelNames.b, url: '' }
    };
  }

  const outputs = getModelOutputsForItem(item, [
    { id: 'model-a', name: modelNames.a },
    { id: 'model-b', name: modelNames.b }
  ]);
  const findByName = (name: string) => outputs.find(output => normalizeCsvHeader(output.modelName) === normalizeCsvHeader(name));
  const outputA = findByName(modelNames.a) || outputs[0];
  const outputB = findByName(modelNames.b) || outputs[1];

  return {
    a: { modelName: outputA?.modelName || modelNames.a, url: outputA?.url || item.modelA_Url || '' },
    b: { modelName: outputB?.modelName || modelNames.b, url: outputB?.url || item.modelB_Url || '' }
  };
};

const AnalysisMediaPreview: React.FC<{
  url: string;
  mediaType?: EvaluationItem['type'];
  label: string;
}> = ({ url, mediaType, label }) => (
  <div className="w-[184px] overflow-hidden rounded-lg border border-white/10 bg-white/5">
    <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-white/10">
      <span className="truncate text-xs font-semibold text-slate-200" title={label}>{label}</span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-white transition-colors"
          title="打开媒体链接"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
    <div className="h-[104px] bg-black/30">
      {url ? (
        <MediaRenderer
          url={url}
          isActive={false}
          forceType={mediaType === 'video' || mediaType === 'image' ? mediaType : undefined}
          videoPreload="metadata"
          className="rounded-none border-0 shadow-none"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center px-3 text-center text-xs text-slate-500">
          暂无媒体链接
        </div>
      )}
    </div>
  </div>
);

const UNASSIGNED_PROJECT_ID = '__unassigned_project__';

const AnalysisScreen: React.FC<AnalysisScreenProps> = ({
  onBack,
  onGoToDashboard,
  initialProjectId,
  initialMaterialId,
  initialStatusFilter
}) => {
  const [aggregatedData, setAggregatedData] = useState<AggregatedResult[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [uniqueVoters, setUniqueVoters] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [projects, setProjects] = useState<EvaluationProject[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const [selectedMaterialScope, setSelectedMaterialScope] = useState<string>(initialMaterialId ? `material:${initialMaterialId}` : '');
  const [statusFilter, setStatusFilter] = useState<EvalTask['status'] | 'all'>(initialStatusFilter || 'all');
  const [loadedScopeKey, setLoadedScopeKey] = useState('');
  const [loadingResults, setLoadingResults] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<EvalParadigm | null>(null);
  const [rankVotes, setRankVotes] = useState<VoteRecord[]>([]);
  const [rankItems, setRankItems] = useState<ArenaRankPromptItem[]>([]);
  const [analysisItems, setAnalysisItems] = useState<EvaluationItem[]>([]);
  const [analysisModels, setAnalysisModels] = useState<AnalysisModelNames>(DEFAULT_ANALYSIS_MODELS);
  const [analysisModelList, setAnalysisModelList] = useState<{ id: string; name: string }[]>([]);
  const [analysisEvaluationConfig, setAnalysisEvaluationConfig] = useState<EvaluationConfig | null>(null);
  const [methodVotes, setMethodVotes] = useState<VoteRecord[]>([]);
  const [analysisVoteRows, setAnalysisVoteRows] = useState<AnalysisVoteRow[]>([]);
  const [showInsights, setShowInsights] = useState(true);

  useEffect(() => {
    setLoadingTasks(true);
    const unsubscribers = [
      subscribeTasks({}, (nextTasks) => {
        setTasks(nextTasks);
        setLoadingTasks(false);
      }, (err) => {
        handlePersistenceError(err, 'list', 'evalTasks');
        setLoadingTasks(false);
      }),
      subscribeTemplates(setTemplates, (err) => handlePersistenceError(err, 'list', 'evalTemplates')),
      subscribeProjects(setProjects, (err) => handlePersistenceError(err, 'list', 'projects')),
    ];

    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, []);

  const getMaterialEvaluationConfig = (task?: EvalTask): EvaluationConfig => {
    const template = templates.find(item => item.id === task?.templateId);
    return normalizeEvaluationConfig(task, template);
  };

  const getMaterialParadigm = (task?: EvalTask): EvalParadigm => {
    const config = getMaterialEvaluationConfig(task);
    return getParadigmFromMethod(config.method);
  };

  const getMaterialSignature = (task: EvalTask) => {
    const paradigm = getMaterialParadigm(task);
    const modelSignature = (task.models || [])
      .map(model => model.name || model.id)
      .join('|') || 'Model A|Model B';
    return `${paradigm}::${task.outputType || 'unknown'}::${modelSignature}`;
  };

  const getMaterialGroupLabel = (task: EvalTask) => {
    const paradigm = getMaterialParadigm(task);
    const modelNames = (task.models || []).map(model => model.name).filter(Boolean).join(' / ');
    return `${paradigm} · ${modelNames || '未命名模型组'}`;
  };

  const projectOptions = useMemo(() => {
    const projectIdsWithMaterials = new Set(tasks.map(task => task.projectId).filter(Boolean) as string[]);
    const options = projects
      .filter(project => projectIdsWithMaterials.has(project.id) || project.id === initialProjectId)
      .map(project => ({ id: project.id, name: project.name }));

    projectIdsWithMaterials.forEach(projectId => {
      if (!options.some(option => option.id === projectId)) {
        options.push({ id: projectId, name: `未命名项目 ${projectId.slice(0, 6)}` });
      }
    });

    if (tasks.some(task => !task.projectId)) {
      options.push({ id: UNASSIGNED_PROJECT_ID, name: '未归属项目' });
    }

    return options;
  }, [initialProjectId, projects, tasks]);

  const projectMaterials = useMemo(() => {
    const scoped = selectedProjectId === UNASSIGNED_PROJECT_ID
      ? tasks.filter(task => !task.projectId)
      : tasks.filter(task => task.projectId === selectedProjectId);

    return statusFilter === 'all'
      ? scoped
      : scoped.filter(task => task.status === statusFilter);
  }, [selectedProjectId, statusFilter, tasks]);

  const materialGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; tasks: EvalTask[] }>();
    projectMaterials.forEach(task => {
      const key = getMaterialSignature(task);
      const existing = groups.get(key) || { key, label: getMaterialGroupLabel(task), tasks: [] };
      existing.tasks.push(task);
      groups.set(key, existing);
    });

    return Array.from(groups.values())
      .sort((a, b) => b.tasks.length - a.tasks.length || a.label.localeCompare(b.label));
  }, [projectMaterials, templates]);

  const selectedMaterialIds = useMemo(() => {
    if (!selectedMaterialScope) return [];
    if (selectedMaterialScope.startsWith('material:')) {
      const materialId = selectedMaterialScope.replace('material:', '');
      return projectMaterials.some(task => task.id === materialId) ? [materialId] : [];
    }
    if (selectedMaterialScope.startsWith('group:')) {
      const groupKey = selectedMaterialScope.replace('group:', '');
      return materialGroups.find(group => group.key === groupKey)?.tasks.map(task => task.id) || [];
    }
    return [];
  }, [materialGroups, projectMaterials, selectedMaterialScope]);

  const selectedProjectName = selectedProjectId === UNASSIGNED_PROJECT_ID
    ? '未归属项目'
    : projects.find(project => project.id === selectedProjectId)?.name || '项目汇总洞察';

  useEffect(() => {
    if (loadingTasks || selectedProjectId || projectOptions.length === 0) return;
    const fallbackProjectId = initialProjectId && projectOptions.some(project => project.id === initialProjectId)
      ? initialProjectId
      : projectOptions[0].id;
    setSelectedProjectId(fallbackProjectId);
  }, [initialProjectId, loadingTasks, projectOptions, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const materialOption = initialMaterialId && projectMaterials.some(task => task.id === initialMaterialId)
      ? `material:${initialMaterialId}`
      : '';
    const defaultScope = materialOption || (materialGroups[0] ? `group:${materialGroups[0].key}` : '');
    if (!defaultScope) {
      setSelectedMaterialScope('');
      return;
    }
    const isValidScope = selectedMaterialScope.startsWith('material:')
      ? projectMaterials.some(task => task.id === selectedMaterialScope.replace('material:', ''))
      : materialGroups.some(group => `group:${group.key}` === selectedMaterialScope);
    if (!isValidScope) setSelectedMaterialScope(defaultScope);
  }, [initialMaterialId, materialGroups, projectMaterials, selectedMaterialScope, selectedProjectId]);

  useEffect(() => {
    if (selectedTaskId && projectMaterials.some(task => task.id === selectedTaskId)) return;
    setSelectedTaskId(selectedMaterialIds[0] || '');
  }, [projectMaterials, selectedMaterialIds, selectedTaskId]);

  const loadMaterialResult = async (materialId: string): Promise<ImportedMaterialResult> => {
    const selectedTask = tasks.find(task => task.id === materialId);
    if (!selectedTask) {
      throw new Error('未找到评测物料。');
    }

    const selectedEvaluationConfig = getMaterialEvaluationConfig(selectedTask);
    const selectedParadigm = getParadigmFromMethod(selectedEvaluationConfig.method);
    const userVoteGroups = USE_TASK_API_BACKEND ? await loadTaskVotes(materialId) : null;
    const taskModelNames = getTaskModelNames(selectedTask);
    const taskModelList = selectedTask.models?.length ? selectedTask.models : [
      { id: 'model-a', name: taskModelNames.a },
      { id: 'model-b', name: taskModelNames.b }
    ];
    const sourceItems = USE_TASK_API_BACKEND
      ? await loadTaskItems(selectedTask)
      : (await getDocs(collection(db, 'evalTasks', materialId, 'items'))).docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      } as EvaluationItem));
    const importedAnalysisItems = sourceItems.map(item => {
      const modelOutputs = getModelOutputsForItem(item, taskModelList);
      return {
        ...item,
        prompt: resolveEvaluationItemPrompt(item),
        modelOutputs,
        dimensionValues: getDimensionValuesForItem(item as any, selectedTask.dimensionColumns || []),
        type: normalizeOutputMediaType(selectedTask.outputType, [item.modelA_Url, item.modelB_Url, ...modelOutputs.map(output => output.url)])
      } as EvaluationItem;
    });

    if (selectedParadigm === 'Arena-rank') {
      const importedRankVotes: VoteRecord[] = [];
      const voters = new Set<string>();

      const voteGroups = userVoteGroups || [];
      if (!USE_TASK_API_BACKEND) {
        const votesRef = collection(db, 'evalTasks', materialId, 'userVotes');
        const snapshot = await getDocs(votesRef);
        snapshot.forEach(docSnap => voteGroups.push({ user: docSnap.id, votes: docSnap.data().votes || [] }));
      }

      voteGroups.forEach(({ user, votes: userVotes }) => {

        userVotes.forEach((v: VoteRecord) => {
          if (!v.itemId || !isArenaRankVote(v)) return;
          importedRankVotes.push({ ...v, user: v.user || user });
          voters.add(user);
        });
      });

      return {
        task: selectedTask,
        paradigm: selectedParadigm,
        evaluationConfig: selectedEvaluationConfig,
        modelNames: DEFAULT_ANALYSIS_MODELS,
        modelList: taskModelList,
        aggregatedData: [],
        analysisItems: [],
        voteRows: [],
        rankVotes: importedRankVotes,
        rankItems: importedAnalysisItems as ArenaRankPromptItem[],
        methodVotes: [],
        voters
      };
    }

    if (isScoreMethod(selectedEvaluationConfig) || isPairwiseMethod(selectedEvaluationConfig)) {
      const importedMethodVotes: VoteRecord[] = [];
      const voters = new Set<string>();

      const voteGroups = userVoteGroups || [];
      if (!USE_TASK_API_BACKEND) {
        const votesRef = collection(db, 'evalTasks', materialId, 'userVotes');
        const snapshot = await getDocs(votesRef);
        snapshot.forEach(docSnap => voteGroups.push({ user: docSnap.id, votes: docSnap.data().votes || [] }));
      }

      voteGroups.forEach(({ user, votes: userVotes }) => {

        userVotes.forEach((v: VoteRecord) => {
          if (!v.itemId) return;
          if (isScoreMethod(selectedEvaluationConfig) && !v.rubricResponses) return;
          if (isPairwiseMethod(selectedEvaluationConfig) && !v.pairContext) return;
          importedMethodVotes.push({ ...v, method: v.method || selectedEvaluationConfig.method, user: v.user || user });
          voters.add(user);
        });
      });

      return {
        task: selectedTask,
        paradigm: selectedParadigm,
        evaluationConfig: selectedEvaluationConfig,
        modelNames: taskModelNames,
        modelList: taskModelList,
        aggregatedData: [],
        analysisItems: importedAnalysisItems,
        voteRows: [],
        rankVotes: [],
        rankItems: [],
        methodVotes: importedMethodVotes,
        voters
      };
    }

    const newAggregated: Record<string, AggregatedResult> = {};
    const importedVoteRows: AnalysisVoteRow[] = [];
    const itemById = new Map(importedAnalysisItems.map(item => [item.id, item]));
    const voters = new Set<string>();

    const voteGroups = userVoteGroups || [];
    if (!USE_TASK_API_BACKEND) {
      const votesRef = collection(db, 'evalTasks', materialId, 'userVotes');
      const snapshot = await getDocs(votesRef);
      snapshot.forEach(docSnap => voteGroups.push({ user: docSnap.id, votes: docSnap.data().votes || [] }));
    }

    voteGroups.forEach(({ user, votes: userVotes }) => {

      userVotes.forEach((v: any) => {
        const itemId = v.itemId;
        const winner = normalizeVoteSide(v.vote, taskModelNames);

        if (!itemId || !winner) return;

        voters.add(user);
        const sourceItem = itemById.get(itemId);

        if (!newAggregated[itemId]) {
          newAggregated[itemId] = {
            itemId,
            prompt: sourceItem ? resolveEvaluationItemPrompt(sourceItem) : '',
            dimensionValues: getDimensionValuesForItem(sourceItem as any, selectedTask.dimensionColumns || []),
            votes: { A: 0, B: 0, Tie: 0 },
            voters: []
          };
        } else if (!newAggregated[itemId].prompt && sourceItem) {
          newAggregated[itemId].prompt = resolveEvaluationItemPrompt(sourceItem);
          newAggregated[itemId].dimensionValues = newAggregated[itemId].dimensionValues || getDimensionValuesForItem(sourceItem as any, selectedTask.dimensionColumns || []);
        }

        if (winner === 'A') newAggregated[itemId].votes.A++;
        else if (winner === 'B') newAggregated[itemId].votes.B++;
        else if (winner === 'Tie') newAggregated[itemId].votes.Tie++;

        newAggregated[itemId].voters.push(user);
        importedVoteRows.push({
          itemId,
          vote: winner,
          timestamp: Number(v.timestamp) || Date.now(),
          user: v.user || user
        });
      });
    });

    return {
      task: selectedTask,
      paradigm: selectedParadigm,
      evaluationConfig: selectedEvaluationConfig,
      modelNames: taskModelNames,
      modelList: taskModelList,
      aggregatedData: Object.values(newAggregated),
      analysisItems: importedAnalysisItems,
      voteRows: importedVoteRows,
      rankVotes: [],
      rankItems: [],
      methodVotes: [],
      voters
    };
  };

  const hasAnalyzableMaterialResult = (result: ImportedMaterialResult) => {
    if (result.paradigm === 'Arena-rank') return result.rankVotes.length > 0;
    if (isScoreMethod(result.evaluationConfig) || isPairwiseMethod(result.evaluationConfig)) {
      return result.methodVotes.length > 0;
    }
    return result.aggregatedData.some(item => item.votes.A + item.votes.B + item.votes.Tie > 0);
  };

  const applyImportedMaterialResults = (results: ImportedMaterialResult[]) => {
    setAggregatedData([]);
    setRankVotes([]);
    setRankItems([]);
    setAnalysisItems([]);
    setAnalysisVoteRows([]);
    setMethodVotes([]);
    setAnalysisModelList([]);
    setAnalysisEvaluationConfig(null);
    setAnalysisMode(null);

    if (results.length === 0) {
      setError('请选择至少一份评测物料。');
      return;
    }

    const paradigms = new Set(results.map(result => result.paradigm));
    if (paradigms.size > 1) {
      setError('所选评测物料包含不同评测范式，请切换到自动分组或单个评测物料后再查看。');
      return;
    }

    const selectedParadigm = results[0].paradigm;
    const selectedConfig = results[0].evaluationConfig;
    const voters = new Set<string>();
    results.forEach(result => result.voters.forEach(voter => voters.add(voter)));

    if (isScoreMethod(selectedConfig) || isPairwiseMethod(selectedConfig)) {
      const itemsById = new Map<string, EvaluationItem>();
      const modelMap = new Map<string, { id: string; name: string }>();
      results.forEach(result => {
        result.analysisItems.forEach(item => upsertAnalysisItem(itemsById, item));
        result.modelList.forEach(model => modelMap.set(model.id, model));
      });
      const mergedMethodVotes = results.flatMap(result => result.methodVotes);
      if (mergedMethodVotes.length === 0) {
        setError('所选评测物料暂无可分析的评分/对战结果。');
      } else {
        setAnalysisItems(Array.from(itemsById.values()));
        setMethodVotes(mergedMethodVotes);
        setAnalysisModelList(Array.from(modelMap.values()));
        setAnalysisModels(results[0].modelNames);
        setAnalysisEvaluationConfig(selectedConfig);
        setUniqueVoters(voters);
        setAnalysisMode(selectedParadigm);
      }
      return;
    }

    if (selectedParadigm === 'Arena-rank') {
      const rankItemsById = new Map<string, ArenaRankPromptItem>();
      results.forEach(result => {
        result.rankItems.forEach(item => {
          const existing = rankItemsById.get(item.id);
          if (!existing) {
            rankItemsById.set(item.id, item);
            return;
          }
          rankItemsById.set(item.id, {
            ...existing,
            prompt: existing.prompt || item.prompt,
            dimensionValues: { ...(item.dimensionValues || {}), ...(existing.dimensionValues || {}) },
            modelOutputs: mergeModelOutputs(existing.modelOutputs, item.modelOutputs) as ModelOutput[]
          });
        });
      });

      const mergedRankVotes = results.flatMap(result => result.rankVotes);
      if (mergedRankVotes.length === 0) {
        setError('所选评测物料暂无排名结果。');
      } else {
        setRankVotes(mergedRankVotes);
        setRankItems(Array.from(rankItemsById.values()));
        setAggregatedData([]);
        setAnalysisItems([]);
        setAnalysisVoteRows([]);
        setMethodVotes([]);
        setAnalysisModelList(results[0].modelList);
        setAnalysisEvaluationConfig(selectedConfig);
        setAnalysisModels(DEFAULT_ANALYSIS_MODELS);
        setUniqueVoters(voters);
        setAnalysisMode('Arena-rank');
      }
      return;
    }

    const aggregatedById = new Map<string, AggregatedResult>();
    const itemsById = new Map<string, EvaluationItem>();
    const voteRows = results.flatMap(result => result.voteRows);

    results.forEach(result => {
      result.analysisItems.forEach(item => upsertAnalysisItem(itemsById, item));
      result.aggregatedData.forEach(item => {
        const existing = aggregatedById.get(item.itemId);
        if (!existing) {
          aggregatedById.set(item.itemId, {
            ...item,
            votes: { ...item.votes },
            voters: [...item.voters]
          });
          return;
        }

        existing.votes.A += item.votes.A;
        existing.votes.B += item.votes.B;
        existing.votes.Tie += item.votes.Tie;
        existing.voters = Array.from(new Set([...existing.voters, ...item.voters]));
        existing.prompt = existing.prompt || item.prompt;
        existing.dimensionValues = existing.dimensionValues || item.dimensionValues;
      });
    });

    const mergedAggregatedData = Array.from(aggregatedById.values());
    if (mergedAggregatedData.length === 0 || mergedAggregatedData.every(item => item.votes.A + item.votes.B + item.votes.Tie === 0)) {
      setError('所选评测物料暂无评测结果。');
    } else {
      setAggregatedData(mergedAggregatedData);
      setRankVotes([]);
      setRankItems([]);
      setAnalysisItems(Array.from(itemsById.values()));
      setAnalysisModels(results[0].modelNames);
      setAnalysisModelList(results[0].modelList);
      setAnalysisEvaluationConfig(selectedConfig);
      setAnalysisVoteRows(voteRows);
      setMethodVotes([]);
      setUniqueVoters(voters);
      setAnalysisMode(selectedParadigm);
    }
  };

  const handleImportFromPlatform = async (materialIds: string[] = selectedMaterialIds) => {
    if (materialIds.length === 0) return;
    setLoadingResults(true);
    setError(null);
    try {
      const loadedResults = await Promise.all(materialIds.map(materialId => loadMaterialResult(materialId)));
      const shouldSkipEmptyMaterials = statusFilter === 'all' && materialIds.length > 1;
      const results = shouldSkipEmptyMaterials
        ? loadedResults.filter(hasAnalyzableMaterialResult)
        : loadedResults;

      if (shouldSkipEmptyMaterials && results.length === 0) {
        applyImportedMaterialResults([]);
        setError('当前范围内的评测物料还没有可分析结果。默认已包含全部状态；可切换到单个物料查看具体状态，或完成评测后再刷新洞察。');
        setLoadedScopeKey(`${selectedProjectId}|${statusFilter}|${selectedMaterialScope}|${materialIds.join('|')}`);
        return;
      }

      applyImportedMaterialResults(results);
      setTotalFiles(0);
      setSelectedTaskId(results[0]?.task.id || materialIds[0] || '');
      setShowInsights(true);
      setLoadedScopeKey(`${selectedProjectId}|${statusFilter}|${selectedMaterialScope}|${materialIds.join('|')}`);
    } catch (err: any) {
      handlePersistenceError(err, 'list', `evalTasks/${materialIds.join(',')}/userVotes`);
    } finally {
      setLoadingResults(false);
    }
  };

  useEffect(() => {
    if (loadingTasks || selectedMaterialIds.length === 0) return;
    const scopeKey = `${selectedProjectId}|${statusFilter}|${selectedMaterialScope}|${selectedMaterialIds.join('|')}`;
    if (loadedScopeKey === scopeKey) return;
    handleImportFromPlatform(selectedMaterialIds);
  }, [loadedScopeKey, loadingTasks, selectedMaterialIds, selectedMaterialScope, selectedProjectId, statusFilter]);

  const parseRankingRow = (row: any, keys: string[], expectedModels: Array<{ id: string; name: string }> = []): RankingEntry[] => {
    const aliases = new Map<string, { id: string; name: string }>();
    expectedModels.forEach(model => {
      aliases.set(model.id.trim().toLowerCase(), model);
      aliases.set(model.name.trim().toLowerCase(), model);
    });
    const canonicalizeModels = (ranking: RankingEntry[]) => ranking.map(entry => {
      const matched = aliases.get(entry.modelId.trim().toLowerCase()) || aliases.get(entry.modelName.trim().toLowerCase());
      return matched ? { ...entry, modelId: matched.id, modelName: matched.name } : entry;
    });
    const expectedModelIds = expectedModels.map(model => model.id);
    const rankingJsonKey = keys.find(k => k.toLowerCase() === 'ranking_json' || k.toLowerCase() === 'ranking');
    if (rankingJsonKey && row[rankingJsonKey]) {
      try {
        const parsed = JSON.parse(row[rankingJsonKey]);
        if (Array.isArray(parsed)) {
          const validation = validateRanking(canonicalizeModels(parsed
            .filter(entry => entry.modelId && entry.rank)
            .map(entry => ({
              modelId: String(entry.modelId),
              modelName: String(entry.modelName || entry.modelId),
              rank: Number(entry.rank)
            }))), expectedModelIds);
          if (!validation.valid) {
            console.warn('Invalid ranking_json row:', validation.errors.join('; '));
            return [];
          }
          return validation.ranking;
        }
      } catch (err) {
        console.error("Failed to parse ranking_json", err);
      }
    }

    const rankKeys = keys
      .filter(k => /^rank_\d+$/i.test(k))
      .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]));

    const validation = validateRanking(canonicalizeModels(rankKeys
      .map((key, index) => {
        const rawValue = String(row[key] || '').trim();
        if (!rawValue) return null;

        const idMatch = rawValue.match(/\(([^)]+)\)\s*$/);
        const modelName = rawValue.replace(/\s*\([^)]+\)\s*$/, '').trim() || rawValue;
        const modelId = idMatch?.[1] || modelName;
        return { modelId, modelName, rank: index + 1 };
      })
      .filter((entry): entry is RankingEntry => Boolean(entry))), expectedModelIds);
    return validation.valid ? validation.ranking : [];
  };
  
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setTotalFiles(files.length);
    const newAggregated: Record<string, AggregatedResult> = {};
    const newAnalysisItemsById = new Map<string, EvaluationItem>();
    const newAnalysisVoteRows: AnalysisVoteRow[] = [];
    const newRankVotes: VoteRecord[] = [];
    const newPairwiseVotes: VoteRecord[] = [];
    const newPairwiseModels = new Map<string, { id: string; name: string }>();
    const newRankItemsById = new Map<string, ArenaRankPromptItem>();
    const voters = new Set<string>();
    const selectedTask = tasks.find(task => task.id === selectedTaskId);
    let importedModelNames: AnalysisModelNames = getTaskModelNames(selectedTask);
    let hasResolvedModelNames = Boolean(selectedTask?.models?.length);

    let filesProcessed = 0;
    let validRowsFound = 0;
    let rankRowsFound = 0;
    let pairwiseRowsFound = 0;

    Array.from(files).forEach((file: File) => {
      Papa.parse<any>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          results.data.forEach((row: any) => {
            // Find columns dynamically
            const keys = Object.keys(row);
            const itemId = getCsvField(row, keys, ITEM_ID_KEYS).value;
            const voteValue = getCsvField(row, keys, VOTE_SIDE_KEYS).value;
            const user = getCsvField(row, keys, USER_KEYS).value || 'Anonymous';
            const timestamp = parseCsvTimestamp(getCsvField(row, keys, TIMESTAMP_KEYS).value);
            const modelData = resolveCsvModelData(row, keys, selectedTask);
            const prompt = itemId ? getCsvPrompt(row, keys, itemId) : '';
            const referenceUrls = getCsvReferenceUrls(row, keys);

            if (!hasResolvedModelNames && (modelData.names.a !== DEFAULT_ANALYSIS_MODELS.a || modelData.names.b !== DEFAULT_ANALYSIS_MODELS.b)) {
              importedModelNames = modelData.names;
              hasResolvedModelNames = true;
            }

            if (itemId) {
              const item = buildAnalysisItemFromCsv(itemId, prompt, modelData, row, selectedTask?.outputType, selectedTask?.dimensionColumns || []);
              if (referenceUrls.length > 0) item.referenceUrls = referenceUrls;
              upsertAnalysisItem(newAnalysisItemsById, item);
            }
            const ranking = parseRankingRow(row, keys, selectedTask?.models || []);

            if (itemId && ranking.length >= 3) {
              const itemIdString = String(itemId);
              const modelOutputs = buildModelOutputsFromRanking(row, keys, ranking);
              rankRowsFound++;
              voters.add(user);
              const existingItem = newRankItemsById.get(itemIdString);
              if (!existingItem) {
                const item = { id: itemIdString, inputs: row, originalData: row } as ArenaRankPromptItem;
                newRankItemsById.set(itemIdString, {
                  ...item,
                  prompt: resolveEvaluationItemPrompt(item),
                  dimensionValues: getDimensionValuesFromRecord(row, selectedTask?.dimensionColumns || []),
                  modelOutputs
                });
              } else if (modelOutputs.length > 0) {
                newRankItemsById.set(itemIdString, {
                  ...existingItem,
                  modelOutputs: mergeModelOutputs(existingItem.modelOutputs, modelOutputs)
                });
              }
              newRankVotes.push({
                itemId: itemIdString,
                ranking,
                timestamp: Date.now(),
                user
              });
              return;
            }

            const assignmentId = getCsvField(row, keys, ['AssignmentID', 'assignment_id']).value;
            const pairId = getCsvField(row, keys, ['PairID', 'pair_id']).value;
            const explicitModelAId = getCsvField(row, keys, ['ModelA_ID', 'model_a_id']).value;
            const explicitModelBId = getCsvField(row, keys, ['ModelB_ID', 'model_b_id']).value;
            const looksLikeArenaBattle = Boolean(itemId && (assignmentId || pairId) && explicitModelAId && explicitModelBId);
            if (looksLikeArenaBattle) {
              const winner = normalizeVoteSide(voteValue, modelData.names);
              if (!winner) return;
              const originalItemId = getCsvField(row, keys, ['OriginalItemID', 'original_item_id']).value || itemId;
              const leftModelId = getCsvField(row, keys, ['LeftModelID', 'left_model_id']).value || explicitModelAId;
              const rightModelId = getCsvField(row, keys, ['RightModelID', 'right_model_id']).value || explicitModelBId;
              const samplingPhaseValue = getCsvField(row, keys, ['SamplingPhase', 'sampling_phase']).value;
              const samplingProbability = Number(getCsvField(row, keys, ['SamplingProbability', 'sampling_probability']).value);
              const eligiblePairCount = Number(getCsvField(row, keys, ['EligiblePairCount', 'eligible_pair_count']).value);
              const schedulerVersion = getCsvField(row, keys, ['SchedulerVersion', 'scheduler_version']).value || 'legacy';
              const modelAName = modelData.names.a || explicitModelAId;
              const modelBName = modelData.names.b || explicitModelBId;
              const dimensionValues = getDimensionValuesFromRecord(row, selectedTask?.dimensionColumns || []);
              const mediaType = normalizeOutputMediaType(selectedTask?.outputType, [modelData.urls.a, modelData.urls.b]);
              pairwiseRowsFound += 1;
              validRowsFound += 1;
              voters.add(user);
              newPairwiseModels.set(explicitModelAId, { id: explicitModelAId, name: modelAName });
              newPairwiseModels.set(explicitModelBId, { id: explicitModelBId, name: modelBName });
              newPairwiseVotes.push({
                itemId,
                method: 'pairwise',
                vote: winner,
                choice: winner,
                timestamp,
                user,
                itemSnapshot: {
                  itemId,
                  prompt,
                  inputs: row,
                  dimensionValues,
                  modelOutputs: [
                    { modelId: explicitModelAId, modelName: modelAName, url: modelData.urls.a },
                    { modelId: explicitModelBId, modelName: modelBName, url: modelData.urls.b },
                  ].filter(output => output.url),
                  modelA_Url: modelData.urls.a,
                  modelB_Url: modelData.urls.b,
                  referenceUrls,
                  type: mediaType,
                },
                pairContext: {
                  assignmentId: assignmentId || undefined,
                  pairId: pairId || [explicitModelAId, explicitModelBId].sort().join('::'),
                  originalItemId,
                  modelAId: explicitModelAId,
                  modelAName,
                  modelBId: explicitModelBId,
                  modelBName,
                  leftModelId,
                  rightModelId,
                  samplingPhase: samplingPhaseValue === 'coverage' || samplingPhaseValue === 'adaptive'
                    ? samplingPhaseValue
                    : undefined,
                  samplingProbability: Number.isFinite(samplingProbability) && samplingProbability > 0
                    ? samplingProbability
                    : undefined,
                  eligiblePairCount: Number.isFinite(eligiblePairCount) && eligiblePairCount > 0
                    ? eligiblePairCount
                    : undefined,
                  schedulerVersion,
                },
              });
              return;
            }

            if (!itemId) return;

            const aggregateCounts = getCsvAggregateCounts(row, keys);
            if (aggregateCounts) {
              const totalAggregateVotes = aggregateCounts.A + aggregateCounts.B + aggregateCounts.Tie;
              if (totalAggregateVotes <= 0) return;

              validRowsFound += totalAggregateVotes;
              const rowVoters = splitListField(getCsvField(row, keys, VOTERS_KEYS).value);
              rowVoters.forEach(voter => voters.add(voter));

              if (!newAggregated[itemId]) {
                newAggregated[itemId] = {
                  itemId,
                  prompt,
                  dimensionValues: getDimensionValuesFromRecord(row, selectedTask?.dimensionColumns || []),
                  votes: { A: 0, B: 0, Tie: 0 },
                  voters: []
                };
              } else if (!newAggregated[itemId].prompt && prompt) {
                newAggregated[itemId].prompt = prompt;
                newAggregated[itemId].dimensionValues = newAggregated[itemId].dimensionValues || getDimensionValuesFromRecord(row, selectedTask?.dimensionColumns || []);
              }

              newAggregated[itemId].votes.A += aggregateCounts.A;
              newAggregated[itemId].votes.B += aggregateCounts.B;
              newAggregated[itemId].votes.Tie += aggregateCounts.Tie;
              newAggregated[itemId].voters.push(...rowVoters);
              return;
            }

            const winner = normalizeVoteSide(voteValue, modelData.names);
            if (!winner) return;

            validRowsFound++;
            voters.add(user);

            if (!newAggregated[itemId]) {
              newAggregated[itemId] = {
                itemId,
                prompt,
                dimensionValues: getDimensionValuesFromRecord(row, selectedTask?.dimensionColumns || []),
                votes: { A: 0, B: 0, Tie: 0 },
                voters: []
              };
            } else if (!newAggregated[itemId].prompt && prompt) {
              newAggregated[itemId].prompt = prompt;
              newAggregated[itemId].dimensionValues = newAggregated[itemId].dimensionValues || getDimensionValuesFromRecord(row, selectedTask?.dimensionColumns || []);
            }

            if (winner === 'A') newAggregated[itemId].votes.A++;
            else if (winner === 'B') newAggregated[itemId].votes.B++;
            else if (winner === 'Tie') newAggregated[itemId].votes.Tie++;
            
            newAggregated[itemId].voters.push(user);
            newAnalysisVoteRows.push({
              itemId,
              vote: winner,
              timestamp,
              user
            });
          });

          filesProcessed++;
          if (filesProcessed === files.length) {
            if (rankRowsFound > 0) {
              setRankVotes(newRankVotes);
              setRankItems(Array.from(newRankItemsById.values()));
              setAggregatedData([]);
              setAnalysisItems([]);
              setAnalysisVoteRows([]);
              setAnalysisModels(DEFAULT_ANALYSIS_MODELS);
              setUniqueVoters(voters);
              setAnalysisMode('Arena-rank');
              setMethodVotes([]);
            } else if (pairwiseRowsFound > 0) {
              const pairwiseModels = Array.from(newPairwiseModels.values());
              const pairwiseConfig = selectedTask && isPairwiseMethod(getMaterialEvaluationConfig(selectedTask))
                ? getMaterialEvaluationConfig(selectedTask)
                : getDefaultEvaluationConfig('pairwise');
              setMethodVotes(newPairwiseVotes);
              setAnalysisItems(Array.from(newAnalysisItemsById.values()));
              setAnalysisModelList(pairwiseModels);
              setAnalysisModels({
                a: pairwiseModels[0]?.name || DEFAULT_ANALYSIS_MODELS.a,
                b: pairwiseModels[1]?.name || DEFAULT_ANALYSIS_MODELS.b,
              });
              setAnalysisEvaluationConfig(pairwiseConfig);
              setAggregatedData([]);
              setAnalysisVoteRows([]);
              setRankVotes([]);
              setRankItems([]);
              setUniqueVoters(voters);
              setAnalysisMode('Pairwise');
            } else if (validRowsFound === 0) {
              setError("未能从上传的文件中识别出有效的投票结果。请确保 CSV 文件包含 'Item ID' 和 'Winner' 列。");
              setTotalFiles(0);
            } else {
              setAggregatedData(Object.values(newAggregated));
              setRankVotes([]);
              setRankItems([]);
              setAnalysisItems(Array.from(newAnalysisItemsById.values()));
              setAnalysisModels(importedModelNames);
              setAnalysisVoteRows(newAnalysisVoteRows);
              setMethodVotes([]);
              setUniqueVoters(voters);
              setAnalysisMode('Arena');
            }
          }
        },
        error: (err) => {
          console.error("CSV Parse Error:", err);
          filesProcessed++;
        }
      });
    });
  };

  const downloadTemplate = async () => {
    if (!selectedTaskId) {
      setError("请先选择一份评测物料，然后再下载对应的数据模板。");
      return;
    }

    setIsDownloadingTemplate(true);
    setError(null);

    try {
      const selectedTask = tasks.find(t => t.id === selectedTaskId);
      if (!selectedTask) {
        setError("未找到这份评测物料。");
        setIsDownloadingTemplate(false);
        return;
      }

      const items = await loadTaskItems(selectedTask);
      if (items.length === 0) {
        setError("该评测物料没有 case 数据。");
        setIsDownloadingTemplate(false);
        return;
      }

      const csvData: any[] = [];
      const selectedTemplate = templates.find(t => t.id === selectedTask?.templateId);
      const isRankTemplate = selectedTemplate?.paradigm === 'Arena-rank';
      const maxOutputs = Math.max(0, ...items.map(item => (item.modelOutputs || []).length));
      
      items.forEach(data => {
        const row: any = { 'Item ID': data.id };
        const originalData = (data as any).originalData;
        
        // Add original data columns if available
        if (originalData) {
          Object.assign(row, originalData);
        } else {
          // Fallback if originalData is missing
          if (data.prompt) row['Prompt'] = data.prompt;
          if (data.inputs) {
            Object.assign(row, data.inputs);
          }
          if (data.modelA_Url) row['Model A'] = data.modelA_Url;
          if (data.modelB_Url) row['Model B'] = data.modelB_Url;
        }

        // Add result columns
        if (isRankTemplate) {
          for (let i = 1; i <= Math.max(maxOutputs, 3); i++) {
            row[`rank_${i}`] = '';
            row[`排名${i}视频链接`] = '';
          }
          row['ranking_json'] = '';
        } else {
          row['Winner'] = '';
        }
        row['User'] = '';
        
        csvData.push(row);
      });

      const csvString = Papa.unparse(csvData);
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      
      const taskName = tasks.find(t => t.id === selectedTaskId)?.name || 'task';
      link.setAttribute('download', `${taskName}_template.csv`);
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      handlePersistenceError(err, 'list', `evalTasks/${selectedTaskId}/items`);
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  // Calculate totals
  const totalVotes = aggregatedData.reduce((acc, curr) => acc + curr.votes.A + curr.votes.B + curr.votes.Tie, 0);
  const totalA = aggregatedData.reduce((acc, curr) => acc + curr.votes.A, 0);
  const totalB = aggregatedData.reduce((acc, curr) => acc + curr.votes.B, 0);
  const totalTie = aggregatedData.reduce((acc, curr) => acc + curr.votes.Tie, 0);

  const percentA = totalVotes ? Math.round((totalA / totalVotes) * 100) : 0;
  const percentB = totalVotes ? Math.round((totalB / totalVotes) * 100) : 0;
  const isArenaRankAnalysis = analysisMode === 'Arena-rank';
  const rankModelStats = calculateArenaRankModelStats(rankVotes);
  const rankCaseSummaries = calculateArenaRankCaseSummaries(rankVotes, rankItems);
  const rankTieSummaries = rankVotes.map(vote => getRankingTieSummary(vote.ranking));
  const leadingRankModels = rankModelStats.length
    ? rankModelStats.filter(model => Math.abs(model.normalizedScore - rankModelStats[0].normalizedScore) < 1e-9)
    : [];
  const averageRankRelationAgreement = (() => {
    const values = rankCaseSummaries.map(item => item.relationAgreement).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  })();
  const averageRankDistinction = rankCaseSummaries.length
    ? rankCaseSummaries.reduce((sum, item) => sum + item.distinctionRate, 0) / rankCaseSummaries.length
    : 0;
  const analysisItemsById = new Map<string, EvaluationItem>(analysisItems.map(item => [item.id, item] as [string, EvaluationItem]));
  const analysisDimensionColumns = getDimensionColumnsForCsv(analysisItems);
  const rankDimensionColumns = getDimensionColumnsForCsv(rankItems as any);
  const voteDimensionSummaries = calculateVoteDimensionSummaries(aggregatedData);
  const rankDimensionSummaries = calculateRankDimensionSummaries(rankVotes, rankItems as any);
  const modelAName = analysisModels.a || DEFAULT_ANALYSIS_MODELS.a;
  const modelBName = analysisModels.b || DEFAULT_ANALYSIS_MODELS.b;
  const selectedMaterialsLabel = selectedMaterialIds.length
    ? `${selectedMaterialIds.length} 份评测物料`
    : '未选择评测物料';

  const insightControls = (
    <div className="glass-panel p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_180px_1.2fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">选择项目</span>
          <select
            value={selectedProjectId}
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              setSelectedMaterialScope('');
              setLoadedScopeKey('');
            }}
            className="glass-input w-full px-3 py-2 text-sm"
            disabled={loadingTasks}
          >
            {projectOptions.length === 0 && <option value="">暂无可分析项目</option>}
            {projectOptions.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">物料状态</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as EvalTask['status'] | 'all');
              setSelectedMaterialScope('');
              setLoadedScopeKey('');
            }}
            className="glass-input w-full px-3 py-2 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="completed">已完成</option>
            <option value="active">进行中</option>
            <option value="draft">草稿</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">评测物料范围</span>
          <select
            value={selectedMaterialScope}
            onChange={(event) => {
              setSelectedMaterialScope(event.target.value);
              setLoadedScopeKey('');
            }}
            className="glass-input w-full px-3 py-2 text-sm"
            disabled={projectMaterials.length === 0}
          >
            {materialGroups.map(group => (
              <option key={group.key} value={`group:${group.key}`}>
                全部同类物料：{group.label}（{group.tasks.length} 份）
              </option>
            ))}
            {projectMaterials.length > 0 && <option disabled>──────── 单个评测物料 ────────</option>}
            {projectMaterials.map(material => (
              <option key={material.id} value={`material:${material.id}`}>
                {material.name}（{taskStatusLabel(material.status)}）
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => handleImportFromPlatform(selectedMaterialIds)}
          disabled={selectedMaterialIds.length === 0 || loadingResults}
          className="btn-primary h-10 disabled:opacity-50"
        >
          {loadingResults ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
          刷新洞察
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1"><Layers size={13} /> {selectedProjectName}</span>
        <span>{selectedMaterialsLabel}</span>
        <span>同范式、同模型口径的评测物料会自动合并；不同口径请切换分组查看。</span>
      </div>
    </div>
  );

  const escapeCsvField = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const downloadAnalysisCsv = () => {
    let csvContent = '';

    if (isArenaRankAnalysis) {
      const maxSummaryRankCount = Math.max(0, ...rankCaseSummaries.map(item => item.ranking.length));
      const rankVideoHeaders = Array.from({ length: maxSummaryRankCount }, (_, idx) => `排名${idx + 1}视频链接`);
      const headers = [
        'ItemID',
        'Prompt',
        ...rankDimensionColumns.map(col => col.header),
        'Voters',
        'ConsensusRanking',
        'RelationAgreement',
        'KendallTauB',
        'DistinctionRate',
        'TieBallots',
        'AllTieBallots',
        ...rankVideoHeaders,
        'ModelStats'
      ];
      const rows = rankCaseSummaries.map(item => {
        const sourceItem = rankItems.find(candidate => candidate.id === item.itemId);
        const dimensionValues = getDimensionValuesForItem(sourceItem as any);
        const rankVideoValues = rankVideoHeaders.map((_, index) => {
          const entry = item.ranking[index];
          return entry ? getArenaRankModelOutputUrl(sourceItem, entry) : '';
        });

        return [
          item.itemId,
          item.prompt || '',
          ...getDimensionCsvValues(dimensionValues, rankDimensionColumns.map(col => col.key)),
          item.voterCount,
          formatConsensusRanking(item.ranking),
          item.relationAgreement ?? '',
          item.kendallTauB ?? '',
          item.distinctionRate,
          item.tieBallots,
          item.allTieBallots,
          ...rankVideoValues,
          item.ranking.map(entry => `${entry.modelName}: normalized=${entry.normalizedScore.toFixed(4)}, score=${entry.totalScore.toFixed(4)}, avgMidRank=${entry.averageRank.toFixed(4)}, outrightFirst=${entry.outrightFirstCount}, coFirst=${entry.coFirstCount}, firstCredit=${entry.firstPlaceCredit.toFixed(4)}, tieRate=${entry.tieRate.toFixed(4)}, ranked=${entry.rankedCount}`).join(' | ')
        ].map(escapeCsvField).join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    } else {
      const headers = [
        'ItemID',
        'Prompt',
        ...analysisDimensionColumns.map(col => col.header),
        'ModelA_Name',
        'ModelA_URL',
        'ModelB_Name',
        'ModelB_URL',
        'ReferenceURLs',
        'Votes_A',
        'Votes_B',
        'Votes_Tie',
        'TotalVotes',
        'NonTieVotes',
        'VoterCount',
        'Voters',
        'A_WinRate',
        'B_WinRate',
        'TieRate',
        'NonTie_A_Share',
        'NonTie_B_Share',
        'Winner',
        'WinnerSide',
        'WinnerVotes',
        'WinnerRate',
        'AgreementRate',
        'MarginVotes',
        'MarginRate',
        'NetPreference_A_minus_B'
      ];
      const rows = aggregatedData.map(item => {
        const sourceItem = analysisItemsById.get(item.itemId);
        const outputs = getCaseModelOutputs(sourceItem, analysisModels);
        const dimensionValues = { ...(item.dimensionValues || {}), ...getDimensionValuesForItem(sourceItem as any) };
        const itemTotal = item.votes.A + item.votes.B + item.votes.Tie;
        const nonTieVotes = item.votes.A + item.votes.B;
        const winnerSide = getWinnerSide(item.votes);
        const winnerVotes = winnerSide === 'A' ? item.votes.A : winnerSide === 'B' ? item.votes.B : Math.max(item.votes.A, item.votes.B, item.votes.Tie);
        const maxVotes = Math.max(item.votes.A, item.votes.B, item.votes.Tie);

        return [
          item.itemId,
          item.prompt || resolveEvaluationItemPrompt(sourceItem),
          ...getDimensionCsvValues(dimensionValues, analysisDimensionColumns.map(col => col.key)),
          outputs.a.modelName,
          outputs.a.url,
          outputs.b.modelName,
          outputs.b.url,
          sourceItem?.referenceUrls?.join(' | ') || '',
          item.votes.A,
          item.votes.B,
          item.votes.Tie,
          itemTotal,
          nonTieVotes,
          new Set(item.voters).size,
          Array.from(new Set(item.voters)).join(' | '),
          formatRatio(item.votes.A, itemTotal),
          formatRatio(item.votes.B, itemTotal),
          formatRatio(item.votes.Tie, itemTotal),
          formatRatio(item.votes.A, nonTieVotes),
          formatRatio(item.votes.B, nonTieVotes),
          getWinnerLabel(winnerSide, { a: outputs.a.modelName, b: outputs.b.modelName }),
          winnerSide,
          winnerVotes,
          formatRatio(winnerVotes, itemTotal),
          formatRatio(maxVotes, itemTotal),
          Math.abs(item.votes.A - item.votes.B),
          formatRatio(Math.abs(item.votes.A - item.votes.B), itemTotal),
          formatRatio(item.votes.A - item.votes.B, nonTieVotes)
        ].map(escapeCsvField).join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${isArenaRankAnalysis ? 'arena_rank' : 'arena'}_analysis_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadRawVotesCsv = () => {
    if (isArenaRankAnalysis) {
      const maxRankCount = Math.max(0, ...rankVotes.map(vote => vote.ranking?.length || 0));
      const rankHeaders = Array.from({ length: maxRankCount }, (_, index) => `rank_${index + 1}`);
      const rankVideoHeaders = Array.from({ length: maxRankCount }, (_, index) => `排名${index + 1}视频链接`);
      const headers = ['ItemID', 'Prompt', ...rankDimensionColumns.map(col => col.header), 'User', 'Timestamp', 'RankingDisplay', 'HasTie', 'AllTied', 'TieGroupCount', 'TopTieSize', ...rankHeaders, ...rankVideoHeaders, 'ranking_json'];
      const rows = rankVotes.map(vote => {
        const sourceItem = rankItems.find(item => item.id === vote.itemId);
        const ranking = normalizeRanking(vote.ranking);
        const tieSummary = getRankingTieSummary(ranking);
        return [
          vote.itemId,
          resolveEvaluationItemPrompt(sourceItem),
          ...getDimensionCsvValues(getDimensionValuesForItem(sourceItem as any), rankDimensionColumns.map(col => col.key)),
          vote.user || 'Anonymous',
          new Date(vote.timestamp).toISOString(),
          formatRanking(ranking),
          tieSummary.hasTie ? 'true' : 'false',
          tieSummary.allTied ? 'true' : 'false',
          tieSummary.tieGroupCount,
          tieSummary.topTieSize,
          ...rankHeaders.map((_, index) => ranking[index] ? `${ranking[index].modelName} (${ranking[index].modelId})` : ''),
          ...rankVideoHeaders.map((_, index) => ranking[index] ? getArenaRankModelOutputUrl(sourceItem, ranking[index]) : ''),
          JSON.stringify(ranking)
        ].map(escapeCsvField).join(',');
      });
      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `arena_rank_raw_votes_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = [
      'ItemID',
      'Prompt',
      ...analysisDimensionColumns.map(col => col.header),
      'User',
      'Timestamp',
      'VoteSide',
      'VoteModelName',
      'ModelA_Name',
      'ModelA_URL',
      'ModelB_Name',
      'ModelB_URL',
      'ReferenceURLs'
    ];
    const rows = analysisVoteRows.map(vote => {
      const sourceItem = analysisItemsById.get(vote.itemId);
      const outputs = getCaseModelOutputs(sourceItem, analysisModels);
      const modelNamesForVote = { a: outputs.a.modelName, b: outputs.b.modelName };

      return [
        vote.itemId,
        resolveEvaluationItemPrompt(sourceItem),
        ...getDimensionCsvValues(getDimensionValuesForItem(sourceItem as any), analysisDimensionColumns.map(col => col.key)),
        vote.user,
        new Date(vote.timestamp).toISOString(),
        vote.vote,
        getWinnerLabel(vote.vote, modelNamesForVote),
        outputs.a.modelName,
        outputs.a.url,
        outputs.b.modelName,
        outputs.b.url,
        sourceItem?.referenceUrls?.join(' | ') || ''
      ].map(escapeCsvField).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `arena_raw_votes_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadDimensionAnalysisCsv = () => {
    const isRank = isArenaRankAnalysis;
    const headers = isRank
      ? ['Dimension', 'Value', 'ItemCount', 'RankingRecords', 'LeadingModels', 'RelationAgreement', 'KendallTauB', 'DistinctionRate', 'TieBallotRate', 'AllTieBallotRate', 'ModelStats']
      : ['Dimension', 'Value', 'ItemCount', 'TotalVotes', 'Votes_A', 'Votes_B', 'Votes_Tie', 'Winner', 'AgreementRate', 'MarginRate'];

    const rows = isRank
      ? rankDimensionSummaries.map(summary => [
          summary.dimensionKey,
          summary.dimensionValue,
          summary.itemCount,
          summary.rankingRecords,
          summary.modelStats.length
            ? summary.modelStats.filter(stat => Math.abs(stat.normalizedScore - summary.modelStats[0].normalizedScore) < 1e-9).map(stat => stat.modelName).join(' = ')
            : '',
          summary.relationAgreement ?? '',
          summary.kendallTauB ?? '',
          summary.distinctionRate,
          summary.tieBallotRate,
          summary.allTieBallotRate,
          summary.modelStats.map(stat => `${stat.modelName}: normalized=${stat.normalizedScore.toFixed(4)}, score=${stat.totalScore.toFixed(4)}, avgMidRank=${stat.averageRank.toFixed(4)}, outrightFirst=${stat.outrightFirstCount}, coFirst=${stat.coFirstCount}, firstCredit=${stat.firstPlaceCredit.toFixed(4)}, tieRate=${stat.tieRate.toFixed(4)}`).join(' | ')
        ].map(escapeCsvField).join(','))
      : voteDimensionSummaries.map(summary => [
          summary.dimensionKey,
          summary.dimensionValue,
          summary.itemCount,
          summary.totalVotes,
          summary.votes.A,
          summary.votes.B,
          summary.votes.Tie,
          getWinnerLabel(summary.winner, analysisModels),
          summary.agreementRate.toFixed(4),
          summary.marginRate.toFixed(4)
        ].map(escapeCsvField).join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${isRank ? 'arena_rank_dimension_analysis' : 'arena_dimension_analysis'}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (methodVotes.length > 0 && showInsights && analysisEvaluationConfig && (isScoreMethod(analysisEvaluationConfig) || isPairwiseMethod(analysisEvaluationConfig))) {
    return (
      <ScoreInsightsScreen
        mode={isPairwiseMethod(analysisEvaluationConfig) ? 'pairwise' : 'score'}
        title={`${selectedProjectName} · ${isPairwiseMethod(analysisEvaluationConfig) ? 'Pairwise 对战洞察' : '评分洞察'}`}
        description={`当前范围：${selectedMaterialsLabel}。该视图按评测方式展示对应统计，避免把评分、排序和偏好投票混在同一口径中。`}
        controls={insightControls}
        items={analysisItems}
        votes={methodVotes}
        models={analysisModelList.length ? analysisModelList : []}
        config={analysisEvaluationConfig}
        onBack={() => setShowInsights(false)}
        backLabel="展开评分明细与原始记录"
      />
    );
  }

  if ((aggregatedData.length > 0 || rankVotes.length > 0) && showInsights) {
    return (
      <ResultsInsightsScreen
        mode={isArenaRankAnalysis ? 'rank' : 'ab'}
        title={`${selectedProjectName} · 项目汇总洞察`}
        description={`当前范围：${selectedMaterialsLabel}。默认合并同范式、同模型口径的评测物料，帮助你从项目角度观察模型表现、维度差异和低共识样例。`}
        controls={insightControls}
        items={isArenaRankAnalysis ? rankItems as any : analysisItems}
        votes={isArenaRankAnalysis ? rankVotes : []}
        aggregatedData={isArenaRankAnalysis ? [] : aggregatedData}
        rawVoteRows={isArenaRankAnalysis ? [] : analysisVoteRows}
        modelNames={analysisModels}
        models={rankModelStats.map(stat => ({ id: stat.modelId, name: stat.modelName }))}
        onBack={() => setShowInsights(false)}
        backLabel={isArenaRankAnalysis ? '展开逐 case 明细与原始记录' : '展开项目共识明细与原始记录'}
      />
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8 relative">
        {onGoToDashboard && (
          <button 
            onClick={onGoToDashboard}
            className="absolute left-0 top-0 glass-panel glass-panel-hover text-slate-300 px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors border border-white/10"
          >
            <ArrowRight className="rotate-180" size={16} /> 返回大盘
          </button>
        )}
        <div className={onGoToDashboard ? "ml-32" : ""}>
          <h1 className="text-3xl font-bold text-slate-100">结果洞察</h1>
          <p className="text-slate-400">先选择项目，再按评测物料范围查看项目级统计、图表和 case 证据。</p>
        </div>
        <button 
          onClick={onBack}
          className="flex items-center gap-2 bg-black/40 hover:bg-white/5 text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-md transition-all transform hover:-translate-y-0.5"
        >
          去参与评测
        </button>
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="mb-6">{insightControls}</div>

      {aggregatedData.length === 0 && rankVotes.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Import from Platform Card */}
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md transition-shadow">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Database size={32} />
            </div>
            <h3 className="text-xl font-semibold text-slate-100 mb-2">载入平台结果</h3>
            <p className="text-slate-400 mb-6 max-w-sm mx-auto text-sm">
              从当前项目和评测物料范围读取所有成员的评测结果，生成项目汇总洞察。
            </p>
            
            <div className="w-full max-w-xs space-y-3">
              <select 
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                disabled={loadingTasks}
              >
                <option value="">选择单个评测物料...</option>
                {projectMaterials.map(task => (
                  <option key={task.id} value={task.id}>
                    {task.name} ({taskStatusLabel(task.status)})
                  </option>
                ))}
              </select>
              
              <button 
                onClick={() => handleImportFromPlatform(selectedTaskId ? [selectedTaskId] : selectedMaterialIds)}
                disabled={(!selectedTaskId && selectedMaterialIds.length === 0) || loadingResults}
                className={`w-full py-3 rounded-xl font-semibold shadow-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2 ${
                  (!selectedTaskId && selectedMaterialIds.length === 0) || loadingResults
                    ? 'bg-white/10 text-slate-500 cursor-not-allowed shadow-none' 
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                }`}
              >
                {loadingResults ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
                {loadingResults ? '载入中...' : '载入结果'}
              </button>
              </div>
            </div>

          {/* Upload Results Card */}
          <div className="glass-panel border-2 border-dashed border-white/20 rounded-2xl p-8 text-center hover:border-blue-400 transition-colors flex flex-col justify-center">
            <div className="w-16 h-16 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload size={32} />
            </div>
            <h3 className="text-xl font-semibold text-slate-100 mb-2">手动导入外部结果</h3>
            <p className="text-slate-400 mb-6 max-w-sm mx-auto text-sm">
              对于外部通过自动化模式跑出来的结果，或者离线收集的数据，可以通过上传 CSV 文件进行汇总。
            </p>
            <label className="inline-flex cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-blue-600/20 transition-all transform hover:scale-105 mx-auto">
              <input type="file" multiple accept=".csv" className="hidden" onChange={handleFileUpload} />
              选择文件
            </label>
          </div>

          {/* Start New Task Card */}
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <PlusCircle size={32} />
            </div>
            <h3 className="text-xl font-semibold text-slate-100 mb-2">如何形成多人评测结果？</h3>
            <div className="text-slate-400 mb-8 max-w-sm mx-auto text-sm text-left space-y-2 bg-white/5 p-4 rounded-xl border border-white/10">
              <p><strong>1.</strong> 在“评测物料”中创建可执行评测配置并分配给成员。</p>
              <p><strong>2.</strong> 成员在“参与评测”页面完成投票或排序。</p>
              <p><strong>3.</strong> 物料完成后，在上方选择项目和物料范围即可载入平台结果。</p>
              <p><strong>4.</strong> 外部自动化结果可通过中间的 CSV 上传导入。</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={downloadTemplate} 
                disabled={!selectedTaskId || isDownloadingTemplate}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-colors border ${
                  selectedTaskId 
                    ? 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border-indigo-500/20' 
                    : 'bg-white/5 text-slate-500 border-white/10 cursor-not-allowed'
                }`}
              >
                {isDownloadingTemplate ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                {isDownloadingTemplate ? '生成中...' : (selectedTaskId ? '下载数据模板' : '请先选择评测物料')}
              </button>
            </div>
          </div>
        </div>
      ) : methodVotes.length > 0 && analysisEvaluationConfig ? (
        <div className="space-y-8">
          <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <h3 className="font-semibold text-slate-200">
                {isPairwiseMethod(analysisEvaluationConfig) ? 'Pairwise 原始对战记录' : '评分原始记录'}
              </h3>
              <button onClick={() => setShowInsights(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border border-blue-500/20 rounded-lg text-sm font-medium">
                <BarChart3 size={16} /> 结果洞察
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">ItemID</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">评委</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">方式</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">记录</th>
                  </tr>
                </thead>
                <tbody>
                  {methodVotes.map((vote, index) => (
                    <tr key={`${vote.itemId}-${vote.timestamp}-${index}`} className="border-b border-white/10 hover:bg-white/5">
                      <td className="p-4 text-sm font-mono text-slate-300">{vote.itemId}</td>
                      <td className="p-4 text-sm text-slate-300">{vote.user || '-'}</td>
                      <td className="p-4 text-sm text-slate-300">{isPairwiseMethod(analysisEvaluationConfig) ? 'Pairwise' : 'Score'}</td>
                      <td className="p-4 text-xs text-slate-300 min-w-[360px]">
                        {isPairwiseMethod(analysisEvaluationConfig)
                          ? `${vote.pairContext?.modelAName || 'A'} / ${vote.pairContext?.modelBName || 'B'} -> ${vote.vote || vote.choice || '-'}`
                          : Object.values(vote.rubricResponses || {}).map((response: any) => `${response.modelName}: ${Object.values(response.scores || {}).join('/')}`).join(' | ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : isArenaRankAnalysis ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">参与者</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <Users className="text-purple-500" />
                {uniqueVoters.size}
              </div>
              <div className="text-xs text-slate-400 truncate mt-1">{Array.from(uniqueVoters).join(', ')}</div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">排名记录</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <FileText className="text-blue-500" />
                {rankVotes.length}
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">领先模型</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <BarChart3 className="text-amber-500" />
                <span className="truncate text-base" title={leadingRankModels.map(model => model.modelName).join(' = ')}>{leadingRankModels.map(model => model.modelName).join(' = ') || '-'}</span>
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">一致率 / 区分度</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <BarChart3 className="text-emerald-500" />
                {averageRankRelationAgreement === null ? '-' : `${(averageRankRelationAgreement * 100).toFixed(0)}%`} / {(averageRankDistinction * 100).toFixed(0)}%
              </div>
              <div className="mt-1 text-xs text-slate-400">含并列票 {rankTieSummaries.filter(summary => summary.hasTie).length} / 全部并列 {rankTieSummaries.filter(summary => summary.allTied).length}</div>
            </div>
          </div>

          <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <h3 className="font-semibold text-slate-200">模型总积分榜</h3>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button onClick={() => setShowInsights(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border border-blue-500/20 rounded-lg text-sm font-medium">
                  <BarChart3 size={16} /> 结果洞察
                </button>
              <button onClick={downloadAnalysisCsv} className="flex items-center gap-2 px-4 py-2 bg-black/40 glass-panel-hover text-white rounded-lg text-sm font-medium">
                <Download size={16} /> 导出分析 CSV
              </button>
              <button onClick={downloadRawVotesCsv} className="flex items-center gap-2 px-4 py-2 bg-black/40 glass-panel-hover text-white rounded-lg text-sm font-medium">
                <Download size={16} /> 导出原始排名 CSV
              </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">排名</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">模型</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">归一化 Borda</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">原始 Borda</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">平均 mid-rank</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">独占 / 并列第一</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">第一名份额</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">并列参与率</th>
                  </tr>
                </thead>
                <tbody>
                  {rankModelStats.map((model) => {
                    const consensusRank = rankModelStats.findIndex(candidate => Math.abs(candidate.normalizedScore - model.normalizedScore) < 1e-9) + 1;
                    const tied = rankModelStats.filter(candidate => Math.abs(candidate.normalizedScore - model.normalizedScore) < 1e-9).length > 1;
                    return (
                    <tr key={model.modelId} className="border-b border-white/10 hover:bg-white/5">
                      <td className="p-4 text-sm font-mono text-amber-300">{tied ? `并列 #${consensusRank}` : `#${consensusRank}`}</td>
                      <td className="p-4 text-sm font-bold text-slate-200">{model.modelName}</td>
                      <td className="p-4 text-sm text-slate-200">{(model.normalizedScore * 100).toFixed(1)}%</td>
                      <td className="p-4 text-sm text-slate-200">{model.totalScore.toFixed(2)}</td>
                      <td className="p-4 text-sm text-slate-200">{model.averageRank.toFixed(2)}</td>
                      <td className="p-4 text-sm text-slate-200">{model.outrightFirstCount} / {model.coFirstCount}</td>
                      <td className="p-4 text-sm text-slate-200">{model.firstPlaceCredit.toFixed(2)}</td>
                      <td className="p-4 text-sm text-slate-200">{(model.tieRate * 100).toFixed(1)}%</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </div>

          {rankDimensionSummaries.length > 0 && (
            <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
              <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
                <h3 className="font-semibold text-slate-200">按评测维度聚合</h3>
                <button onClick={downloadDimensionAnalysisCsv} className="flex items-center gap-2 px-4 py-2 bg-black/40 glass-panel-hover text-white rounded-lg text-sm font-medium">
                  <Download size={16} /> 导出维度 CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">维度</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">取值</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">Case 数</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">排名记录</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">领先模型</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">关系一致率</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">区分度 / 并列票</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">模型统计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankDimensionSummaries.map(summary => (
                      <tr key={`${summary.dimensionKey}-${summary.dimensionValue}`} className="border-b border-white/10 hover:bg-white/5">
                        <td className="p-4 text-sm text-slate-200">{summary.dimensionKey}</td>
                        <td className="p-4 text-sm text-slate-200">{summary.dimensionValue}</td>
                        <td className="p-4 text-sm text-slate-200">{summary.itemCount}</td>
                        <td className="p-4 text-sm text-slate-200">{summary.rankingRecords}</td>
                        <td className="p-4 text-sm font-semibold text-amber-300">
                          {summary.modelStats.length ? summary.modelStats.filter(stat => Math.abs(stat.normalizedScore - summary.modelStats[0].normalizedScore) < 1e-9).map(stat => stat.modelName).join(' = ') : '-'}
                        </td>
                        <td className="p-4 text-sm text-slate-200">{summary.relationAgreement === null ? '-' : `${(summary.relationAgreement * 100).toFixed(0)}%`}</td>
                        <td className="p-4 text-sm text-slate-200">{(summary.distinctionRate * 100).toFixed(0)}% / {(summary.tieBallotRate * 100).toFixed(0)}%</td>
                        <td className="p-4 text-xs text-slate-300 min-w-[280px]">
                          {summary.modelStats.map(stat => `${stat.modelName}: normalized=${(stat.normalizedScore * 100).toFixed(1)}, score=${stat.totalScore.toFixed(2)}, mid-rank=${stat.averageRank.toFixed(2)}, outright/co-first=${stat.outrightFirstCount}/${stat.coFirstCount}`).join(' | ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <h3 className="font-semibold text-slate-200">逐 case 共识排名</h3>
              <label className="text-xs font-medium text-blue-400 cursor-pointer hover:underline">
                <input type="file" multiple accept=".csv" className="hidden" onChange={handleFileUpload} />
                + 添加更多文件
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">项目 ID</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">Prompt</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">评测维度</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">参与人数</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">一致率 / 区分度</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">共识排名</th>
                  </tr>
                </thead>
                <tbody>
                  {rankCaseSummaries.map((item) => {
                    const sourceItem = rankItems.find(candidate => candidate.id === item.itemId);

                    return (
                      <tr key={item.itemId} className="border-b border-white/10 hover:bg-white/5">
                        <td className="p-4 text-sm text-slate-300 font-mono">{item.itemId}</td>
                        <td className="p-4 text-sm text-slate-300 min-w-[260px] max-w-md whitespace-pre-wrap break-words">{item.prompt || '-'}</td>
                        <td className="p-4 min-w-[220px]">
                          <DimensionChips values={getDimensionValuesForItem(sourceItem as any)} label="" />
                        </td>
                        <td className="p-4 text-sm text-slate-200">{item.voterCount}</td>
                        <td className="p-4 text-xs text-slate-300 min-w-[150px]">
                          <div>{item.relationAgreement === null ? '一致率 -' : `一致率 ${(item.relationAgreement * 100).toFixed(0)}%`}</div>
                          <div>区分度 {(item.distinctionRate * 100).toFixed(0)}%</div>
                          <div className="text-slate-500">并列票 {item.tieBallots} / 全并列 {item.allTieBallots}</div>
                        </td>
                        <td className="p-4">
                          <ArenaRankVideoPreviewList
                            entries={item.ranking.map((entry) => {
                              const consensusRank = item.ranking.findIndex(candidate => Math.abs(candidate.normalizedScore - entry.normalizedScore) < 1e-9) + 1;
                              const tied = item.ranking.filter(candidate => Math.abs(candidate.normalizedScore - entry.normalizedScore) < 1e-9).length > 1;
                              return ({
                              id: entry.modelId,
                              modelName: entry.modelName,
                              rankLabel: tied ? `并列 #${consensusRank}` : `#${consensusRank}`,
                              metaLabel: `Borda ${(entry.normalizedScore * 100).toFixed(1)} / mid-rank ${entry.averageRank.toFixed(2)}`,
                              videoUrl: getArenaRankModelOutputUrl(sourceItem, entry)
                            });})}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* Top Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">参与者</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <Users className="text-purple-500" />
                {uniqueVoters.size}
              </div>
              <div className="text-xs text-slate-400 truncate mt-1">
                {Array.from(uniqueVoters).join(', ')}
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">总评测数</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <FileText className="text-blue-500" />
                {totalVotes}
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 truncate" title={`${modelAName} 获胜`}>
                {modelAName} 获胜
              </div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <BarChart3 className="text-green-500" />
                {percentA}%
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 truncate" title={`${modelBName} 获胜`}>
                {modelBName} 获胜
              </div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <BarChart3 className="text-indigo-500" />
                {percentB}%
              </div>
            </div>
          </div>

          {voteDimensionSummaries.length > 0 && (
            <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
              <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
                <h3 className="font-semibold text-slate-200">按评测维度聚合</h3>
                <button onClick={downloadDimensionAnalysisCsv} className="flex items-center gap-2 px-4 py-2 bg-black/40 glass-panel-hover text-white rounded-lg text-sm font-medium">
                  <Download size={16} /> 导出维度 CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">维度</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">取值</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">Case 数</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">总票数</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">投票分布</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">获胜者</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">共识度</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {voteDimensionSummaries.map(summary => (
                      <tr key={`${summary.dimensionKey}-${summary.dimensionValue}`} className="border-b border-white/10 hover:bg-white/5">
                        <td className="p-4 text-sm text-slate-200">{summary.dimensionKey}</td>
                        <td className="p-4 text-sm text-slate-200">{summary.dimensionValue}</td>
                        <td className="p-4 text-sm text-slate-200">{summary.itemCount}</td>
                        <td className="p-4 text-sm text-slate-200">{summary.totalVotes}</td>
                        <td className="p-4 text-xs text-slate-300 min-w-[220px]">
                          {modelAName}: {summary.votes.A} | {modelBName}: {summary.votes.B} | 平局: {summary.votes.Tie}
                        </td>
                        <td className="p-4 text-sm font-semibold text-slate-100">{getWinnerLabel(summary.winner, analysisModels)}</td>
                        <td className="p-4 text-sm text-slate-200">{Math.round(summary.agreementRate * 100)}%</td>
                        <td className="p-4 text-sm text-slate-200">{Math.round(summary.marginRate * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Breakdown Table */}
          <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <h3 className="font-semibold text-slate-200">项目共识</h3>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button onClick={() => setShowInsights(true)} className="flex items-center gap-2 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border border-blue-500/20 rounded-lg text-xs font-medium">
                  <BarChart3 size={14} /> 结果洞察
                </button>
                <button onClick={downloadAnalysisCsv} className="flex items-center gap-2 px-3 py-2 bg-black/40 glass-panel-hover text-white rounded-lg text-xs font-medium">
                  <Download size={14} /> 导出汇总 CSV
                </button>
                <button
                  onClick={downloadRawVotesCsv}
                  disabled={analysisVoteRows.length === 0}
                  title={analysisVoteRows.length === 0 ? '当前数据源没有逐条投票明细' : '导出逐条投票明细'}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
                    analysisVoteRows.length === 0
                      ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                      : 'bg-black/40 glass-panel-hover text-white'
                  }`}
                >
                  <Download size={14} /> 导出原始投票 CSV
                </button>
                <label className="text-xs font-medium text-blue-400 cursor-pointer hover:underline px-2">
                  <input type="file" multiple accept=".csv" className="hidden" onChange={handleFileUpload} />
                  + 添加更多文件
                </label>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">项目 ID</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10 min-w-[260px]">Prompt</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10 min-w-[220px]">评测维度</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10 min-w-[240px]">投票分布</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">共识度</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">获胜者</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10 min-w-[216px]" title={modelAName}>{modelAName}</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10 min-w-[216px]" title={modelBName}>{modelBName}</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregatedData.map((item, i) => {
                    const sourceItem = analysisItemsById.get(item.itemId);
                    const outputs = getCaseModelOutputs(sourceItem, analysisModels);
                    const dimensionValues = { ...(item.dimensionValues || {}), ...getDimensionValuesForItem(sourceItem as any) };
                    const itemTotal = item.votes.A + item.votes.B + item.votes.Tie;
                    const itemWin = getWinnerSide(item.votes);
                    const maxVotes = Math.max(item.votes.A, item.votes.B, item.votes.Tie);
                    const agreement = Math.round((maxVotes / itemTotal) * 100);
                    const prompt = item.prompt || resolveEvaluationItemPrompt(sourceItem);
                    
                    return (
                      <tr key={i} className="border-b border-white/10 hover:bg-white/5">
                        <td className="p-4 text-sm text-slate-300 font-mono">{item.itemId}</td>
                        <td className="p-4 text-sm text-slate-300 whitespace-pre-wrap break-words max-w-md">{prompt || '-'}</td>
                        <td className="p-4 min-w-[220px]">
                          <DimensionChips values={dimensionValues} label="" />
                        </td>
                        <td className="p-4">
                          <div className="flex h-2 rounded-full overflow-hidden bg-white/10 w-full max-w-[220px]">
                            <div className="bg-blue-500" style={{ width: `${(item.votes.A / itemTotal) * 100}%` }} title={`${outputs.a.modelName}: ${item.votes.A}`} />
                            <div className="bg-slate-500" style={{ width: `${(item.votes.Tie / itemTotal) * 100}%` }} title={`Tie: ${item.votes.Tie}`} />
                            <div className="bg-indigo-500" style={{ width: `${(item.votes.B / itemTotal) * 100}%` }} title={`${outputs.b.modelName}: ${item.votes.B}`} />
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-slate-400 max-w-[220px]">
                            <span className="truncate" title={outputs.a.modelName}>{outputs.a.modelName}: {item.votes.A}</span>
                            <span className="truncate text-right" title={outputs.b.modelName}>{outputs.b.modelName}: {item.votes.B}</span>
                            <span className="col-span-2 text-center">平局: {item.votes.Tie}</span>
                          </div>
                        </td>
                        <td className="p-4">
                           <span className={`px-2 py-1 rounded text-xs font-medium ${agreement < 60 ? 'bg-orange-500/10 text-orange-400' : 'bg-green-500/10 text-green-400'}`}>
                             {agreement}% 一致
                           </span>
                        </td>
                        <td className="p-4 font-bold text-sm text-slate-200 min-w-[140px]" title={getWinnerLabel(itemWin, { a: outputs.a.modelName, b: outputs.b.modelName })}>
                          {getWinnerLabel(itemWin, { a: outputs.a.modelName, b: outputs.b.modelName })}
                        </td>
                        <td className="p-4">
                          <AnalysisMediaPreview
                            url={outputs.a.url}
                            mediaType={sourceItem?.type}
                            label={outputs.a.modelName}
                          />
                        </td>
                        <td className="p-4">
                          <AnalysisMediaPreview
                            url={outputs.b.url}
                            mediaType={sourceItem?.type}
                            label={outputs.b.modelName}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalysisScreen;
