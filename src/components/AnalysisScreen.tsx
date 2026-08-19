import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, FileText, BarChart3, Users, AlertCircle, Download, ArrowRight, Database, Loader2 } from 'lucide-react';
import { AggregatedResult, EvalParadigm, EvaluationConfig, EvalTask, EvalTemplate, EvaluationItem, EvaluationProject, ModelOutput, RankingEntry, TaskVoteGroup, VoteRecord, VoteType } from '../types';
import { ArenaRankPromptItem, getModelOutputsForItem, isArenaRankVote, resolveEvaluationItemPrompt, sortRanking, validateRanking } from '../rankingUtils';
import { VIDEO_EXTENSIONS } from '../constants';
import { db, getCurrentReviewerIdentity, handlePersistenceError } from '../auth';
import { collection, getDocs } from '../datastore';
import ResultsInsightsScreen from './ResultsInsightsScreen';
import ScoreInsightsScreen from './ScoreInsightsScreen';
import { getDimensionValuesForItem, getDimensionValuesFromRecord } from '../dimensionUtils';
import Papa from 'papaparse';
import { getDefaultEvaluationConfig, getParadigmFromMethod, isPairwiseMethod, isScoreMethod, normalizeEvaluationConfig } from '../evaluationMethods';
import { subscribeProjects } from '../features/projects/api';
import { subscribeTemplates } from '../features/templates/api';
import { loadMyTaskVotes, loadTaskItems, loadTaskVotes, USE_TASK_API_BACKEND } from '../features/tasks/api';
import { subscribeTasks } from '../features/tasks/api';
import { getVoteAuditCsvValues, VOTE_AUDIT_CSV_HEADERS } from '../taskItemSnapshot';
import { buildInsightPath, normalizeInsightScope, ReviewerScope } from '../insightDeepLink';
import {
  getTaskVoteGroupReviewerKey,
  getVoteReviewerKey,
  isTaskVoteGroupForReviewer,
  withTaskVoteGroupReviewer,
} from '../taskResults';
import { LatestRequestGate } from '../latestRequestGate';
import type { InsightExportContext } from '../insightExports';

interface AnalysisScreenProps {
  onBack: () => void;
  returnAction?: { label: string; onClick: () => void };
  source?: 'dashboard' | 'task';
  initialProjectId?: string;
  initialMaterialId?: string;
  initialScope?: string;
  initialReviewerScope?: ReviewerScope;
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
  reviewerKey?: string;
  auditVote?: VoteRecord;
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
  archivedVoteRows: ArchivedVoteRow[];
}

