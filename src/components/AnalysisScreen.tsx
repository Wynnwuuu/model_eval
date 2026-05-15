import React, { useState, useEffect } from 'react';
import { Upload, FileText, BarChart3, Users, AlertCircle, PlusCircle, Download, ArrowRight, Database, Loader2, ExternalLink } from 'lucide-react';
import { AggregatedResult, EvalParadigm, EvalTask, EvalTemplate, EvaluationItem, ModelOutput, RankingEntry, VoteRecord, VoteType } from '../types';
import { ArenaRankPromptItem, calculateArenaRankCaseSummaries, calculateArenaRankModelStats, getArenaRankModelOutputUrl, getBordaScore, getModelOutputsForItem, isArenaRankVote, resolveEvaluationItemPrompt, sortRanking } from '../rankingUtils';
import { VIDEO_EXTENSIONS } from '../constants';
import { db, handleFirestoreError } from '../firebase';
import { collection, getDocs, query, orderBy } from '../datastore';
import ArenaRankVideoPreviewList from './ArenaRankVideoPreviewList';
import MediaRenderer from './MediaRenderer';
import DimensionChips from './DimensionChips';
import { calculateRankDimensionSummaries, calculateVoteDimensionSummaries, getDimensionColumnsForCsv, getDimensionCsvValues, getDimensionValuesForItem, getDimensionValuesFromRecord } from '../dimensionUtils';
import Papa from 'papaparse';