interface ArchivedVoteRow {
  taskId: string;
  taskName: string;
  user: string;
  vote: VoteRecord;
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

const getWinnerLabel = (winner: VoteType, modelNames: AnalysisModelNames) => {
  if (winner === 'A') return modelNames.a;
  if (winner === 'B') return modelNames.b;
  return '平局';
};

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

const UNASSIGNED_PROJECT_ID = '__unassigned_project__';

const AnalysisScreen: React.FC<AnalysisScreenProps> = ({
  onBack,
  returnAction,
  source,
  initialProjectId,
  initialMaterialId,
  initialScope,
  initialReviewerScope = 'all',
}) => {
  const location = useLocation();
  const navigateTo = useNavigate();
  const [aggregatedData, setAggregatedData] = useState<AggregatedResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [projects, setProjects] = useState<EvaluationProject[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const initialRouteScope = normalizeInsightScope(initialScope) || (initialMaterialId ? `material:${initialMaterialId}` : '');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(initialRouteScope.replace(/^material:/, ''));
  const [reviewerScope, setReviewerScope] = useState<ReviewerScope>(initialReviewerScope);
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
  const [archivedVoteRows, setArchivedVoteRows] = useState<ArchivedVoteRow[]>([]);
  const resultRequestGateRef = useRef(new LatestRequestGate());
  const previousInitialProjectId = useRef(initialProjectId);
  const previousInitialScope = useRef(initialScope);
  const previousInitialReviewerScope = useRef(initialReviewerScope);

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

  useEffect(() => {
    if (previousInitialProjectId.current === initialProjectId) return;
    previousInitialProjectId.current = initialProjectId;
    setSelectedProjectId(initialProjectId || '');
    const linkedMaterialId = normalizeInsightScope(initialScope)?.replace(/^material:/, '') || initialMaterialId || '';
    setSelectedMaterialId(linkedMaterialId);
    setLoadedScopeKey('');
  }, [initialMaterialId, initialProjectId, initialScope]);

  useEffect(() => {
    if (previousInitialScope.current === initialScope) return;
    previousInitialScope.current = initialScope;
    const nextScope = normalizeInsightScope(initialScope) || '';
    setSelectedMaterialId(nextScope.replace(/^material:/, ''));
    setLoadedScopeKey('');
  }, [initialScope]);

  useEffect(() => {
    if (previousInitialReviewerScope.current === initialReviewerScope) return;
    previousInitialReviewerScope.current = initialReviewerScope;
    setReviewerScope(initialReviewerScope);
    setLoadedScopeKey('');
  }, [initialReviewerScope]);

  const getMaterialEvaluationConfig = (task?: EvalTask): EvaluationConfig => {
    const template = templates.find(item => item.id === task?.templateId);
    return normalizeEvaluationConfig(task, template);
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

    return scoped.sort((left, right) => right.createdAt - left.createdAt || left.name.localeCompare(right.name));
  }, [selectedProjectId, tasks]);

  const selectedProjectName = selectedProjectId === UNASSIGNED_PROJECT_ID
    ? '未归属项目'
    : projects.find(project => project.id === selectedProjectId)?.name || '未命名项目';

  useEffect(() => {
    if (loadingTasks || selectedProjectId || projectOptions.length === 0) return;
    const linkedMaterialId = normalizeInsightScope(initialScope)?.replace(/^material:/, '') || initialMaterialId;
    const linkedTask = linkedMaterialId ? tasks.find(task => task.id === linkedMaterialId) : undefined;
    const linkedProjectId = linkedTask?.projectId || (linkedTask ? UNASSIGNED_PROJECT_ID : undefined);
    const fallbackProjectId = [initialProjectId, linkedProjectId]
      .find(projectId => projectId && projectOptions.some(project => project.id === projectId))
      || projectOptions[0].id;
    setSelectedProjectId(fallbackProjectId);
  }, [initialMaterialId, initialProjectId, initialScope, loadingTasks, projectOptions, selectedProjectId, tasks]);

  useEffect(() => {
    if (loadingTasks || !selectedProjectId) return;
    const linkedMaterialId = normalizeInsightScope(initialScope)?.replace(/^material:/, '') || initialMaterialId || '';
    if (linkedMaterialId && projectMaterials.some(task => task.id === linkedMaterialId)) {
      if (selectedMaterialId !== linkedMaterialId) setSelectedMaterialId(linkedMaterialId);
      return;
    }
    if (selectedMaterialId && !projectMaterials.some(task => task.id === selectedMaterialId)) {
      setSelectedMaterialId('');
      setLoadedScopeKey('');
    }
  }, [initialMaterialId, initialScope, loadingTasks, projectMaterials, selectedMaterialId, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const nextPath = buildInsightPath({
      projectId: selectedProjectId,
      scope: selectedMaterialId ? `material:${selectedMaterialId}` : undefined,
      reviewerScope,
      source,
    });
    if (nextPath !== `${location.pathname}${location.search}`) {
      navigateTo(nextPath, { replace: true });
    }
  }, [location.pathname, location.search, navigateTo, reviewerScope, selectedMaterialId, selectedProjectId, source]);

  const loadMaterialResult = async (materialId: string, signal?: AbortSignal): Promise<ImportedMaterialResult> => {
    const selectedTask = tasks.find(task => task.id === materialId);
    if (!selectedTask) {
      throw new Error('未找到评测物料。');
    }

    const selectedEvaluationConfig = getMaterialEvaluationConfig(selectedTask);
    const selectedParadigm = getParadigmFromMethod(selectedEvaluationConfig.method);
    const reviewer = getCurrentReviewerIdentity();
    const voteGroupsPromise: Promise<TaskVoteGroup[]> = USE_TASK_API_BACKEND && reviewerScope === 'mine'
      ? loadMyTaskVotes(materialId, signal).then(myVotes => [{
          user: reviewer.displayName,
          displayName: reviewer.displayName,
          userId: reviewer.id,
          email: reviewer.email,
          votes: myVotes,
        }])
      : loadTaskVotes(materialId, signal).then(loadedVoteGroups => reviewerScope === 'mine'
          ? loadedVoteGroups.filter(group => isTaskVoteGroupForReviewer(group, reviewer))
          : loadedVoteGroups);
    const taskModelNames = getTaskModelNames(selectedTask);
    const taskModelList = selectedTask.models?.length ? selectedTask.models : [
      { id: 'model-a', name: taskModelNames.a },
      { id: 'model-b', name: taskModelNames.b }
    ];
    const sourceItemsPromise = USE_TASK_API_BACKEND
      ? loadTaskItems(selectedTask, { signal })
      : getDocs(collection(db, 'evalTasks', materialId, 'items')).then(snapshot => snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        } as EvaluationItem)));
    let [voteGroups, sourceItems] = await Promise.all([voteGroupsPromise, sourceItemsPromise]);
    if (signal?.aborted) throw new DOMException('Result load aborted.', 'AbortError');
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
    voteGroups = voteGroups.map(group => ({
      ...group,
      votes: [...(group.votes || [])],
      archivedVotes: [...(group.archivedVotes || [])],
    }));
    const reviewerAwareVoteGroups = voteGroups.map(group => {
      const reviewerKey = getTaskVoteGroupReviewerKey(group);
      const displayName = group.displayName || group.user || group.email || 'Anonymous';
      return {
        ...group,
        votes: withTaskVoteGroupReviewer(group),
        archivedVotes: (group.archivedVotes || []).map(vote => ({
          ...vote,
          user: vote.user || displayName,
          reviewerKey: vote.reviewerKey || reviewerKey,
        })),
      };
    });
    const archivedVoteRows: ArchivedVoteRow[] = reviewerAwareVoteGroups.flatMap(group =>
      (group.archivedVotes || []).map(vote => ({
        taskId: selectedTask.id,
        taskName: selectedTask.name,
        user: vote.user || group.user,
        vote,
      }))
    );

    if (selectedParadigm === 'Arena-rank') {
      const importedRankVotes: VoteRecord[] = [];

      reviewerAwareVoteGroups.forEach(({ votes: userVotes }) => {

        userVotes.forEach((v: VoteRecord) => {
          if (!v.itemId || !isArenaRankVote(v)) return;
          importedRankVotes.push(v);
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
        archivedVoteRows
      };
    }

    if (isScoreMethod(selectedEvaluationConfig) || isPairwiseMethod(selectedEvaluationConfig)) {
      const importedMethodVotes: VoteRecord[] = [];

      reviewerAwareVoteGroups.forEach(({ votes: userVotes }) => {

        userVotes.forEach((v: VoteRecord) => {
          if (!v.itemId) return;
          if (isScoreMethod(selectedEvaluationConfig) && !v.rubricResponses) return;
          if (isPairwiseMethod(selectedEvaluationConfig) && !v.pairContext) return;
          importedMethodVotes.push({ ...v, method: v.method || selectedEvaluationConfig.method });
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
        archivedVoteRows
      };
    }

    const newAggregated: Record<string, AggregatedResult> = {};
    const importedVoteRows: AnalysisVoteRow[] = [];
    const itemById = new Map(importedAnalysisItems.map(item => [item.id, item]));
    const voters = new Set<string>();
    const reviewerKeys = new Set<string>();

    reviewerAwareVoteGroups.forEach(({ votes: userVotes }) => {

      userVotes.forEach((v: any) => {
        const itemId = v.itemId;
        const winner = normalizeVoteSide(v.vote, taskModelNames);

        if (!itemId || !winner) return;

        const reviewerKey = getVoteReviewerKey(v);
        const reviewerName = v.user || 'Anonymous';
        voters.add(reviewerName);
        reviewerKeys.add(reviewerKey);
        const sourceItem = itemById.get(itemId);

        if (!newAggregated[itemId]) {
          newAggregated[itemId] = {
            itemId,
            prompt: sourceItem ? resolveEvaluationItemPrompt(sourceItem) : '',
            dimensionValues: getDimensionValuesForItem(sourceItem as any, selectedTask.dimensionColumns || []),
            votes: { A: 0, B: 0, Tie: 0 },
            voters: [],
            reviewerKeys: [],
          };
        } else if (!newAggregated[itemId].prompt && sourceItem) {
          newAggregated[itemId].prompt = resolveEvaluationItemPrompt(sourceItem);
          newAggregated[itemId].dimensionValues = newAggregated[itemId].dimensionValues || getDimensionValuesForItem(sourceItem as any, selectedTask.dimensionColumns || []);
        }

        if (winner === 'A') newAggregated[itemId].votes.A++;
        else if (winner === 'B') newAggregated[itemId].votes.B++;
        else if (winner === 'Tie') newAggregated[itemId].votes.Tie++;

        newAggregated[itemId].voters.push(reviewerName);
        newAggregated[itemId].reviewerKeys?.push(reviewerKey);
        importedVoteRows.push({
          itemId,
          vote: winner,
          timestamp: Number(v.timestamp) || Date.now(),
          user: reviewerName,
          reviewerKey,
          auditVote: v
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
      archivedVoteRows
    };
  };

  const resetAnalysisResult = () => {
    setAggregatedData([]);
    setRankVotes([]);
    setRankItems([]);
    setAnalysisItems([]);
    setAnalysisVoteRows([]);
    setArchivedVoteRows([]);
    setMethodVotes([]);
    setAnalysisModelList([]);
    setAnalysisEvaluationConfig(null);
    setAnalysisMode(null);
  };

  const applyImportedMaterialResult = (result?: ImportedMaterialResult) => {
    resetAnalysisResult();
    if (!result) {
      return;
    }

    setArchivedVoteRows(result.archivedVoteRows);
    const selectedParadigm = result.paradigm;
    const selectedConfig = result.evaluationConfig;

    if (isScoreMethod(selectedConfig) || isPairwiseMethod(selectedConfig)) {
      if (result.methodVotes.length === 0) {
        setError(reviewerScope === 'mine' ? '你尚未在这份评测物料中提交有效结果。' : '这份评测物料暂无可分析的评分或对战结果。');
      } else {
        setAnalysisItems(result.analysisItems);
        setMethodVotes(result.methodVotes);
        setAnalysisModelList(result.modelList);
        setAnalysisModels(result.modelNames);
        setAnalysisEvaluationConfig(selectedConfig);
        setAnalysisMode(selectedParadigm);
      }
      return;
    }

    if (selectedParadigm === 'Arena-rank') {
      if (result.rankVotes.length === 0) {
        setError(reviewerScope === 'mine' ? '你尚未在这份评测物料中提交有效结果。' : '这份评测物料暂无排名结果。');
      } else {
        setRankVotes(result.rankVotes);
        setRankItems(result.rankItems);
        setAnalysisModelList(result.modelList);
        setAnalysisEvaluationConfig(selectedConfig);
        setAnalysisModels(DEFAULT_ANALYSIS_MODELS);
        setAnalysisMode('Arena-rank');
      }
      return;
    }

    if (result.aggregatedData.length === 0 || result.aggregatedData.every(item => item.votes.A + item.votes.B + item.votes.Tie === 0)) {
      setError(reviewerScope === 'mine' ? '你尚未在这份评测物料中提交有效结果。' : '这份评测物料暂无评测结果。');
    } else {
      setAggregatedData(result.aggregatedData);
      setAnalysisItems(result.analysisItems);
      setAnalysisModels(result.modelNames);
      setAnalysisModelList(result.modelList);
      setAnalysisEvaluationConfig(selectedConfig);
      setAnalysisVoteRows(result.voteRows);
      setAnalysisMode(selectedParadigm);
    }
  };

  const handleImportFromPlatform = async (materialId: string = selectedMaterialId) => {
    if (!materialId) return;
    const request = resultRequestGateRef.current.begin();
    const scopeKey = `${selectedProjectId}|${materialId}|${reviewerScope}`;
    setLoadingResults(true);
    setError(null);
    try {
      const result = await loadMaterialResult(materialId, request.controller.signal);
      if (!resultRequestGateRef.current.isCurrent(request)) return;
      applyImportedMaterialResult(result);
      setLoadedScopeKey(scopeKey);
    } catch (err: any) {
      if (!resultRequestGateRef.current.isCurrent(request) || err?.name === 'AbortError') return;
      resetAnalysisResult();
      setError(err?.message || '读取评测结果失败，请稍后重试。');
      handlePersistenceError(err, 'list', `evalTasks/${materialId}/userVotes`);
    } finally {
      if (resultRequestGateRef.current.isCurrent(request)) {
        resultRequestGateRef.current.finish(request);
        setLoadingResults(false);
      }
    }
  };

  useEffect(() => {
    if (loadingTasks) return;
    if (!selectedMaterialId) {
      resultRequestGateRef.current.cancel();
      resetAnalysisResult();
      setLoadingResults(false);
      setError(null);
      setLoadedScopeKey('');
      return;
    }
    const scopeKey = `${selectedProjectId}|${selectedMaterialId}|${reviewerScope}`;
    if (loadedScopeKey === scopeKey) return;
    handleImportFromPlatform(selectedMaterialId);
  }, [loadedScopeKey, loadingTasks, reviewerScope, selectedMaterialId, selectedProjectId]);

  useEffect(() => () => {
    resultRequestGateRef.current.cancel();
  }, []);

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
    setArchivedVoteRows([]);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAggregated: Record<string, AggregatedResult> = {};
    const newAnalysisItemsById = new Map<string, EvaluationItem>();
    const newAnalysisVoteRows: AnalysisVoteRow[] = [];
    const newRankVotes: VoteRecord[] = [];
    const newPairwiseVotes: VoteRecord[] = [];
    const newPairwiseModels = new Map<string, { id: string; name: string }>();
    const newRankItemsById = new Map<string, ArenaRankPromptItem>();
    const voters = new Set<string>();
    const selectedTask = tasks.find(task => task.id === selectedMaterialId);
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
              setAnalysisMode('Pairwise');
            } else if (validRowsFound === 0) {
              setError("未能从上传的文件中识别出有效的投票结果。请确保 CSV 文件包含 'Item ID' 和 'Winner' 列。");
            } else {
              setAggregatedData(Object.values(newAggregated));
              setRankVotes([]);
              setRankItems([]);
              setAnalysisItems(Array.from(newAnalysisItemsById.values()));
              setAnalysisModels(importedModelNames);
              setAnalysisVoteRows(newAnalysisVoteRows);
              setMethodVotes([]);
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
    if (!selectedMaterialId) {
      setError("请先选择一份评测物料，然后再下载对应的数据模板。");
      return;
    }

    setIsDownloadingTemplate(true);
    setError(null);

    try {
      const selectedTask = tasks.find(t => t.id === selectedMaterialId);
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
      
      const taskName = tasks.find(t => t.id === selectedMaterialId)?.name || 'task';
      link.setAttribute('download', `${taskName}_template.csv`);
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      handlePersistenceError(err, 'list', `evalTasks/${selectedMaterialId}/items`);
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const isArenaRankAnalysis = analysisMode === 'Arena-rank';
  const selectedMaterial = projectMaterials.find(task => task.id === selectedMaterialId);
  const reviewerScopeLabel = reviewerScope === 'mine' ? '我的结果' : '全员汇总';
  const insightExportContext: InsightExportContext = {
    projectId: selectedProjectId === UNASSIGNED_PROJECT_ID ? '' : selectedProjectId,
    projectName: selectedProjectName,
    materialId: selectedMaterial?.id || selectedMaterialId,
    materialName: selectedMaterial?.name || '结果洞察',
    evaluationMethod: analysisEvaluationConfig?.method
      || selectedMaterial?.evaluationConfig?.method
      || (isArenaRankAnalysis ? 'rank_order' : 'ab_preference'),
    reviewerScope,
    reviewerScopeLabel,
  };
  const insightSubtitle = selectedMaterial
    ? `${selectedProjectName} · ${selectedMaterial.name} · ${reviewerScopeLabel}`
    : `${selectedProjectName} · 请选择评测物料`;

  const insightControls = (
    <div className="glass-panel p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.25fr)_minmax(205px,auto)_auto] xl:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">选择项目</span>
          <select
            value={selectedProjectId}
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              setSelectedMaterialId('');
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
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">评测物料</span>
          <select
            value={selectedMaterialId}
            onChange={(event) => {
              setSelectedMaterialId(event.target.value);
              setLoadedScopeKey('');
            }}
            className="glass-input w-full min-w-0 px-3 py-2 text-sm"
            disabled={projectMaterials.length === 0}
            aria-label="选择一份评测物料"
          >
            <option value="">请选择评测物料</option>
            {projectMaterials.map(material => (
              <option key={material.id} value={material.id}>
                {material.name} · {taskStatusLabel(material.status)}
              </option>
            ))}
          </select>
        </label>

        <div className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">评委范围</span>
          <div className="inline-flex h-10 border border-white/10 bg-black/30 p-0.5" role="group" aria-label="选择评委范围">
            {([
              { value: 'all' as const, label: '全员汇总' },
              { value: 'mine' as const, label: '我的结果' },
            ]).map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={reviewerScope === option.value}
                onClick={() => {
                  setReviewerScope(option.value);
                  setLoadedScopeKey('');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors ${reviewerScope === option.value ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
              >
                <Users size={13} /> {option.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleImportFromPlatform(selectedMaterialId)}
          disabled={!selectedMaterialId || loadingResults}
          className="btn-primary h-10 disabled:opacity-50"
        >
          {loadingResults ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
          刷新洞察
        </button>
      </div>
    </div>
  );

  const escapeCsvField = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const downloadArchivedVotesCsv = () => {
    if (!archivedVoteRows.length) return;
    const headers = [
      'TaskID',
      'TaskName',
      'ArchiveStatus',
      'ArchiveReason',
      'ItemID',
      'User',
      'Timestamp',
      'Method',
      'VoteOrChoice',
      'Ranking_JSON',
      'Scores_JSON',
      'RubricResponses_JSON',
      'PairContext_JSON',
      'Reason',
      ...VOTE_AUDIT_CSV_HEADERS,
    ];
    const rows = archivedVoteRows.map(({ taskId, taskName, user, vote }) => [
      taskId,
      taskName,
      'archived',
      vote.archivedReason || '',
      vote.itemId,
      vote.user || user,
      new Date(vote.timestamp).toISOString(),
      vote.method || '',
      vote.vote || vote.choice || '',
      vote.ranking ? JSON.stringify(vote.ranking) : '',
      vote.scores ? JSON.stringify(vote.scores) : '',
      vote.rubricResponses ? JSON.stringify(vote.rubricResponses) : '',
      vote.pairContext ? JSON.stringify(vote.pairContext) : '',
      vote.reason || '',
      ...getVoteAuditCsvValues(vote),
    ].map(escapeCsvField).join(','));
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `archived_vote_evidence_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const resultReturnAction = returnAction || { label: '返回评测物料', onClick: onBack };
  const resultNotices = (
    <>
      {error && (
        <div className="flex items-start gap-3 border border-red-400/30 border-l-2 border-l-red-400 bg-[#151116] px-4 py-3 text-sm text-red-100">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {archivedVoteRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-400/30 bg-[#17150f] px-4 py-3 text-sm text-amber-100">
          <div>
            <div className="font-semibold">已保留 {archivedVoteRows.length} 条归档评审证据</div>
            <div className="mt-1 text-xs text-amber-100/65">归档记录不参与当前统计，可单独下载评测时快照、归档原因和版本信息。</div>
          </div>
          <button type="button" onClick={downloadArchivedVotesCsv} className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs">
            <Download size={14} /> 归档审计 CSV
          </button>
        </div>
      )}
    </>
  );
  const resultActions = (
    <>
      <label className="btn-secondary inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
        <Upload size={14} /> 追加外部 CSV
        <input type="file" multiple accept=".csv" className="hidden" onChange={handleFileUpload} />
      </label>
      <button
        type="button"
        onClick={downloadTemplate}
        disabled={!selectedMaterialId || isDownloadingTemplate}
        className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isDownloadingTemplate ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        数据模板
      </button>
    </>
  );

  if (methodVotes.length > 0 && analysisEvaluationConfig && (isScoreMethod(analysisEvaluationConfig) || isPairwiseMethod(analysisEvaluationConfig))) {
    return (
      <ScoreInsightsScreen
        mode={isPairwiseMethod(analysisEvaluationConfig) ? 'pairwise' : 'score'}
        title="结果洞察"
        description={insightSubtitle}
        controls={insightControls}
        items={analysisItems}
        votes={methodVotes}
        models={analysisModelList.length ? analysisModelList : []}
        config={analysisEvaluationConfig}
        returnAction={resultReturnAction}
        additionalActions={resultActions}
        notices={resultNotices}
        exportContext={insightExportContext}
      />
    );
  }

  if (aggregatedData.length > 0 || rankVotes.length > 0) {
    return (
      <ResultsInsightsScreen
        mode={isArenaRankAnalysis ? 'rank' : 'ab'}
        title="结果洞察"
        description={insightSubtitle}
        controls={insightControls}
        items={isArenaRankAnalysis ? rankItems as any : analysisItems}
        votes={isArenaRankAnalysis ? rankVotes : analysisVoteRows.flatMap(row => row.auditVote ? [row.auditVote] : [])}
        aggregatedData={isArenaRankAnalysis ? [] : aggregatedData}
        rawVoteRows={isArenaRankAnalysis ? [] : analysisVoteRows}
        modelNames={analysisModels}
        models={analysisModelList}
        returnAction={resultReturnAction}
        additionalActions={resultActions}
        notices={resultNotices}
        exportContext={insightExportContext}
      />
    );
  };

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {resultReturnAction && (
            <button
              type="button"
              onClick={resultReturnAction.onClick}
              className="btn-secondary mb-4 inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              <ArrowRight className="rotate-180" size={16} />
              {resultReturnAction.label}
            </button>
          )}
          <h1 className="text-3xl font-bold text-slate-100">结果洞察</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{insightSubtitle}</p>
        </div>
        <button type="button" onClick={onBack} className="btn-secondary w-fit px-5 py-2.5 text-sm">
          去参与评测
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-3 border border-red-400/30 bg-red-950/30 p-4 text-red-200">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {insightControls}
      {resultNotices}

      <section className="glass-panel min-h-[280px] p-8">
        {loadingResults ? (
          <div className="flex min-h-[210px] flex-col items-center justify-center gap-3 text-slate-300">
            <Loader2 className="h-7 w-7 animate-spin text-amber-300" />
            <p className="text-sm">正在加载评测结果与 case 证据...</p>
          </div>
        ) : !selectedMaterialId ? (
          <div className="flex min-h-[210px] flex-col items-center justify-center text-center">
            <Database className="mb-4 h-9 w-9 text-slate-500" />
            <h2 className="text-lg font-bold text-slate-100">请选择一份评测物料</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              选择后会在当前页面展示统计结论、图表、维度分析、逐 case 结果与原始评审记录。
            </p>
          </div>
        ) : (
          <div className="flex min-h-[210px] flex-col items-center justify-center text-center">
            <FileText className="mb-4 h-9 w-9 text-slate-500" />
            <h2 className="text-lg font-bold text-slate-100">当前范围暂无有效结果</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              可以切换评委范围、刷新洞察，或追加外部 CSV。跳过记录不会进入有效统计。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">{resultActions}</div>
          </div>
        )}
      </section>
    </div>
  );
};

export default AnalysisScreen;