interface AnalysisScreenProps {
  onBack: () => void;
  onGoToDashboard?: () => void;
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

const DEFAULT_ANALYSIS_MODELS: AnalysisModelNames = { a: 'Model A', b: 'Model B' };

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
    .map(entry => ({
      modelId: entry.modelId,
      modelName: entry.modelName,
      url: getRankVideoUrlFromRow(row, keys, entry.rank)
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

const AnalysisScreen: React.FC<AnalysisScreenProps> = ({ onBack, onGoToDashboard }) => {
  const [aggregatedData, setAggregatedData] = useState<AggregatedResult[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [uniqueVoters, setUniqueVoters] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [loadingResults, setLoadingResults] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<EvalParadigm | null>(null);
  const [rankVotes, setRankVotes] = useState<VoteRecord[]>([]);
  const [rankItems, setRankItems] = useState<ArenaRankPromptItem[]>([]);
  const [analysisItems, setAnalysisItems] = useState<EvaluationItem[]>([]);
  const [analysisModels, setAnalysisModels] = useState<AnalysisModelNames>(DEFAULT_ANALYSIS_MODELS);
  const [analysisVoteRows, setAnalysisVoteRows] = useState<AnalysisVoteRow[]>([]);

  useEffect(() => {
    const fetchTasks = async () => {
      setLoadingTasks(true);
      try {
        const q = query(collection(db, 'evalTasks'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const fetchedTasks: EvalTask[] = [];
        snapshot.forEach(doc => {
          fetchedTasks.push({ id: doc.id, ...doc.data() } as EvalTask);
        });
        setTasks(fetchedTasks);

        const templatesSnapshot = await getDocs(collection(db, 'evalTemplates'));
        const fetchedTemplates: EvalTemplate[] = [];
        templatesSnapshot.forEach(doc => {
          fetchedTemplates.push({ id: doc.id, ...doc.data() } as EvalTemplate);
        });
        setTemplates(fetchedTemplates);
      } catch (err) {
        handleFirestoreError(err, 'list', 'evalTasks');
      } finally {
        setLoadingTasks(false);
      }
    };
    fetchTasks();
  }, []);

  const handleImportFromPlatform = async () => {
    if (!selectedTaskId) return;
    setLoadingResults(true);
    setError(null);
    try {
      const selectedTask = tasks.find(task => task.id === selectedTaskId);
      const selectedTemplate = templates.find(template => template.id === selectedTask?.templateId);
      const selectedParadigm = (selectedTemplate?.paradigm || 'Arena') as EvalParadigm;
      const votesRef = collection(db, 'evalTasks', selectedTaskId, 'userVotes');
      const snapshot = await getDocs(votesRef);
      const taskModelNames = getTaskModelNames(selectedTask);
      const taskModelList = selectedTask?.models?.length ? selectedTask.models : [
        { id: 'model-a', name: taskModelNames.a },
        { id: 'model-b', name: taskModelNames.b }
      ];
      const itemsSnapshot = await getDocs(collection(db, 'evalTasks', selectedTaskId, 'items'));
      const importedAnalysisItems = itemsSnapshot.docs.map(docSnap => {
        const item = {
          id: docSnap.id,
          ...docSnap.data()
        } as EvaluationItem;
        const modelOutputs = getModelOutputsForItem(item, taskModelList);
        return {
          ...item,
          prompt: resolveEvaluationItemPrompt(item),
          modelOutputs,
          dimensionValues: getDimensionValuesForItem(item as any, selectedTask?.dimensionColumns || []),
          type: normalizeOutputMediaType(selectedTask?.outputType, [item.modelA_Url, item.modelB_Url, ...modelOutputs.map(output => output.url)])
        } as EvaluationItem;
      });

      if (selectedParadigm === 'Arena-rank') {
        const importedRankVotes: VoteRecord[] = [];
        const importedRankItems = importedAnalysisItems as ArenaRankPromptItem[];
        const voters = new Set<string>();

        snapshot.forEach(docSnap => {
          const userData = docSnap.data();
          const userVotes = userData.votes || [];
          const user = docSnap.id;

          userVotes.forEach((v: VoteRecord) => {
            if (!v.itemId || !isArenaRankVote(v)) return;
            importedRankVotes.push({ ...v, user: v.user || user });
            voters.add(user);
          });
        });

        if (importedRankVotes.length === 0) {
          setError("该 Arena-rank 任务暂无排名结果。");
        } else {
          setRankVotes(importedRankVotes);
          setRankItems(importedRankItems);
          setAggregatedData([]);
          setAnalysisItems([]);
          setAnalysisVoteRows([]);
          setAnalysisModels(DEFAULT_ANALYSIS_MODELS);
          setUniqueVoters(voters);
          setAnalysisMode('Arena-rank');
        }
        return;
      }
      
      const newAggregated: Record<string, AggregatedResult> = {};
      const importedVoteRows: AnalysisVoteRow[] = [];
      const itemById = new Map(importedAnalysisItems.map(item => [item.id, item]));
      const voters = new Set<string>();
      let validRowsFound = 0;

      snapshot.forEach(docSnap => {
        const userData = docSnap.data();
        const userVotes = userData.votes || [];
        const user = docSnap.id;
        
        userVotes.forEach((v: any) => {
          const itemId = v.itemId;
          const winner = normalizeVoteSide(v.vote, taskModelNames);
          
          if (!itemId || !winner) return;

          validRowsFound++;
          voters.add(user);
          const sourceItem = itemById.get(itemId);

          if (!newAggregated[itemId]) {
            newAggregated[itemId] = {
              itemId,
              prompt: sourceItem ? resolveEvaluationItemPrompt(sourceItem) : '',
              dimensionValues: getDimensionValuesForItem(sourceItem as any, selectedTask?.dimensionColumns || []),
              votes: { A: 0, B: 0, Tie: 0 },
              voters: []
            };
          } else if (!newAggregated[itemId].prompt && sourceItem) {
            newAggregated[itemId].prompt = resolveEvaluationItemPrompt(sourceItem);
            newAggregated[itemId].dimensionValues = newAggregated[itemId].dimensionValues || getDimensionValuesForItem(sourceItem as any, selectedTask?.dimensionColumns || []);
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

      if (validRowsFound === 0) {
        setError("该任务暂无评测结果。");
      } else {
        setAggregatedData(Object.values(newAggregated));
        setRankVotes([]);
        setRankItems([]);
        setAnalysisItems(importedAnalysisItems);
        setAnalysisModels(taskModelNames);
        setAnalysisVoteRows(importedVoteRows);
        setUniqueVoters(voters);
        setAnalysisMode(selectedParadigm);
      }
    } catch (err: any) {
      handleFirestoreError(err, 'list', `evalTasks/${selectedTaskId}/userVotes`);
    } finally {
      setLoadingResults(false);
    }
  };

  const parseRankingRow = (row: any, keys: string[]): RankingEntry[] => {
    const rankingJsonKey = keys.find(k => k.toLowerCase() === 'ranking_json' || k.toLowerCase() === 'ranking');
    if (rankingJsonKey && row[rankingJsonKey]) {
      try {
        const parsed = JSON.parse(row[rankingJsonKey]);
        if (Array.isArray(parsed)) {
          return parsed
            .filter(entry => entry.modelId && entry.rank)
            .map(entry => ({
              modelId: String(entry.modelId),
              modelName: String(entry.modelName || entry.modelId),
              rank: Number(entry.rank)
            }));
        }
      } catch (err) {
        console.error("Failed to parse ranking_json", err);
      }
    }

    const rankKeys = keys
      .filter(k => /^rank_\d+$/i.test(k))
      .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]));

    return rankKeys
      .map((key, index) => {
        const rawValue = String(row[key] || '').trim();
        if (!rawValue) return null;

        const idMatch = rawValue.match(/\(([^)]+)\)\s*$/);
        const modelName = rawValue.replace(/\s*\([^)]+\)\s*$/, '').trim() || rawValue;
        const modelId = idMatch?.[1] || modelName;
        return { modelId, modelName, rank: index + 1 };
      })
      .filter((entry): entry is RankingEntry => Boolean(entry));
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
    const newRankItemsById = new Map<string, ArenaRankPromptItem>();
    const voters = new Set<string>();
    const selectedTask = tasks.find(task => task.id === selectedTaskId);
    let importedModelNames: AnalysisModelNames = getTaskModelNames(selectedTask);
    let hasResolvedModelNames = Boolean(selectedTask?.models?.length);

    let filesProcessed = 0;
    let validRowsFound = 0;
    let rankRowsFound = 0;

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
            const ranking = parseRankingRow(row, keys);

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
      setError("请先在左侧选择一个评测任务，然后再下载对应的数据模板。");
      return;
    }

    setIsDownloadingTemplate(true);
    setError(null);

    try {
      const itemsRef = collection(db, 'evalTasks', selectedTaskId, 'items');
      const snapshot = await getDocs(itemsRef);
      
      if (snapshot.empty) {
        setError("该任务没有评测物料数据。");
        setIsDownloadingTemplate(false);
        return;
      }

      const csvData: any[] = [];
      const selectedTask = tasks.find(t => t.id === selectedTaskId);
      const selectedTemplate = templates.find(t => t.id === selectedTask?.templateId);
      const isRankTemplate = selectedTemplate?.paradigm === 'Arena-rank';
      const maxOutputs = Math.max(0, ...snapshot.docs.map(doc => (doc.data().modelOutputs || []).length));
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const row: any = { 'Item ID': doc.id };
        
        // Add original data columns if available
        if (data.originalData) {
          Object.assign(row, data.originalData);
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
      handleFirestoreError(err, 'list', `evalTasks/${selectedTaskId}/items`);
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
  const analysisItemsById = new Map<string, EvaluationItem>(analysisItems.map(item => [item.id, item] as [string, EvaluationItem]));
  const analysisDimensionColumns = getDimensionColumnsForCsv(analysisItems);
  const rankDimensionColumns = getDimensionColumnsForCsv(rankItems as any);
  const voteDimensionSummaries = calculateVoteDimensionSummaries(aggregatedData);
  const rankDimensionSummaries = calculateRankDimensionSummaries(rankVotes, rankItems as any);
  const modelAName = analysisModels.a || DEFAULT_ANALYSIS_MODELS.a;
  const modelBName = analysisModels.b || DEFAULT_ANALYSIS_MODELS.b;

  const escapeCsvField = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const downloadAnalysisCsv = () => {
    let csvContent = '';

    if (isArenaRankAnalysis) {
      const maxSummaryRankCount = Math.max(0, ...rankCaseSummaries.map(item => item.ranking.length));
      const rankVideoHeaders = Array.from({ length: maxSummaryRankCount }, (_, idx) => `排名${idx + 1}视频链接`);
      const headers = ['ItemID', 'Prompt', ...rankDimensionColumns.map(col => col.header), 'Voters', 'ConsensusRanking', ...rankVideoHeaders, 'ModelStats'];
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
          item.ranking.map(entry => `#${entry.averageRank.toFixed(2)} ${entry.modelName}`).join(' | '),
          ...rankVideoValues,
          item.ranking.map(entry => `${entry.modelName}: score=${entry.totalScore}, avgRank=${entry.averageRank.toFixed(2)}, first=${entry.firstPlaceCount}`).join(' | ')
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
      ? ['Dimension', 'Value', 'ItemCount', 'RankingRecords', 'LeadingModel', 'ModelStats']
      : ['Dimension', 'Value', 'ItemCount', 'TotalVotes', 'Votes_A', 'Votes_B', 'Votes_Tie', 'Winner', 'AgreementRate', 'MarginRate'];

    const rows = isRank
      ? rankDimensionSummaries.map(summary => [
          summary.dimensionKey,
          summary.dimensionValue,
          summary.itemCount,
          summary.rankingRecords,
          summary.modelStats[0]?.modelName || '',
          summary.modelStats.map(stat => `${stat.modelName}: score=${stat.totalScore}, avgRank=${stat.averageRank.toFixed(2)}, first=${stat.firstPlaceCount}`).join(' | ')
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
          <h1 className="text-3xl font-bold text-slate-100">团队分析大盘</h1>
          <p className="text-slate-400">上传多个 CSV 结果文件以查看汇总统计信息，或在此发起新任务。</p>
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

      {aggregatedData.length === 0 && rankVotes.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Import from Platform Card */}
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md transition-shadow">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Database size={32} />
            </div>
            <h3 className="text-xl font-semibold text-slate-100 mb-2">一键导入平台结果</h3>
            <p className="text-slate-400 mb-6 max-w-sm mx-auto text-sm">
              直接从平台中选择已有的评测任务，一键导入所有成员的评测结果进行分析。
            </p>
            
            <div className="w-full max-w-xs space-y-3">
              <select 
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                disabled={loadingTasks}
              >
                <option value="">选择评测任务...</option>
                {tasks.map(task => (
                  <option key={task.id} value={task.id}>
                    {task.name} ({task.status === 'completed' ? '已完成' : '进行中'})
                  </option>
                ))}
              </select>
              
              <button 
                onClick={handleImportFromPlatform}
                disabled={!selectedTaskId || loadingResults}
                className={`w-full py-3 rounded-xl font-semibold shadow-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2 ${
                  !selectedTaskId || loadingResults 
                    ? 'bg-white/10 text-slate-500 cursor-not-allowed shadow-none' 
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                }`}
              >
                {loadingResults ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
                {loadingResults ? '导入中...' : '一键导入'}
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
            <h3 className="text-xl font-semibold text-slate-100 mb-2">如何发起团队任务？</h3>
            <div className="text-slate-400 mb-8 max-w-sm mx-auto text-sm text-left space-y-2 bg-white/5 p-4 rounded-xl border border-white/10">
              <p><strong>1.</strong> 在“评测物料”中创建任务并分配给成员。</p>
              <p><strong>2.</strong> 成员在“去参与评测”页面完成任务。</p>
              <p><strong>3.</strong> 任务完成后，在左侧一键导入平台结果。</p>
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
                {isDownloadingTemplate ? '生成中...' : (selectedTaskId ? '下载数据模板' : '请先在左侧选择任务')}
              </button>
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
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">最高积分</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <BarChart3 className="text-amber-500" />
                {rankModelStats[0]?.totalScore || 0}
              </div>
            </div>
            <div className="glass-panel p-4 rounded-xl shadow-sm">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">最佳平均名次</div>
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-100">
                <BarChart3 className="text-emerald-500" />
                {rankModelStats[0]?.averageRank.toFixed(2) || '-'}
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <h3 className="font-semibold text-slate-200">模型总积分榜</h3>
              <button onClick={downloadAnalysisCsv} className="flex items-center gap-2 px-4 py-2 bg-black/40 glass-panel-hover text-white rounded-lg text-sm font-medium">
                <Download size={16} /> 导出分析 CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">排名</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">模型</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">总积分</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">平均名次</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase border-b border-white/10">第一名次数</th>
                  </tr>
                </thead>
                <tbody>
                  {rankModelStats.map((model, index) => (
                    <tr key={model.modelId} className="border-b border-white/10 hover:bg-white/5">
                      <td className="p-4 text-sm font-mono text-amber-300">#{index + 1}</td>
                      <td className="p-4 text-sm font-bold text-slate-200">{model.modelName}</td>
                      <td className="p-4 text-sm text-slate-200">{model.totalScore}</td>
                      <td className="p-4 text-sm text-slate-200">{model.averageRank.toFixed(2)}</td>
                      <td className="p-4 text-sm text-slate-200">{model.firstPlaceCount}</td>
                    </tr>
                  ))}
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
                        <td className="p-4 text-sm font-semibold text-amber-300">{summary.modelStats[0]?.modelName || '-'}</td>
                        <td className="p-4 text-xs text-slate-300 min-w-[280px]">
                          {summary.modelStats.map(stat => `${stat.modelName}: score=${stat.totalScore}, avg=${stat.averageRank.toFixed(2)}, first=${stat.firstPlaceCount}`).join(' | ')}
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
                        <td className="p-4">
                          <ArenaRankVideoPreviewList
                            entries={item.ranking.map((entry, index) => ({
                              id: entry.modelId,
                              modelName: entry.modelName,
                              rankLabel: `#${index + 1}`,
                              metaLabel: `avg ${entry.averageRank.toFixed(2)}`,
                              videoUrl: getArenaRankModelOutputUrl(sourceItem, entry)
                            }))}
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
