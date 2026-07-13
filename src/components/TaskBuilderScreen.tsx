import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Save, Trash2, Database, LayoutTemplate, Box, CheckCircle2, Play, Link as LinkIcon, Upload, X, Users, Edit, Eye, Loader2, ClipboardList } from 'lucide-react';
import { EvalDataset, EvalTemplate, EvalTask, EvalDimension, EvalParadigm, EvaluationConfig, EvaluationItem, EvaluationMethod, EvaluationProject } from '../types';
import { db, auth } from '../auth';
import { collection, onSnapshot, query } from '../datastore';
import { ConfirmModal } from './ConfirmModal';
import Papa from 'papaparse';
import MediaRenderer from './MediaRenderer';
import DimensionChips from './DimensionChips';
import { getDimensionValuesForItem, getDimensionValuesFromRecord, isLikelyDimensionColumn } from '../dimensionUtils';
import { extractMediaUrls, resolvePlaybackUrl } from '../mediaUrlUtils';
import { sortReferenceUrls } from '../mediaTypeUtils';
import { normalizeArenaSamplingConfig } from '../arenaSampling';
import { createTaskWithItems, deleteTask, deleteTaskItem, loadTaskItems, subscribeTasks, updateTask, updateTaskItem } from '../features/tasks/api';
import { createDataset, subscribeDatasets } from '../features/datasets/api';
import { saveTemplate, subscribeTemplates } from '../features/templates/api';
import { subscribeProjects } from '../features/projects/api';
import {
  STANDARD_DATASET_FIELDS,
  appendDatasetVersion,
  buildDatasetCard,
  buildDatasetSchema,
  inferDatasetMappings,
  inferDatasetModality,
  inferInputTypeFromDataset,
  inferOutputTypeFromDataset,
  normalizeDatasetRows,
  validateDatasetItems
} from '../datasetManifest';
import {
  DEFAULT_SCORE_LEVELS,
  EVALUATION_METHOD_OPTIONS,
  buildDefaultDimensionsForMethod,
  buildPairwisePairs,
  getDefaultEvaluationConfig,
  getEvaluationMethodShortLabel,
  getMethodMinModelCount,
  getParadigmFromMethod,
  isPreviewMethod,
  normalizeEvaluationConfig,
  normalizeDimensions
} from '../evaluationMethods';

interface TaskBuilderScreenProps {
  projectId?: string;
  onBack: () => void;
  initialMode?: 'create' | 'list';
  initialStatusFilter?: EvalTask['status'];
  initialTaskId?: string;
  onClearProjectScope?: () => void;
  onEvaluateTask?: (task: EvalTask) => void;
  onOpenInsights?: (task: EvalTask) => void;
}

type TaskItemEditForm = {
  prompt: string;
  type: EvaluationItem['type'];
  inputsText: string;
  dimensionsText: string;
  startImageUrl: string;
  referenceUrlsText: string;
  expectedOutput: string;
  modelOutputs: Array<{ modelId: string; modelName: string; url: string }>;
};

const formatKeyValueText = (record?: Record<string, any>) =>
  Object.entries(record || {})
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');

const parseKeyValueText = (text: string): Record<string, string> => {
  const result: Record<string, string> = {};
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const separatorIndex = ['\t', ':', '=']
      .map(separator => trimmed.indexOf(separator))
      .filter(index => index > 0)
      .sort((a, b) => a - b)[0];
    if (!separatorIndex) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) result[key] = value;
  });
  return result;
};

const createItemEditForm = (item: EvaluationItem, task: EvalTask): TaskItemEditForm => {
  const usedIds = new Set<string>();
  const taskOutputs = (task.models || []).map((model, index) => {
    usedIds.add(model.id);
    const existing = item.modelOutputs?.find(output => output.modelId === model.id) || item.modelOutputs?.[index];
    return {
      modelId: model.id || `model-${index}`,
      modelName: model.name || existing?.modelName || `Model ${index + 1}`,
      url: existing?.url || (index === 0 ? item.modelA_Url : index === 1 ? item.modelB_Url : ''),
    };
  });
  const extraOutputs = (item.modelOutputs || [])
    .filter(output => !usedIds.has(output.modelId))
    .map(output => ({ modelId: output.modelId, modelName: output.modelName, url: output.url || '' }));

  return {
    prompt: item.prompt || '',
    type: item.type || task.outputType || 'unknown',
    inputsText: formatKeyValueText(item.inputs),
    dimensionsText: formatKeyValueText(item.dimensionValues),
    startImageUrl: item.startImageUrl || '',
    referenceUrlsText: (item.referenceUrls || []).join('\n'),
    expectedOutput: (item as any).expectedOutput || '',
    modelOutputs: [...taskOutputs, ...extraOutputs],
  };
};

const buildItemPatchFromForm = (form: TaskItemEditForm): Partial<EvaluationItem> & Record<string, any> => {
  const modelOutputs = form.modelOutputs.map(output => ({
    modelId: output.modelId,
    modelName: output.modelName,
    url: output.url.trim(),
  }));
  const referenceUrls = form.referenceUrlsText
    .split(/\r?\n/)
    .map(url => url.trim())
    .filter(Boolean);

  return {
    prompt: form.prompt,
    type: form.type,
    inputs: parseKeyValueText(form.inputsText),
    dimensionValues: parseKeyValueText(form.dimensionsText),
    startImageUrl: form.startImageUrl.trim() || undefined,
    referenceUrls: referenceUrls.length ? sortReferenceUrls(referenceUrls) : undefined,
    modelOutputs,
    modelA_Url: modelOutputs[0]?.url || '',
    modelB_Url: modelOutputs[1]?.url || '',
    expectedOutput: form.expectedOutput,
  };
};

export default function TaskBuilderScreen({
  projectId,
  onBack,
  initialMode = 'create',
  initialStatusFilter,
  initialTaskId,
  onClearProjectScope,
  onEvaluateTask,
  onOpenInsights
}: TaskBuilderScreenProps) {
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [projects, setProjects] = useState<EvaluationProject[]>([]);
  const [users, setUsers] = useState<{uid: string, email: string, displayName: string}[]>([]);
  
  const [isCreating, setIsCreating] = useState(initialMode === 'create');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewingTask, setViewingTask] = useState<EvalTask | null>(null);
  const [viewingTaskItems, setViewingTaskItems] = useState<EvaluationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newTask, setNewTask] = useState<Partial<EvalTask>>({
    name: '',
    projectId: projectId || '',
    datasetId: '',
    templateId: '',
    outputType: 'text',
    models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
    assignees: [],
    status: 'draft'
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  
  // Wizard State
  const [inputColumns, setInputColumns] = useState<string[]>([]);
  const [modelColumns, setModelColumns] = useState<string[]>([]);
  const [dimensionColumns, setDimensionColumns] = useState<string[]>([]);
  const [saveDatasetToPlatform, setSaveDatasetToPlatform] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [inputType, setInputType] = useState<'text' | 'text_image' | 'text_audio' | 'multi_turn' | 'other'>('text');
  const [evaluationConfig, setEvaluationConfig] = useState<EvaluationConfig>(getDefaultEvaluationConfig('ab_preference'));
  const [saveConfigAsRubric, setSaveConfigAsRubric] = useState(false);

  // Inline scoring preset creation state
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateParadigm, setNewTemplateParadigm] = useState<EvalParadigm>('GSB');
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const isBenchmarkPreview = isPreviewMethod(evaluationConfig);
  const [statusFilter, setStatusFilter] = useState<EvalTask['status'] | 'all'>(initialStatusFilter || 'all');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState(projectId || 'all');
  
  // Item Editing State
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemForm, setEditItemForm] = useState<TaskItemEditForm | null>(null);
  const [itemToDelete, setItemToDelete] = useState<EvaluationItem | null>(null);

  useEffect(() => {
    setNewTask(prev => ({ ...prev, projectId: projectId || '' }));
    setSelectedProjectFilter(projectId || 'all');
  }, [projectId]);

  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    setLoading(true);
    const unsubscribeTasks = subscribeTasks({}, setTasks, (error) => {
      console.error("Error fetching tasks:", error);
      setError("加载评测物料失败");
    });

    const unsubscribeDatasets = subscribeDatasets(setDatasets, (error) => {
      console.error("Error fetching datasets:", error);
      setError("加载评测集失败");
    });

    const unsubscribeTemplates = subscribeTemplates((fetchedTemplates) => {
      setTemplates(fetchedTemplates);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching templates:", error);
      setError("加载评分标准预设失败");
      setLoading(false);
    });

    const unsubscribeProjects = subscribeProjects(setProjects, (error) => {
      console.error("Error fetching projects:", error);
    });

    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const fetchedUsers: any[] = [];
      snapshot.forEach((docSnap) => {
        fetchedUsers.push(docSnap.data());
      });
      setUsers(fetchedUsers);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeDatasets();
      unsubscribeTemplates();
      unsubscribeProjects();
      unsubscribeUsers();
    };
  }, []);

  const validateSetup = () => {
    if (!newTask.name) return "请填写物料名称";

    if (csvData.length > 0 || newTask.datasetId) {
      if (inputColumns.length === 0) return "请至少选择一个输入列";
      const minModels = getMethodMinModelCount(evaluationConfig.method);
      if (modelColumns.length < minModels) {
        return `${getEvaluationMethodShortLabel(evaluationConfig.method)} 至少需要 ${minModels} 列${isBenchmarkPreview ? '输出预览' : '模型结果'}，请补充选择。`;
      }
      if ((evaluationConfig.method === 'direct_score' || evaluationConfig.method === 'rubric_score') && !(evaluationConfig.dimensions || []).some(dim => dim.type === 'star_rating')) {
        return "评分类评测至少需要一个星级打分维度。";
      }
    } else if (!newTask.datasetId) {
      return "请选择评测集或上传包含结果的CSV文件";
    }
    return null;
  };

  const autoDetectDimensionColumns = (headers: string[], blockedColumns: string[] = []) =>
    headers.filter(header => !blockedColumns.includes(header) && isLikelyDimensionColumn(header));

  const updateInputColumns = (columns: string[]) => {
    setInputColumns(columns);
    setModelColumns(prev => prev.filter(col => !columns.includes(col)));
    setDimensionColumns(prev => prev.filter(col => !columns.includes(col)));
  };

  const updateModelColumns = (columns: string[]) => {
    setModelColumns(columns);
    setInputColumns(prev => prev.filter(col => !columns.includes(col)));
    setDimensionColumns(prev => prev.filter(col => !columns.includes(col)));
  };

  const updateDimensionColumns = (columns: string[]) => {
    setDimensionColumns(columns);
    setInputColumns(prev => prev.filter(col => !columns.includes(col)));
    setModelColumns(prev => prev.filter(col => !columns.includes(col)));
  };

  const updateEvaluationMethod = (method: EvaluationMethod) => {
    const nextDefaults = getDefaultEvaluationConfig(method);
    setEvaluationConfig(prev => ({
      ...nextDefaults,
      sourceRubricId: prev.sourceRubricId,
      rubricName: prev.rubricName,
      dimensions: method === 'direct_score' || method === 'rubric_score'
        ? (prev.dimensions?.length ? normalizeDimensions(prev.dimensions, method) : nextDefaults.dimensions)
        : nextDefaults.dimensions
    }));
    setNewTask(prev => ({ ...prev, templateId: '', outputType: prev.outputType || 'text' }));

    const minModels = getMethodMinModelCount(method);
    if (modelColumns.length > 0) {
      setModelColumns(prev => method === 'rank_order' || method === 'pairwise' || method === 'benchmark_preview' ? prev : prev.slice(0, Math.max(minModels, 2)));
    }
  };

  const applyRubricTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      setNewTask(prev => ({ ...prev, templateId: '' }));
      return;
    }
    const nextConfig = normalizeEvaluationConfig({ ...(newTask as EvalTask), templateId } as EvalTask, template);
    setEvaluationConfig(nextConfig);
    setNewTask(prev => ({ ...prev, templateId }));
  };

  const updateEvaluationDimension = (index: number, updates: Partial<EvalDimension>) => {
    setEvaluationConfig(prev => {
      const dimensions = [...(prev.dimensions || [])];
      dimensions[index] = { ...dimensions[index], ...updates };
      return { ...prev, dimensions: normalizeDimensions(dimensions, prev.method) };
    });
  };

  const addEvaluationDimension = () => {
    setEvaluationConfig(prev => ({
      ...prev,
      dimensions: normalizeDimensions([
        ...(prev.dimensions || []),
        {
          id: `dim-${Date.now()}`,
          name: '新评分维度',
          description: '',
          type: 'star_rating',
          weight: 1,
          required: true,
          scope: 'secondary',
          aggregationRole: 'score',
          scale: DEFAULT_SCORE_LEVELS
        }
      ], prev.method)
    }));
  };

  const removeEvaluationDimension = (index: number) => {
    setEvaluationConfig(prev => ({
      ...prev,
      dimensions: (prev.dimensions || []).filter((_, idx) => idx !== index)
    }));
  };

  const applyDatasetDefaults = (dataset: EvalDataset) => {
    const headers = dataset.items?.[0]
      ? Object.keys(dataset.items[0]).filter(key => key !== '_originalData')
      : dataset.inputSchema?.map(field => field.key) || [];

    setCsvHeaders(headers);
    setInputColumns([]);
    setDimensionColumns([]);
    setModelColumns([]);
    const inferredInputType = inferInputTypeFromDataset(dataset);
    setInputType(dataset.inputType && dataset.inputType !== 'text' ? dataset.inputType : inferredInputType);
    setNewTask(prev => ({
      ...prev,
      datasetId: dataset.id,
      outputType: inferOutputTypeFromDataset(dataset)
    }));
  };

  const handleCreateTask = async () => {
    if (isSubmitting) return;
    
    const validationError = validateSetup();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      let finalDatasetId = newTask.datasetId;

      // If CSV data is uploaded, create a new Dataset first if requested
      if (csvData.length > 0 && !newTask.datasetId && saveDatasetToPlatform) {
        const rawDatasetItems = csvData.map((row, idx) => ({
          id: row.id || row['用例ID'] || `item-${Date.now()}-${idx}`,
          ...row
        }));
        const datasetHeaders = Object.keys(rawDatasetItems[0] || {}).filter(key => key !== '_originalData');
        const inferredMappings = inferDatasetMappings(datasetHeaders, rawDatasetItems);
        const datasetMappings = {
          ...inferredMappings,
          inputColumns,
          outputColumns: modelColumns,
          dimensionColumns,
          referenceColumns: inferredMappings.referenceColumns,
          standard: inferredMappings.standard
        };
        const datasetItems = normalizeDatasetRows(rawDatasetItems, datasetMappings);

        // Deduplication logic: check if an identical dataset already exists
        const isSameItem = (itemA: any, itemB: any) => {
          const { id: idA, ...restA } = itemA;
          const { id: idB, ...restB } = itemB;
          return JSON.stringify(restA) === JSON.stringify(restB);
        };

        const existingDataset = datasets.find(d => {
          if (!d.items || d.items.length !== datasetItems.length) return false;
          return d.items.every((item, idx) => isSameItem(item, datasetItems[idx]));
        });

        if (existingDataset) {
          finalDatasetId = existingDataset.id;
        } else {
          const modality = inferDatasetModality(datasetItems, datasetMappings);
          const versionMeta = appendDatasetVersion(
            {},
            auth.currentUser.displayName || auth.currentUser.email || 'Anonymous',
            '从物料构建器保存完整评测集',
            0,
            datasetItems.length
          );

          const newDataset = {
            name: `${newTask.name} - 自动提取评测集`.substring(0, 99),
            description: '通过上传带有生成结果的 CSV 自动提取的结构化评测集',
            tags: ['自动提取', 'CSV导入'],
            inputSchema: buildDatasetSchema(datasetHeaders, datasetItems, datasetMappings),
            inputType,
            modality,
            categoryPath: ['自动提取'],
            standardFields: STANDARD_DATASET_FIELDS,
            columnMappings: datasetMappings,
            items: datasetItems,
            datasetCard: buildDatasetCard(
              {
                name: `${newTask.name} - 自动提取评测集`,
                description: '通过上传带有生成结果的 CSV 自动提取的结构化评测集',
                tags: ['自动提取', 'CSV导入'],
                items: datasetItems,
                modality
              },
              datasetMappings,
              {
                source: '物料构建器 CSV 导入',
                latestChange: '从物料构建器保存完整评测集',
                modality
              }
            ),
            validationSummary: validateDatasetItems(datasetItems, datasetMappings),
            ...versionMeta,
            creatorUid: auth.currentUser.uid,
            creatorName: auth.currentUser.displayName || auth.currentUser.email || 'Anonymous',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };

          try {
            finalDatasetId = await createDataset(newDataset);
          } catch (err: any) {
            console.error("Error creating dataset:", err);
            throw new Error("创建评测集失败: " + err.message);
          }
        }
      }

      let finalTemplateId = newTask.templateId || '';
      if (saveConfigAsRubric && (evaluationConfig.method === 'direct_score' || evaluationConfig.method === 'rubric_score')) {
        const templateId = `tpl-${Date.now()}`;
        const templateData: EvalTemplate = {
          id: templateId,
          name: `${newTask.name} 评分标准`,
          description: `从评测物料「${newTask.name}」保存的评分标准`,
          paradigm: getParadigmFromMethod(evaluationConfig.method),
          dimensions: normalizeDimensions(evaluationConfig.dimensions || [], evaluationConfig.method),
          creatorUid: auth.currentUser.uid,
          creatorName: auth.currentUser.displayName || auth.currentUser.email || 'Unknown',
          createdAt: Date.now()
        };
        await saveTemplate(templateData);
        finalTemplateId = templateId;
      }

      // Update models array based on selected model columns if using CSV or existing dataset
      const taskModels = (csvData.length > 0 || newTask.datasetId) && modelColumns.length > 0 ? modelColumns.map((col, idx) => ({
        id: `model-${idx}`,
        name: col
      })) : newTask.models;

      const sourceItemCount = csvData.length > 0 ? csvData.length : (datasets.find(d => d.id === finalDatasetId)?.items?.length || 0);
      const isSampledArena = evaluationConfig.method === 'pairwise' && evaluationConfig.pairwiseMode === 'arena_sampled';
      const pairCount = evaluationConfig.method === 'pairwise' && !isSampledArena
        ? buildPairwisePairs(taskModels || [], evaluationConfig.pairwiseMode).length
        : 1;
      const finalEvaluationConfig: EvaluationConfig = {
        ...evaluationConfig,
        dimensions: normalizeDimensions(evaluationConfig.dimensions || [], evaluationConfig.method),
        sourceRubricId: finalTemplateId || evaluationConfig.sourceRubricId,
        rubricName: finalTemplateId ? `${newTask.name} 评分标准` : evaluationConfig.rubricName,
        arenaSampling: isSampledArena
          ? normalizeArenaSamplingConfig(evaluationConfig.arenaSampling, sourceItemCount, (taskModels || []).length)
          : evaluationConfig.arenaSampling
      };

      const taskData = {
        ...newTask,
        templateId: finalTemplateId,
        projectId: newTask.projectId || '',
        datasetId: finalDatasetId || 'external-csv',
        models: taskModels,
        evaluationConfig: finalEvaluationConfig,
        paradigm: getParadigmFromMethod(evaluationConfig.method),
        dimensionColumns,
        inputType,
        creatorUid: auth.currentUser.uid,
        creatorName: auth.currentUser.displayName || auth.currentUser.email || 'Anonymous',
        createdAt: Date.now(),
        hasImportedData: csvData.length > 0 || !!newTask.datasetId,
        totalItems: sourceItemCount * pairCount,
        progress: {}
      };

      const dataToSave = csvData.length > 0 ? csvData : (datasets.find(d => d.id === finalDatasetId)?.items || []);
      const taskItemsToSave: EvaluationItem[] = [];

      if (dataToSave.length > 0) {
        try {
          for (const [rowIndex, row] of dataToSave.entries()) {
            let startImageUrl: string | undefined;
            let referenceUrls: string[] = [];
            
            inputColumns.forEach(col => {
              const urls = extractMediaUrls(row[col]);
              if (urls.length === 0) return;

              const lowerCol = col.toLowerCase();
              const isMusicCol = /music|audio|bgm|配乐|音乐|音频/.test(lowerCol);
              const isStartCol = /start|首帧|first/.test(lowerCol);
              const isRefCol = /ref|reference|参考|image_json|music_json/.test(lowerCol) || isMusicCol;

              urls.forEach(u => {
                if (isMusicCol || (isRefCol && !isStartCol)) {
                  referenceUrls.push(u);
                  return;
                }
                if (isStartCol) {
                  if (!startImageUrl) startImageUrl = u;
                  else referenceUrls.push(u);
                  return;
                }
                if (!startImageUrl) startImageUrl = u;
                else referenceUrls.push(u);
              });
            });

            const baseItemData: any = {
              prompt: inputColumns.length === 1 ? row[inputColumns[0]] : inputColumns.map(col => `[${col}]: ${row[col]}`).join('\n'),
              inputs: inputColumns.reduce((acc, col) => ({ ...acc, [col]: row[col] }), {}),
              modelA_Url: modelColumns[0] ? resolvePlaybackUrl(row[modelColumns[0]]) : '',
              modelB_Url: modelColumns[1] ? resolvePlaybackUrl(row[modelColumns[1]]) : '',
              modelOutputs: taskModels.map((model, idx) => ({
                modelId: model.id,
                modelName: model.name,
                url: modelColumns[idx] ? resolvePlaybackUrl(row[modelColumns[idx]]) : ''
              })).filter(output => output.url),
              dimensionValues: getDimensionValuesFromRecord(row, dimensionColumns),
              type: newTask.outputType || 'text',
              originalData: row,
              originalItemId: row.case_id || row.case_name || row.id || row['用例ID'] || row['ItemID'] || `case-${rowIndex + 1}`,
              isSwapped: (finalEvaluationConfig.method === 'ab_preference'
                || (finalEvaluationConfig.method === 'pairwise' && finalEvaluationConfig.pairwiseMode !== 'arena_sampled'))
                && finalEvaluationConfig.blind !== false
                ? Math.random() > 0.5
                : false
            };
            
            if (startImageUrl) baseItemData.startImageUrl = startImageUrl;
            if (referenceUrls.length > 0) baseItemData.referenceUrls = sortReferenceUrls(referenceUrls);

            if (finalEvaluationConfig.method === 'pairwise' && finalEvaluationConfig.pairwiseMode !== 'arena_sampled') {
              const pairs = buildPairwisePairs(taskModels || [], finalEvaluationConfig.pairwiseMode);
              for (const pair of pairs) {
                const leftIndex = (taskModels || []).findIndex(model => model.id === pair.modelA.id);
                const rightIndex = (taskModels || []).findIndex(model => model.id === pair.modelB.id);
                const pairItemData = {
                  ...baseItemData,
                  id: `row-${rowIndex}__${pair.pairId}`,
                  modelA_Url: leftIndex >= 0 ? resolvePlaybackUrl(row[modelColumns[leftIndex]]) : '',
                  modelB_Url: rightIndex >= 0 ? resolvePlaybackUrl(row[modelColumns[rightIndex]]) : '',
                  modelOutputs: [
                    {
                      modelId: pair.modelA.id,
                      modelName: pair.modelA.name,
                      url: leftIndex >= 0 ? resolvePlaybackUrl(row[modelColumns[leftIndex]]) : ''
                    },
                    {
                      modelId: pair.modelB.id,
                      modelName: pair.modelB.name,
                      url: rightIndex >= 0 ? resolvePlaybackUrl(row[modelColumns[rightIndex]]) : ''
                    }
                  ].filter(output => output.url),
                  pairContext: {
                    pairId: pair.pairId,
                    originalItemId: baseItemData.originalItemId,
                    modelAId: pair.modelA.id,
                    modelAName: pair.modelA.name,
                    modelBId: pair.modelB.id,
                    modelBName: pair.modelB.name
                  },
                  itemOrder: taskItemsToSave.length
                };
                taskItemsToSave.push(pairItemData);
              }
            } else {
              taskItemsToSave.push({
                ...baseItemData,
                id: `row-${rowIndex}`,
                itemOrder: taskItemsToSave.length
              });
            }
          }
        } catch (err: any) {
          console.error("Error creating task items:", err);
          throw new Error("保存物料数据失败: " + err.message);
        }
      }

      try {
        await createTaskWithItems(taskData, taskItemsToSave);
      } catch (err: any) {
        console.error("Error creating task:", err);
        throw new Error("创建物料记录失败: " + err.message);
      }

      setIsCreating(false);
      setShowPreview(false);
      setNewTask({
        name: '',
        projectId: selectedProjectFilter !== 'all' ? selectedProjectFilter : projectId || '',
        datasetId: '',
        templateId: '',
        outputType: 'text',
        models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
        status: 'draft',
        externalResultsLink: ''
      });
      setEvaluationConfig(getDefaultEvaluationConfig('ab_preference'));
      setSaveConfigAsRubric(false);
      setCsvData([]);
      setCsvHeaders([]);
      setInputColumns([]);
      setModelColumns([]);
      setDimensionColumns([]);
      setError(null);
      setSuccessMessage("创建成功！");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error("Error creating task:", err);
      setError("创建物料失败: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isPasting, setIsPasting] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const processCsvData = (text: string, isPasted: boolean = false) => {
    try {
      if (!text || text.trim() === '') {
        setError('数据为空');
        return;
      }

      const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
      const rawHasUrls = lines.some(l => l.includes('http'));

      // Helper function for aggressive parsing
      const runAggressiveParser = () => {
        const parsedData: any[] = [];
        let maxUrls = 0;
        
        const extractUrls = (line: string) => {
          const parts = line.split(/(?=https?:\/\/)/);
          return parts
            .filter(p => p.trim().startsWith('http'))
            .map(p => {
              const match = p.match(/^https?:\/\/[^\s"'\t|,;>]+/);
              return match ? match[0] : '';
            })
            .filter(Boolean);
        };

        lines.forEach(line => {
          const urls = extractUrls(line);
          maxUrls = Math.max(maxUrls, urls.length);
        });

        if (maxUrls > 0) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const urls = extractUrls(line);
            
            if (i === 0 && urls.length === 0 && maxUrls > 0) continue;

            if (urls.length > 0) {
              const firstUrlIndex = line.indexOf(urls[0]);
              let prompt = line.substring(0, firstUrlIndex).trim();
              prompt = prompt.replace(/^[,;\t|]+|[,;\t|]+$/g, '').trim();
              prompt = prompt.replace(/^["']|["']$/g, '').trim();
              
              const row: any = { 'Video Prompt': prompt || 'Empty Prompt' };
              
              if (maxUrls === 3) {
                row['Start Image'] = urls[0] || '';
                row['Slot_1_Out'] = urls[1] || '';
                row['Slot_2_Out'] = urls[2] || '';
              } else if (maxUrls === 2) {
                row['Slot_1_Out'] = urls[0] || '';
                row['Slot_2_Out'] = urls[1] || '';
              } else {
                urls.forEach((url, idx) => {
                  row[`URL_${idx + 1}`] = url;
                });
              }
              parsedData.push(row);
            }
          }
          return parsedData;
        }
        return null;
      };

      let data: any[] = [];
      let headers: string[] = [];

      // 1. Try PapaParse first
      let delimiter = undefined;
      if (text.includes('\t')) {
        delimiter = '\t';
      }

      let results = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        delimiter: delimiter,
        transform: (value) => value.trim(),
        transformHeader: (header) => header.trim(),
      });

      data = results.data as any[];
      headers = results.meta.fields || (data.length > 0 ? Object.keys(data[0]) : []);

      // Check if PapaParse failed to separate URLs or missed them entirely due to delimiter confusion.
      // Note: some valid datasets store multiple URLs in one JSON-array cell
      // (e.g. ["url1","url2"]). That should NOT be treated as "merged columns".
      const isJsonLikeArrayCell = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return false;
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed);
        } catch {
          return false;
        }
      };

      let hasMergedUrls = false;
      let hasUrlInParsedData = false;
      if (data.length > 0) {
        for (let i = 0; i < Math.min(5, data.length); i++) {
          const rowVals = Object.values(data[i]);
          if (rowVals.some(val => typeof val === 'string' && val.includes('http'))) {
            hasUrlInParsedData = true;
          }
          if (rowVals.some(val => {
            if (typeof val !== 'string') return false;
            const urlCount = (val.match(/https?:\/\//g) || []).length;
            if (urlCount <= 1) return false;
            return !isJsonLikeArrayCell(val);
          })) {
            hasMergedUrls = true;
          }
        }
      }

      const papaParseFailed = headers.length <= 1 || hasMergedUrls || (rawHasUrls && !hasUrlInParsedData);

      // 2. If standard parsing fails OR URLs are merged OR URLs are missing from parsed data
      if (papaParseFailed) {
        // Try splitting by tabs first, as it's more reliable than aggressive parser for preserving columns
        const firstLine = lines[0];
        const splitHeaders = firstLine.split('\t').map(s => s.trim());
        if (splitHeaders.length > 1) {
          headers = splitHeaders;
          data = lines.slice(1).map(line => {
            const values = line.split('\t').map(s => s.trim());
            const row: any = {};
            headers.forEach((h, i) => {
              row[h] = values[i] || '';
            });
            return row;
          });
        } else if (rawHasUrls) {
          // Fallback to aggressive parser only if tab splitting also fails
          const aggressiveData = runAggressiveParser();
          if (aggressiveData && aggressiveData.length > 0) {
            data = aggressiveData;
            headers = Object.keys(data[0]);
          }
        }
      }

      if (data.length === 0) {
        setError("数据为空或解析失败");
        return;
      }

      if (headers.length <= 1) {
        setError("未能识别出多个列。请确保粘贴的内容包含表头，且列之间有明显的空格或制表符。");
      } else {
        setError(null);
      }

    setCsvHeaders(headers);
    setCsvData(data);

    const detectedMappings = inferDatasetMappings(headers, data);
    const detectedInputColumns = detectedMappings.inputColumns.length ? detectedMappings.inputColumns : headers.slice(0, 1);
    const detectedDimensionColumns = detectedMappings.dimensionColumns.length ? detectedMappings.dimensionColumns : autoDetectDimensionColumns(headers, detectedInputColumns);
    const fallbackModelColumns = headers.filter(h =>
      !detectedInputColumns.includes(h) &&
      !detectedDimensionColumns.includes(h) &&
      !detectedMappings.referenceColumns.includes(h) &&
      !h.toLowerCase().includes('id') &&
      h !== '_originalData'
    );
    const detectedModelColumns = detectedMappings.outputColumns.length ? detectedMappings.outputColumns : fallbackModelColumns;

    setInputColumns([]);
    setDimensionColumns([]);
    setModelColumns([]);

    const tempDataset = {
      id: 'temp',
      name: 'temp',
      description: '',
      tags: [],
      inputSchema: buildDatasetSchema(headers, data, detectedMappings),
      items: data,
      columnMappings: { ...detectedMappings, outputColumns: detectedModelColumns },
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as EvalDataset;

    setNewTask(prev => ({
      ...prev,
      datasetId: '',
      outputType: inferOutputTypeFromDataset(tempDataset)
    }));
    
    if (isPasted) setIsPasting(false);
    } catch (err: any) {
      console.error("Error parsing CSV:", err);
      setError("解析失败: " + err.message);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      processCsvData(text);
    };
    reader.readAsText(file);
  };

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) return;
    processCsvData(pastedText, true);
  };

  const handleQuickCreateTemplate = async () => {
    if (!newTemplateName.trim()) return;

    let defaultDimensions: EvalDimension[] = [];
    if (newTemplateParadigm === 'GSB') {
      defaultDimensions = [{ id: `dim-${Date.now()}`, name: '整体评价', description: '综合评估', type: 'radio_select', options: ['A 更好', 'B 更好', '平局'] }];
    } else if (newTemplateParadigm === 'MOS') {
      defaultDimensions = [{ id: `dim-${Date.now()}`, name: '整体质量', description: '1-5分综合评分', type: 'star_rating' }];
    } else if (newTemplateParadigm === 'RubricScore') {
      defaultDimensions = buildDefaultDimensionsForMethod('rubric_score');
    } else if (newTemplateParadigm === 'Pairwise') {
      defaultDimensions = [];
    } else if (newTemplateParadigm === 'Arena-rank') {
      defaultDimensions = [{ id: `dim-${Date.now()}`, name: 'Arena-rank ranking', description: 'Rank three or more videos from best to worst.', type: 'radio_select', options: ['Full ranking'] }];
    } else {
      defaultDimensions = [{ id: `dim-${Date.now()}`, name: '竞技场排位', description: '选择你认为更好的模型', type: 'radio_select', options: ['模型 A', '模型 B', '平局', '都很差'] }];
    }

    const newTemplate: EvalTemplate = {
      id: `tpl-${Date.now()}`,
      name: newTemplateName,
      description: '快速创建的评分标准 / 评测方式预设',
      paradigm: newTemplateParadigm,
      dimensions: defaultDimensions,
      creatorUid: auth.currentUser.uid,
      creatorName: auth.currentUser.displayName || auth.currentUser.email || 'Unknown',
      createdAt: Date.now()
    };

    try {
      await saveTemplate(newTemplate);
      setNewTask(prev => ({ ...prev, templateId: newTemplate.id }));
      setEvaluationConfig(normalizeEvaluationConfig(undefined, newTemplate));
      setShowCreateTemplateModal(false);
      setNewTemplateName('');
      setNewTemplateParadigm('GSB');
    } catch (err: any) {
      console.error("Error creating template:", err);
      setError("创建模板失败: " + err.message);
    }
  };

  const handleDeleteTask = (id: string) => {
    setTaskToDelete(id);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;
    try {
      await deleteTask(taskToDelete);
      setTaskToDelete(null);
    } catch (err: any) {
      console.error("Error deleting task:", err);
      setError("删除失败: " + err.message);
      setTaskToDelete(null);
    }
  };

  const handleViewTask = async (task: EvalTask) => {
    setViewingTask(task);
    setLoadingItems(true);
    try {
      const items = await loadTaskItems(task);
      setViewingTaskItems(items);
    } catch (err) {
      console.error('Error fetching task items:', err);
      setError('加载物料详情失败');
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    if (!initialTaskId) return;

    const targetTask = tasks.find(task => task.id === initialTaskId);
    if (!targetTask) return;

    const alreadyLoaded = viewingTask?.id === initialTaskId && (viewingTaskItems.length > 0 || loadingItems);
    if (alreadyLoaded) return;

    handleViewTask(targetTask);
  }, [initialTaskId, tasks, viewingTask?.id, viewingTaskItems.length, loadingItems]);

  const handleSaveItemEdit = async (itemId: string) => {
    if (!viewingTask || !editItemForm) return;
    try {
      const patch = buildItemPatchFromForm(editItemForm);
      await updateTaskItem(viewingTask.id, itemId, patch);
      setViewingTaskItems(prev => prev.map(item => item.id === itemId ? { ...item, ...patch } as EvaluationItem : item));
      setEditingItemId(null);
      setEditItemForm(null);
    } catch (error) {
      console.error("Error updating item:", error);
      setError("更新 case 失败");
    }
  };

  const handleCancelItemEdit = () => {
    setEditingItemId(null);
    setEditItemForm(null);
  };

  const handleStartItemEdit = (item: EvaluationItem) => {
    if (!viewingTask) return;
    setEditingItemId(item.id);
    setEditItemForm(createItemEditForm(item, viewingTask));
  };

  const confirmDeleteTaskItem = async () => {
    if (!viewingTask || !itemToDelete) return;
    const task = viewingTask;
    const deletedItemId = itemToDelete.id;
    try {
      await deleteTaskItem(task.id, deletedItemId);
      const reloadedItems = await loadTaskItems({ ...task, totalItems: undefined, hasTaskItemEdits: true } as EvalTask);
      setViewingTaskItems(reloadedItems);
      setViewingTask({ ...task, totalItems: reloadedItems.length, hasTaskItemEdits: true } as EvalTask);
      setTasks(prev => prev.map(existingTask => existingTask.id === task.id ? { ...existingTask, totalItems: reloadedItems.length, hasTaskItemEdits: true } as EvalTask : existingTask));
      if (editingItemId === deletedItemId) handleCancelItemEdit();
      setItemToDelete(null);
    } catch (error: any) {
      console.error('Error deleting task item:', error);
      setError(`删除 case 失败: ${error?.message || error}`);
      setItemToDelete(null);
    }
  };

  const handleUpdateTaskStatus = async (id: string, status: 'draft' | 'active' | 'completed') => {
    try {
      await updateTask(id, { status });
    } catch (err: any) {
      console.error("Error updating task status:", err);
      setError("更新状态失败: " + err.message);
    }
  };

  const addModel = () => {
    setNewTask(prev => ({
      ...prev,
      models: [...(prev.models || []), { id: `model-${Date.now()}`, name: `Model ${prev.models?.length ? prev.models.length + 1 : 1}` }]
    }));
  };

  const updateModelName = (index: number, name: string) => {
    setNewTask(prev => {
      const newModels = [...(prev.models || [])];
      newModels[index].name = name;
      return { ...prev, models: newModels };
    });
  };

  const removeModel = (index: number) => {
    setNewTask(prev => {
      const newModels = [...(prev.models || [])];
      newModels.splice(index, 1);
      return { ...prev, models: newModels };
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">加载中...</div>;
  }

  const projectNameById = new Map(projects.map(project => [project.id, project.name]));
  const projectScopedTasks = selectedProjectFilter === 'all'
    ? tasks
    : tasks.filter(task => (task.projectId || '') === selectedProjectFilter);
  const visibleTasks = statusFilter === 'all'
    ? projectScopedTasks
    : projectScopedTasks.filter(task => task.status === statusFilter);
  const selectedProjectLabel = selectedProjectFilter === 'all'
    ? '全部项目'
    : projectNameById.get(selectedProjectFilter) || '未命名项目';
  const availableOutputHeaders = csvHeaders.filter(h => !inputColumns.includes(h) && !dimensionColumns.includes(h));
  const availableDimensionHeaders = csvHeaders.filter(h => !inputColumns.includes(h) && !modelColumns.includes(h));

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 glass-panel-hover rounded-full transition-colors"
          >
            <ArrowLeft size={24} className="text-slate-300" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
              <Box className="text-amber-400" size={32} />
              评测物料构建器
            </h1>
            <p className="text-slate-300 mt-2">将评测集、评测方式、评分标准、模型结果列或输出预览列和评委分配组合为可执行物料。</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">
                当前物料范围：{selectedProjectLabel}
              </span>
              {selectedProjectFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProjectFilter('all');
                    if (projectId && onClearProjectScope) onClearProjectScope();
                  }}
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-medium text-amber-300 hover:bg-amber-500/20"
                >
                  查看全部物料
                </button>
              )}
            </div>
          </div>
        </div>
        {!isCreating && (
          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium transition-colors"
          >
            <Plus size={18} /> 新建评测物料
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 text-red-700 rounded-xl border border-red-200">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-emerald-500/10 text-emerald-700 rounded-xl border border-emerald-200 flex items-center gap-2">
          <CheckCircle2 size={18} />
          {successMessage}
        </div>
      )}

      {isCreating && (
        <div className="bg-white/5 rounded-2xl border border-white/10 shadow-md shadow-black/20 p-6 mb-8">
          <h2 className="text-xl font-bold text-slate-100 mb-6">创建新物料</h2>
          
          {!showPreview ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">物料名称</label>
                <input 
                  type="text" 
                  value={newTask.name}
                  onChange={(e) => setNewTask({...newTask, name: e.target.value})}
                  className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="例如：V2.5 视觉能力评测物料"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">所属项目（可选）</label>
                <select
                  value={newTask.projectId || ''}
                  onChange={(event) => setNewTask({ ...newTask, projectId: event.target.value })}
                  className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="">不归属项目</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">从项目页进入时会默认带入当前项目；全局新建时可在这里选择归属。</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                    <Database size={16} className="text-blue-500" /> 选择评测集或上传CSV
                  </label>
                  <div className="space-y-3">
                    <select
                      value={newTask.datasetId}
                      onChange={(e) => {
                        const dsId = e.target.value;
                        setNewTask({...newTask, datasetId: dsId});
                        if (dsId) {
                          setCsvData([]);
                          const ds = datasets.find(d => d.id === dsId);
                          if (ds) {
                            applyDatasetDefaults(ds);
                          } else {
                            setCsvHeaders([]);
                            setDimensionColumns([]);
                          }
                        } else {
                          setCsvHeaders([]);
                          setDimensionColumns([]);
                        }
                      }}
                      className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      disabled={csvData.length > 0}
                    >
                      <option value="">-- 请选择评测集 --</option>
                      {datasets.map(ds => (
                        <option key={ds.id} value={ds.id}>{ds.name} ({ds.items?.length || 0} 条数据)</option>
                      ))}
                    </select>
                    
              <div className="glass-panel rounded-xl p-6 border-dashed border-2 border-white/10">
                <div className="flex flex-col items-center justify-center py-4">
                  {!isPasting ? (
                    <>
                      <div className="flex items-center gap-4 mb-4">
                        <label className="flex flex-col items-center justify-center w-48 h-32 border-2 border-dashed border-white/20 rounded-2xl cursor-pointer hover:border-amber-500/50 hover:bg-white/5 transition-all group">
                          <Upload className="w-8 h-8 text-slate-400 group-hover:text-amber-400 mb-2" />
                          <span className="text-xs text-slate-400 group-hover:text-slate-200">上传 CSV 文件</span>
                          <input 
                            type="file" 
                            className="hidden" 
                            accept=".csv,.tsv,.txt" 
                            onChange={(e) => {
                              handleFileUpload(e);
                              setNewTask({...newTask, datasetId: ''});
                            }} 
                          />
                        </label>
                        
                        <div className="text-slate-500 font-medium">或</div>

                        <button 
                          onClick={() => setIsPasting(true)}
                          className="flex flex-col items-center justify-center w-48 h-32 border-2 border-dashed border-white/20 rounded-2xl cursor-pointer hover:border-blue-500/50 hover:bg-white/5 transition-all group"
                        >
                          <ClipboardList className="w-8 h-8 text-slate-400 group-hover:text-blue-400 mb-2" />
                          <span className="text-xs text-slate-400 group-hover:text-slate-200">粘贴表格内容</span>
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 text-center">
                        支持 .csv, .tsv 格式。如果从 Excel/飞书复制，建议使用“粘贴”功能。
                      </p>
                    </>
                  ) : (
                    <div className="w-full space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-slate-200">粘贴表格内容 (包含表头)</h4>
                        <button onClick={() => setIsPasting(false)} className="text-xs text-slate-400 hover:text-white">返回上传</button>
                      </div>
                      <textarea 
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        className="w-full h-48 px-4 py-3 glass-input rounded-xl focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                        placeholder="在此粘贴从 Excel 或飞书表格复制的内容..."
                      />
                      <div className="flex justify-end">
                        <button 
                          onClick={() => {
                            handlePasteSubmit();
                            setNewTask({...newTask, datasetId: ''});
                          }}
                          disabled={!pastedText.trim()}
                          className="px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                        >
                          解析粘贴内容
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                      <LayoutTemplate size={16} className="text-purple-500" /> 评测方式与评分标准
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {EVALUATION_METHOD_OPTIONS.map(option => {
                        const selected = evaluationConfig.method === option.method;
                        return (
                          <button
                            key={option.method}
                            type="button"
                            onClick={() => updateEvaluationMethod(option.method)}
                            className={`border p-3 text-left transition-colors ${
                              selected
                                ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-slate-100'
                                : 'border-white/10 bg-white/5 text-slate-300 hover:border-[var(--accent)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold">{option.title}</span>
                              <span className="font-mono text-[11px] text-amber-300">
                                ≥{option.minModels} {isPreviewMethod(option.method) ? '输出列' : '模型列'}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">{option.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {!isBenchmarkPreview && (
                    <div>
                      <label className="block text-sm font-medium text-slate-200 mb-2">套用评分标准预设（可选）</label>
                      <select
                        value={newTask.templateId}
                        onChange={(e) => {
                          if (e.target.value === 'CREATE_NEW') {
                            setShowCreateTemplateModal(true);
                          } else {
                            applyRubricTemplate(e.target.value);
                          }
                        }}
                        className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      >
                        <option value="">不套用，使用当前配置</option>
                        {templates.map(tpl => (
                          <option key={tpl.id} value={tpl.id}>{tpl.name} ({getEvaluationMethodShortLabel(normalizeEvaluationConfig(undefined, tpl).method)})</option>
                        ))}
                        <option value="CREATE_NEW" className="font-medium text-amber-400">+ 新建评分标准预设</option>
                      </select>
                    </div>
                  )}

                  {!isBenchmarkPreview && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex items-center gap-2 border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={evaluationConfig.blind !== false}
                          onChange={(e) => setEvaluationConfig(prev => ({ ...prev, blind: e.target.checked }))}
                          className="rounded text-amber-400 focus:ring-amber-500"
                        />
                        盲测展示
                      </label>
                      {(evaluationConfig.method === 'ab_preference' || evaluationConfig.method === 'pairwise') && (
                        <label className="flex items-center gap-2 border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                          <input
                            type="checkbox"
                            checked={evaluationConfig.tiePolicy !== 'disallow'}
                            onChange={(e) => setEvaluationConfig(prev => ({ ...prev, tiePolicy: e.target.checked ? 'allow' : 'disallow' }))}
                            className="rounded text-amber-400 focus:ring-amber-500"
                          />
                          允许平局
                        </label>
                      )}
                    </div>
                  )}

                  {evaluationConfig.method === 'pairwise' && (
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-200">Pairwise 组合方式</span>
                      <select
                        value={evaluationConfig.pairwiseMode || 'arena_sampled'}
                        onChange={(e) => setEvaluationConfig(prev => ({ ...prev, pairwiseMode: e.target.value as any }))}
                        className="w-full px-4 py-2 glass-input rounded-xl"
                      >
                        <option value="arena_sampled">Arena 竞技场（推荐，可随时结束并纳入统计）</option>
                        <option value="all_pairs">全组合对战（高级，覆盖所有模型对）</option>
                        <option value="adjacent_pairs">相邻模型对战（高级，评测量较少）</option>
                      </select>
                    </label>
                  )}

                  {evaluationConfig.method === 'pairwise' && evaluationConfig.pairwiseMode === 'arena_sampled' && (
                    <div className="grid grid-cols-1 gap-3 border border-amber-400/25 bg-amber-400/5 p-4 md:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-300">建议场次数 / 评委</span>
                        <input
                          type="number"
                          min={1}
                          max={Math.max(csvData.length || datasets.find(dataset => dataset.id === newTask.datasetId)?.items?.length || 1, 1)}
                          value={evaluationConfig.arenaSampling?.suggestedBattlesPerReviewer || Math.max(20, modelColumns.length * 2)}
                          onChange={(event) => setEvaluationConfig(previous => ({
                            ...previous,
                            arenaSampling: {
                              ...(previous.arenaSampling || getDefaultEvaluationConfig('pairwise').arenaSampling!),
                              suggestedBattlesPerReviewer: Math.max(1, Number(event.target.value) || 1)
                            }
                          }))}
                          className="glass-input w-full px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-300">覆盖预热 / 模型</span>
                        <input
                          type="number"
                          min={1}
                          value={evaluationConfig.arenaSampling?.warmupBattlesPerModel || 3}
                          onChange={(event) => setEvaluationConfig(previous => ({
                            ...previous,
                            arenaSampling: {
                              ...(previous.arenaSampling || getDefaultEvaluationConfig('pairwise').arenaSampling!),
                              warmupBattlesPerModel: Math.max(1, Number(event.target.value) || 1)
                            }
                          }))}
                          className="glass-input w-full px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-300">探索比例</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={evaluationConfig.arenaSampling?.explorationRate ?? 0.15}
                          onChange={(event) => setEvaluationConfig(previous => ({
                            ...previous,
                            arenaSampling: {
                              ...(previous.arenaSampling || getDefaultEvaluationConfig('pairwise').arenaSampling!),
                              explorationRate: Math.min(1, Math.max(0, Number(event.target.value) || 0))
                            }
                          }))}
                          className="glass-input w-full px-3 py-2"
                        />
                      </label>
                      <p className="text-xs leading-5 text-slate-400 md:col-span-3">
                        每个评委在同一 case 最多评一场。完成第一场后即可结束，已提交投票会立即进入团队统计；达到建议值后仍可继续贡献。
                      </p>
                    </div>
                  )}

                  {(evaluationConfig.method === 'direct_score' || evaluationConfig.method === 'rubric_score') && (
                    <label className="flex items-center gap-2 border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={!!evaluationConfig.requireReason}
                        onChange={(e) => setEvaluationConfig(prev => ({ ...prev, requireReason: e.target.checked }))}
                        className="rounded text-amber-400 focus:ring-amber-500"
                      />
                      评委必须填写理由
                    </label>
                  )}
                </div>
              </div>

              {(csvData.length > 0 || newTask.datasetId) && csvHeaders.length > 0 && (
                <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-200">数据字段映射</label>
                    <div className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                      检测到 {csvHeaders.length} 个字段
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-200 mb-2">输入数据类型</label>
                    <select
                      value={inputType}
                      onChange={(e) => setInputType(e.target.value as any)}
                      className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    >
                      <option value="text">纯文本 (单轮提示词)</option>
                      <option value="text_image">图文混合 (提示词 + 图片)</option>
                      <option value="text_audio">音文混合 (提示词 + 音频)</option>
                      <option value="multi_turn">多轮对话</option>
                      <option value="other">其他灵活输入</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="block text-sm font-medium text-slate-200">输入列 (可多选，如提示词、图片、音频等)</label>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => updateInputColumns(csvHeaders)} className="px-2 py-0.5 text-xs text-amber-300 hover:bg-white/10">全选</button>
                          <button type="button" onClick={() => updateInputColumns([])} className="px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10">全不选</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {csvHeaders.map(h => (
                          <label key={h} className="inline-flex items-center gap-1.5 bg-white/5 px-2 py-1 border border-white/10 rounded-md text-sm cursor-pointer glass-panel-hover">
                            <input 
                              type="checkbox" 
                              checked={inputColumns.includes(h)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  updateInputColumns([...inputColumns, h]);
                                } else {
                                  updateInputColumns(inputColumns.filter(c => c !== h));
                                }
                              }}
                              className="rounded text-amber-400 focus:ring-amber-500"
                            />
                            {h}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="block text-sm font-medium text-slate-200">{isBenchmarkPreview ? '输出预览列' : '模型结果列'} (可多选)</label>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => updateModelColumns(availableOutputHeaders)} className="px-2 py-0.5 text-xs text-amber-300 hover:bg-white/10">全选</button>
                          <button type="button" onClick={() => updateModelColumns([])} className="px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10">全不选</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableOutputHeaders.map(h => (
                          <label key={h} className="inline-flex items-center gap-1.5 bg-white/5 px-2 py-1 border border-white/10 rounded-md text-sm cursor-pointer glass-panel-hover">
                            <input 
                              type="checkbox" 
                              checked={modelColumns.includes(h)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  updateModelColumns([...modelColumns, h]);
                                } else {
                                  updateModelColumns(modelColumns.filter(c => c !== h));
                                }
                              }}
                              className="rounded text-amber-400 focus:ring-amber-500"
                            />
                            <span className="truncate max-w-[120px]" title={h}>{h}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="block text-sm font-medium text-slate-200">评测维度列 (可选)</label>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => updateDimensionColumns(availableDimensionHeaders)} className="px-2 py-0.5 text-xs text-amber-300 hover:bg-white/10">全选</button>
                          <button type="button" onClick={() => updateDimensionColumns([])} className="px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10">全不选</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableDimensionHeaders.map(h => (
                          <label key={h} className="inline-flex items-center gap-1.5 bg-white/5 px-2 py-1 border border-white/10 rounded-md text-sm cursor-pointer glass-panel-hover">
                            <input
                              type="checkbox"
                              checked={dimensionColumns.includes(h)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  updateDimensionColumns([...dimensionColumns, h]);
                                } else {
                                  updateDimensionColumns(dimensionColumns.filter(c => c !== h));
                                }
                              }}
                              className="rounded text-amber-400 focus:ring-amber-500"
                            />
                            <span className="truncate max-w-[120px]" title={h}>{h}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-slate-400">如场景、类别、能力、难度；仅用于展示和聚合分析。</p>
                    </div>
                  </div>
                  
                  {csvData.length > 0 && (
                    <div className="pt-2 border-t border-white/10">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={saveDatasetToPlatform}
                          onChange={(e) => setSaveDatasetToPlatform(e.target.checked)}
                          className="rounded text-amber-400 focus:ring-amber-500"
                        />
                        <span className="text-sm text-slate-200">将此评测集保存到平台仓库（保留输入列、{isBenchmarkPreview ? '输出预览列' : '模型结果列'}和评测维度，方便后续复用）</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {(evaluationConfig.method === 'direct_score' || evaluationConfig.method === 'rubric_score') && (
                <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">评分维度与标准定义</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        这里定义的每个评分项都会出现在评测执行页，并进入结果洞察的模型榜单、维度统计和导出文件。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addEvaluationDimension}
                      className="flex shrink-0 items-center gap-1 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20"
                    >
                      <Plus size={14} /> 添加维度
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(evaluationConfig.dimensions || []).map((dimension, index) => (
                      <div key={dimension.id} className="border border-white/10 bg-black/20 p-4">
                        <div className="grid gap-3 lg:grid-cols-[1.2fr_160px_120px_110px_auto] lg:items-end">
                          <label className="block">
                            <span className="mb-1 block text-xs text-slate-400">维度名称</span>
                            <input
                              value={dimension.name}
                              onChange={(e) => updateEvaluationDimension(index, { name: e.target.value })}
                              className="glass-input w-full px-3 py-2 text-sm"
                              placeholder="例如：Prompt 一致性"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-slate-400">控件类型</span>
                            <select
                              value={dimension.type}
                              onChange={(e) => updateEvaluationDimension(index, {
                                type: e.target.value as EvalDimension['type'],
                                aggregationRole: e.target.value === 'text_input' ? 'rationale' : e.target.value === 'star_rating' ? 'score' : 'preference',
                                scale: e.target.value === 'star_rating' ? DEFAULT_SCORE_LEVELS : undefined
                              })}
                              className="glass-input w-full px-3 py-2 text-sm"
                            >
                              <option value="star_rating">星级打分</option>
                              <option value="radio_select">单选</option>
                              <option value="text_input">理由文本</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-slate-400">权重</span>
                            <input
                              type="number"
                              min="0"
                              step="0.05"
                              value={dimension.weight ?? 1}
                              onChange={(e) => updateEvaluationDimension(index, { weight: Number(e.target.value) })}
                              className="glass-input w-full px-3 py-2 text-sm"
                              disabled={dimension.type !== 'star_rating'}
                            />
                          </label>
                          <label className="flex items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                            <input
                              type="checkbox"
                              checked={dimension.required !== false}
                              onChange={(e) => updateEvaluationDimension(index, { required: e.target.checked })}
                              className="rounded text-amber-400 focus:ring-amber-500"
                            />
                            必填
                          </label>
                          <button
                            type="button"
                            onClick={() => removeEvaluationDimension(index)}
                            className="flex items-center justify-center gap-1 border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/20"
                          >
                            <Trash2 size={14} /> 删除
                          </button>
                        </div>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-xs text-slate-400">清晰定义 / 评分说明</span>
                          <textarea
                            value={dimension.description}
                            onChange={(e) => updateEvaluationDimension(index, { description: e.target.value })}
                            className="glass-input min-h-16 w-full px-3 py-2 text-sm"
                            placeholder="说明该维度衡量什么、1 分和 5 分分别意味着什么、遇到不可判断时如何处理。"
                          />
                        </label>
                        {dimension.type === 'radio_select' && (
                          <label className="mt-3 block">
                            <span className="mb-1 block text-xs text-slate-400">选项（逗号分隔）</span>
                            <input
                              value={dimension.options?.join(', ') || ''}
                              onChange={(e) => updateEvaluationDimension(index, { options: e.target.value.split(',').map(part => part.trim()).filter(Boolean) })}
                              className="glass-input w-full px-3 py-2 text-sm"
                              placeholder="例如：明显失败, 可接受, 优秀"
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>

                  <label className="flex items-center gap-2 border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={saveConfigAsRubric}
                      onChange={(e) => setSaveConfigAsRubric(e.target.checked)}
                      className="rounded text-amber-400 focus:ring-amber-500"
                    />
                    创建物料时将当前评分标准保存为预设
                  </label>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">输出结果类型</label>
                <select
                  value={newTask.outputType}
                  onChange={(e) => setNewTask({...newTask, outputType: e.target.value as any})}
                  className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="text">纯文本 (Text)</option>
                  <option value="image">图像 (Image)</option>
                  <option value="video">视频 (Video)</option>
                  <option value="audio">音频 (Audio)</option>
                  <option value="markdown">Markdown</option>
                </select>
              </div>

              {csvData.length === 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                    <LinkIcon size={16} className="text-slate-300" /> 外部生成结果链接 (可选)
                  </label>
                  <input 
                      type="text" 
                      value={newTask.externalResultsLink || ''}
                      onChange={(e) => setNewTask({...newTask, externalResultsLink: e.target.value})}
                      className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      placeholder="例如：飞书表格、云盘文件夹链接等，用于存放外部批量生成的结果"
                    />
                    <p className="text-xs text-slate-300 mt-2">
                      对于生图、生视频等重度生成任务，建议在外部完成批量生成后，将结果链接粘贴于此。
                    </p>
                  </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                  <Users size={16} className="text-blue-500" /> 评测负责人 (可选)
                </label>
                <div className="flex flex-wrap gap-3">
                  {users.map(user => {
                    const isSelected = newTask.assignees?.includes(user.email);
                    return (
                      <label 
                        key={user.uid} 
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${isSelected ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-white/5 border-white/10 text-slate-300 glass-panel-hover'}`}
                      >
                        <input 
                          type="checkbox" 
                          className="hidden"
                          checked={isSelected}
                          onChange={(e) => {
                            let newAssignees = [...(newTask.assignees || [])];
                            if (e.target.checked) {
                              newAssignees.push(user.email);
                            } else {
                              newAssignees = newAssignees.filter(email => email !== user.email);
                            }
                            setNewTask({...newTask, assignees: newAssignees});
                          }}
                        />
                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white">
                          {user.displayName?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm">{user.displayName || user.email}</span>
                      </label>
                    );
                  })}
                  {users.length === 0 && <span className="text-slate-400 text-sm">暂无可选用户，请先让用户登录系统。</span>}
                </div>
              </div>

              {csvData.length === 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-200">参评模型</label>
                    <button 
                      onClick={addModel}
                      className="text-sm text-amber-400 hover:text-amber-300 flex items-center gap-1"
                    >
                      <Plus size={14} /> 添加模型
                    </button>
                  </div>
                  <div className="space-y-3">
                    {newTask.models?.map((model, index) => (
                      <div key={model.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-medium text-slate-300">
                          {String.fromCharCode(65 + index)}
                        </div>
                        <input 
                          type="text" 
                          value={model.name}
                          onChange={(e) => updateModelName(index, e.target.value)}
                          className="flex-1 px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                          placeholder={`Model ${String.fromCharCode(65 + index)} Name`}
                        />
                        {newTask.models!.length > 2 && (
                          <button 
                            onClick={() => removeModel(index)}
                            className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <button 
                  onClick={() => setIsCreating(false)}
                  className="px-6 py-2 border border-white/10 text-slate-300 rounded-xl glass-panel-hover transition-colors"
                >
                  取消
                </button>
                {csvData.length > 0 ? (
                  <button 
                    onClick={() => {
                      const err = validateSetup();
                      if (err) setError(err);
                      else setShowPreview(true);
                    }}
                    className="px-6 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors flex items-center gap-2"
                  >
                    预览物料
                  </button>
                ) : (
                  <button 
                    onClick={handleCreateTask}
                    className="px-6 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors flex items-center gap-2"
                  >
                    <Save size={18} /> 保存物料
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="glass-panel rounded-xl p-6">
                <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                  <LayoutTemplate size={20} className="text-indigo-500" /> {isBenchmarkPreview ? 'Benchmark 预览物料' : '评测物料预览'} (第一条数据)
                </h3>
                
                <div className="glass-panel rounded-2xl overflow-hidden shadow-md shadow-black/20 flex flex-col" style={{ minHeight: '400px' }}>
                  {/* Header/Prompt Area */}
                  <div className="bg-white/5 border-b border-white/10 px-6 py-4 shrink-0 shadow-md shadow-black/20 z-10 space-y-3">
                    <DimensionChips values={getDimensionValuesFromRecord(csvData[0], dimensionColumns)} />
                    {inputColumns.map(col => (
                      <div key={col} className="text-slate-200 text-sm leading-relaxed flex items-start">
                        <span className="font-semibold text-slate-100 mr-2 select-none uppercase text-xs tracking-wider bg-white/10 px-1.5 py-0.5 rounded shrink-0 mt-0.5">{col}</span>
                        <div className="break-words whitespace-pre-wrap">{csvData[0][col]}</div>
                      </div>
                    ))}
                  </div>

                  {/* Content Area */}
                  <div className="flex-1 p-4 md:p-6 flex gap-4 md:gap-6 bg-white/5 overflow-hidden">
                    {modelColumns.map((col, idx) => (
                      <div key={col} className="flex-1 flex flex-col min-h-0 bg-white/5 rounded-2xl shadow-md shadow-black/20 border border-white/10 overflow-hidden">
                        <div className="flex-1 relative min-h-0 p-1 bg-black/40">
                          {newTask.outputType === 'text' || newTask.outputType === 'markdown' ? (
                            <div className="h-full w-full bg-white/5 p-4 overflow-y-auto text-slate-200 whitespace-pre-wrap text-sm">
                              {csvData[0][col]}
                            </div>
                          ) : (
                            <MediaRenderer 
                              url={csvData[0][col]} 
                              label={`${isBenchmarkPreview ? '输出' : '模型'} ${idx + 1} (${col})`} 
                              isActive={true} 
                              forceType={newTask.outputType}
                            />
                          )}
                        </div>
                        <div className="p-3 bg-white/5 text-center text-sm font-medium text-slate-300 border-t border-white/10">
                          {isBenchmarkPreview ? '输出' : '模型'} {idx + 1} ({col})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <button 
                  onClick={() => setShowPreview(false)}
                  className="px-6 py-2 border border-white/10 text-slate-300 rounded-xl glass-panel-hover transition-colors"
                >
                  返回修改
                </button>
                <button 
                  onClick={handleCreateTask}
                  disabled={isSubmitting}
                  className={`px-6 py-2 rounded-xl transition-colors flex items-center gap-2 ${isSubmitting ? 'bg-white/10 text-slate-400 cursor-not-allowed' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} 
                  {isSubmitting ? '创建中...' : '确认创建'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isCreating && tasks.length > 0 && (
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-100">{selectedProjectFilter === 'all' ? '全部评测物料' : `${selectedProjectLabel} 的评测物料`}</h2>
            <p className="text-slate-300 text-sm mt-1">
              在此管理可执行评测配置。草稿可启动，进行中的物料可直接进入评测，已完成的物料可进入结果洞察。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-[180px]">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">所属项目</span>
              <select
                value={selectedProjectFilter}
                onChange={(event) => setSelectedProjectFilter(event.target.value)}
                className="glass-input w-full px-3 py-2 text-sm"
              >
                <option value="all">全部项目</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-[180px]">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">物料状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as EvalTask['status'] | 'all')} className="glass-input w-full px-3 py-2 text-sm">
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </label>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleTasks.map(task => {
          const dataset = datasets.find(d => d.id === task.datasetId);
          const template = templates.find(t => t.id === task.templateId);
          const taskEvaluation = normalizeEvaluationConfig(task, template);

          return (
            <div key={task.id} className="bg-white/5 rounded-2xl border border-white/10 shadow-md shadow-black/20 overflow-hidden flex flex-col">
              <div className="p-5 border-b border-white/10 flex-1">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold text-lg text-slate-100">{task.name}</h3>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      task.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
                      task.status === 'completed' ? 'bg-white/10 text-slate-200' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {task.status === 'active' ? '进行中' : task.status === 'completed' ? '已完成' : '草稿'}
                    </span>
                  </div>
                  <div className="mb-3 text-xs text-slate-400">
                    所属项目：{task.projectId ? (projectNameById.get(task.projectId) || '未命名项目') : '未归属项目'}
                  </div>

                <div className="space-y-3 mt-4">
                  <div className="flex items-start gap-2 text-sm">
                    <Database size={16} className="text-slate-300 mt-0.5" />
                    <div>
                      <span className="text-slate-300">数据集: </span>
                      <span className="font-medium text-slate-200">{dataset?.name || '未知数据集'}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <LayoutTemplate size={16} className="text-slate-300 mt-0.5" />
                    <div>
                      <span className="text-slate-300">评测方式: </span>
                      <span className="font-medium text-slate-200">{getEvaluationMethodShortLabel(taskEvaluation.method)}</span>
                      {taskEvaluation.rubricName && <span className="ml-2 text-xs text-slate-400">评分标准: {taskEvaluation.rubricName}</span>}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <Box size={16} className="text-slate-300 mt-0.5" />
                    <div className="flex-1">
                      <span className="text-slate-300">{isPreviewMethod(taskEvaluation) ? '输出列: ' : '模型: '}</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {task.models.map((m, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-white/10 text-slate-200 rounded text-xs border border-white/10">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {task.assignees && task.assignees.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                      <Users size={16} className="text-slate-300 mt-0.5" />
                      <div className="flex-1">
                        <span className="text-slate-300">负责人: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {task.assignees.map((email, idx) => {
                            const user = users.find(u => u.email === email);
                            return (
                              <span key={idx} className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-xs border border-indigo-500/30 flex items-center gap-1" title={email}>
                                <div className="w-3 h-3 rounded-full bg-indigo-500 flex items-center justify-center text-[8px] text-white font-bold">
                                  {user?.displayName?.charAt(0).toUpperCase() || email.charAt(0).toUpperCase()}
                                </div>
                                {user?.displayName || email.split('@')[0]}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  {task.externalResultsLink && (
                    <div className="flex items-start gap-2 text-sm">
                      <LinkIcon size={16} className="text-slate-300 mt-0.5" />
                      <div className="flex-1 truncate">
                        <span className="text-slate-300">生成结果: </span>
                        <a 
                          href={task.externalResultsLink.startsWith('http') ? task.externalResultsLink : `https://${task.externalResultsLink}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="font-medium text-amber-400 hover:underline"
                          title={task.externalResultsLink}
                        >
                          外部链接
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-white/5 p-4 flex items-center justify-between">
                <div className="text-xs text-slate-300">
                  创建于 {new Date(task.createdAt).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-2">
                  {task.status === 'draft' && (
                    <button 
                      onClick={() => handleUpdateTaskStatus(task.id, 'active')}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-emerald-300 bg-emerald-500/20 hover:bg-green-200 rounded-lg transition-colors"
                      title="启动物料"
                    >
                      <Play size={14} /> 启动
                    </button>
                  )}
                  {task.status === 'active' && (
                    <button
                      onClick={() => onEvaluateTask?.(task)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors"
                      title="进入该物料的评测执行页"
                    >
                      <Play size={14} /> 进入评测
                    </button>
                  )}
                  {task.status === 'completed' && (
                    <button
                      onClick={() => onOpenInsights?.(task)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors"
                      title="查看该物料的结果洞察"
                    >
                      <Eye size={14} /> 结果洞察
                    </button>
                  )}
                  {task.status === 'active' && (
                    <button 
                      onClick={() => handleUpdateTaskStatus(task.id, 'completed')}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
                      title="标记为完成"
                    >
                      <CheckCircle2 size={14} /> 标记完成
                    </button>
                  )}
                  <button 
                    onClick={() => handleViewTask(task)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors"
                    title="查看详情"
                  >
                    <Eye size={14} /> 查看 / 编辑
                  </button>
                  <button 
                    onClick={() => handleDeleteTask(task.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-red-700 hover:bg-rose-500/10 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Trash2 size={14} /> 删除
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {visibleTasks.length === 0 && !isCreating && (
          <div className="col-span-full py-12 text-center bg-white/5 rounded-2xl border border-white/10 border-dashed">
            <Box size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-100 mb-2">暂无评测物料</h3>
            <p className="text-slate-300 mb-6">创建一个新物料，将评测集、评测方式和评分标准组合起来。</p>
            <button 
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium transition-colors"
            >
              <Plus size={18} /> 新建评测物料
            </button>
          </div>
        )}
      </div>
      {showCreateTemplateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white/5 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h3 className="text-xl font-bold text-slate-200">新建评分标准 / 评测预设</h3>
              <button 
                onClick={() => setShowCreateTemplateModal(false)}
                className="text-slate-300 hover:text-slate-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">评分标准名称</label>
                <input 
                  type="text" 
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="例如：文生图多维评分标准"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">评测范式</label>
                <select 
                  value={newTemplateParadigm}
                  onChange={(e) => setNewTemplateParadigm(e.target.value as EvalParadigm)}
                  className="w-full px-4 py-2 glass-input rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="GSB">A/B 偏好 - 双模型对比</option>
                  <option value="Pairwise">Pairwise - 多模型两两对战</option>
                  <option value="MOS">直接评分 / MOS - 单项或多模型打分</option>
                  <option value="RubricScore">Rubric 多维评分</option>
                  <option value="Arena-rank">全量排序 / Arena-rank</option>
                </select>
                <p className="text-xs text-slate-300 mt-2">
                  系统会自动生成兼容该评测方式的默认评分标准，保存后可在物料构建器中继续复用和细化。
                </p>
              </div>
            </div>
            <div className="p-6 bg-white/5 border-t border-white/10 flex justify-end gap-3">
              <button 
                onClick={() => setShowCreateTemplateModal(false)}
                className="px-4 py-2 text-slate-300 glass-panel-hover rounded-xl transition-colors font-medium"
              >
                取消
              </button>
              <button 
                onClick={handleQuickCreateTemplate}
                disabled={!newTemplateName.trim()}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                创建并使用
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!taskToDelete}
        title="删除评测物料"
        message="确定要删除这个评测物料吗？此操作不可恢复，相关的评测数据也可能丢失。"
        onConfirm={confirmDeleteTask}
        onCancel={() => setTaskToDelete(null)}
        confirmText="删除"
      />

      <ConfirmModal
        isOpen={!!itemToDelete}
        title="删除评测数据项"
        message={`确定要删除 ${itemToDelete?.id || '这条 case'} 吗？该 case 会从未来评测和结果统计中移除，相关投票记录也会被清理。`}
        onConfirm={confirmDeleteTaskItem}
        onCancel={() => setItemToDelete(null)}
        confirmText="删除"
      />

      {viewingTask && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white/5 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h3 className="text-xl font-bold text-slate-200 flex items-center gap-2">
                <Eye size={20} className="text-amber-400" />
                物料详情: {viewingTask.name}
              </h3>
              <button 
                onClick={() => setViewingTask(null)}
                className="text-slate-300 hover:text-slate-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-white/5 space-y-6">
              {/* Task Level Editing */}
              <div className="bg-white/5 p-6 rounded-xl border border-white/10 shadow-md shadow-black/20 space-y-4">
                <h4 className="font-semibold text-slate-200 border-b border-white/10 pb-2">基本信息</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-1">物料名称</label>
                    <input 
                      type="text" 
                      value={viewingTask.name}
                      onChange={async (e) => {
                        const newName = e.target.value;
                        setViewingTask({...viewingTask, name: newName});
                        try {
                          await updateTask(viewingTask.id, { name: newName });
                        } catch (err) {
                          console.error("Error updating task name:", err);
                        }
                      }}
                      className="w-full px-3 py-2 glass-input rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-1">所属项目</label>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                      {viewingTask.projectId ? (projectNameById.get(viewingTask.projectId) || '未命名项目') : '未归属项目'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <Users size={14} className="text-blue-500" /> 评测负责人 (可选)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {users.map(user => {
                        const isSelected = viewingTask.assignees?.includes(user.email);
                        return (
                          <label 
                            key={user.uid} 
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-white/5 border-white/10 text-slate-300 glass-panel-hover'}`}
                          >
                            <input 
                              type="checkbox" 
                              className="hidden"
                              checked={isSelected}
                              onChange={async (e) => {
                                let newAssignees = [...(viewingTask.assignees || [])];
                                if (e.target.checked) {
                                  newAssignees.push(user.email);
                                } else {
                                  newAssignees = newAssignees.filter(email => email !== user.email);
                                }
                                setViewingTask({...viewingTask, assignees: newAssignees});
                                try {
                                  await updateTask(viewingTask.id, { assignees: newAssignees });
                                } catch (err) {
                                  console.error("Error updating task assignees:", err);
                                }
                              }}
                            />
                            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-white">
                              {user.displayName?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs">{user.displayName || user.email}</span>
                          </label>
                        );
                      })}
                      {users.length === 0 && <span className="text-slate-400 text-xs">暂无可选用户</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-4">
                <h4 className="font-semibold text-slate-200">评测数据项</h4>
                {loadingItems ? (
                  <div className="flex items-center justify-center py-12 bg-white/5 rounded-xl border border-white/10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <span className="ml-3 text-slate-300">加载中...</span>
                  </div>
                ) : viewingTaskItems.length === 0 ? (
                  <div className="text-center py-12 text-slate-300 bg-white/5 rounded-xl border border-white/10">
                    没有找到评测数据
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-slate-300">共 {viewingTaskItems.length} 条数据</span>
                    </div>
                    {viewingTaskItems.map((item, idx) => {
                      const isEditing = editingItemId === item.id;
                      const form = isEditing ? editItemForm : null;
                      const displayOutputs = item.modelOutputs?.length
                        ? item.modelOutputs
                        : viewingTask.models.map((model, mIdx) => ({
                          modelId: model.id,
                          modelName: model.name,
                          url: mIdx === 0 ? item.modelA_Url : mIdx === 1 ? item.modelB_Url : ''
                        }));
                      return (
                        <div key={item.id || idx} className="bg-white/5 p-4 rounded-xl border border-white/10 shadow-md shadow-black/20">
                          <div className="flex flex-col gap-3 mb-3 border-b border-white/10 pb-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="font-medium text-slate-200">数据项 {idx + 1}</div>
                              <div className="mt-1 font-mono text-xs text-slate-500">{item.id}</div>
                            </div>
                            {isEditing ? (
                              <div className="flex flex-wrap gap-2">
                                <button onClick={handleCancelItemEdit} className="text-slate-300 hover:text-slate-200 text-sm">取消</button>
                                <button onClick={() => handleSaveItemEdit(item.id)} className="text-amber-400 hover:text-amber-300 text-sm font-medium">保存</button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button onClick={() => handleStartItemEdit(item)} className="text-amber-400 hover:text-amber-300 text-sm flex items-center gap-1">
                                  <Edit size={14} /> 编辑内容
                                </button>
                                <button onClick={() => setItemToDelete(item)} className="text-red-300 hover:text-red-200 text-sm flex items-center gap-1">
                                  <Trash2 size={14} /> 删除
                                </button>
                              </div>
                            )}
                          </div>

                          {form ? (
                            <div className="space-y-4">
                              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">Prompt</span>
                                  <textarea
                                    className="w-full p-3 glass-input rounded-lg text-sm font-mono"
                                    rows={4}
                                    value={form.prompt}
                                    onChange={(event) => setEditItemForm(prev => prev ? { ...prev, prompt: event.target.value } : prev)}
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">媒体类型</span>
                                  <select
                                    className="w-full px-3 py-2 glass-input rounded-lg text-sm"
                                    value={form.type}
                                    onChange={(event) => setEditItemForm(prev => prev ? { ...prev, type: event.target.value as EvaluationItem['type'] } : prev)}
                                  >
                                    {['text', 'image', 'video', 'audio', 'markdown', 'unknown'].map(type => (
                                      <option key={type} value={type}>{type}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">输入字段（每行 key: value）</span>
                                  <textarea
                                    className="w-full p-3 glass-input rounded-lg text-sm font-mono"
                                    rows={5}
                                    value={form.inputsText}
                                    onChange={(event) => setEditItemForm(prev => prev ? { ...prev, inputsText: event.target.value } : prev)}
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">评测维度（每行 key: value）</span>
                                  <textarea
                                    className="w-full p-3 glass-input rounded-lg text-sm font-mono"
                                    rows={5}
                                    value={form.dimensionsText}
                                    onChange={(event) => setEditItemForm(prev => prev ? { ...prev, dimensionsText: event.target.value } : prev)}
                                  />
                                </label>
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">首帧图 URL</span>
                                  <input
                                    className="w-full px-3 py-2 glass-input rounded-lg text-sm font-mono"
                                    value={form.startImageUrl}
                                    onChange={(event) => setEditItemForm(prev => prev ? { ...prev, startImageUrl: event.target.value } : prev)}
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">预期输出</span>
                                  <input
                                    className="w-full px-3 py-2 glass-input rounded-lg text-sm font-mono"
                                    value={form.expectedOutput}
                                    onChange={(event) => setEditItemForm(prev => prev ? { ...prev, expectedOutput: event.target.value } : prev)}
                                  />
                                </label>
                              </div>

                              <label className="block">
                                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-300">参考素材 URL（每行一个）</span>
                                <textarea
                                  className="w-full p-3 glass-input rounded-lg text-sm font-mono"
                                  rows={3}
                                  value={form.referenceUrlsText}
                                  onChange={(event) => setEditItemForm(prev => prev ? { ...prev, referenceUrlsText: event.target.value } : prev)}
                                />
                              </label>

                              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                {form.modelOutputs.map((output, outputIndex) => (
                                  <div key={`${output.modelId}-${outputIndex}`} className="border border-white/10 rounded-lg overflow-hidden">
                                    <div className="bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 border-b border-white/10">
                                      {output.modelName || output.modelId}
                                    </div>
                                    <textarea
                                      className="w-full p-3 glass-input rounded-none text-sm font-mono"
                                      rows={5}
                                      value={output.url}
                                      onChange={(event) => setEditItemForm(prev => prev ? {
                                        ...prev,
                                        modelOutputs: prev.modelOutputs.map((current, idx) => idx === outputIndex ? { ...current, url: event.target.value } : current)
                                      } : prev)}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <>
                              <DimensionChips
                                values={getDimensionValuesForItem(item as any, viewingTask.dimensionColumns || [])}
                                className="mb-4"
                              />

                              <div className="mb-4">
                                <div className="text-xs font-medium text-slate-300 uppercase tracking-wider mb-1">输入</div>
                                <div className="bg-white/5 p-3 rounded-lg text-sm text-slate-200 whitespace-pre-wrap font-mono">
                                  {item.prompt || Object.entries(item.inputs || {}).map(([key, value]) => `[${key}]: ${value}`).join('\n') || '-'}
                                </div>
                              </div>

                              {(item as any).expectedOutput && (
                                <div className="mb-4">
                                  <div className="text-xs font-medium text-slate-300 uppercase tracking-wider mb-1">预期输出</div>
                                  <div className="bg-emerald-500/10 p-3 rounded-lg text-sm text-emerald-400 whitespace-pre-wrap font-mono">
                                    {(item as any).expectedOutput}
                                  </div>
                                </div>
                              )}

                              {(item.referenceUrls?.length || item.startImageUrl) && (
                                <div className="mb-4">
                                  <div className="text-xs font-medium text-slate-300 uppercase tracking-wider mb-2">参考素材</div>
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    {[item.startImageUrl, ...(item.referenceUrls || [])].filter(Boolean).map((url, refIndex) => (
                                      <div key={`${item.id}-ref-${refIndex}`} className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                        <div className="border-b border-white/10 px-3 py-2 text-xs text-slate-300">
                                          {refIndex === 0 && item.startImageUrl ? '首帧 / 主参考' : `参考素材 ${refIndex + 1}`}
                                        </div>
                                        <div className="h-40">
                                          <MediaRenderer
                                            url={url as string}
                                            isActive
                                            className="h-full w-full"
                                            videoPreload="metadata"
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                {displayOutputs.map((output, outputIndex) => {
                                  const outputType = item.type || viewingTask.outputType;
                                  const hasPreviewableUrl = !!output.url && (
                                    ['image', 'video', 'audio'].includes(outputType || '') ||
                                    extractMediaUrls(output.url).length > 0
                                  );

                                  return (
                                    <div key={`${output.modelId}-${outputIndex}`} className="border border-white/10 rounded-lg overflow-hidden">
                                      <div className="bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 border-b border-white/10">
                                        {output.modelName}
                                      </div>
                                      {hasPreviewableUrl ? (
                                        <div className="space-y-2 bg-white/5 p-3">
                                          <div className="h-48 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                            <MediaRenderer
                                              url={output.url}
                                              isActive
                                              forceType={['image', 'video', 'audio'].includes(outputType || '') ? outputType : undefined}
                                              className="h-full w-full"
                                              videoPreload="metadata"
                                            />
                                          </div>
                                          <a
                                            href={output.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block truncate text-xs text-amber-300 hover:text-amber-200 hover:underline"
                                            title={output.url}
                                          >
                                            打开原始链接
                                          </a>
                                        </div>
                                      ) : (
                                        <div className="p-3 text-sm text-slate-200 whitespace-pre-wrap font-mono bg-white/5">
                                          {output.url || <span className="text-slate-300 italic">无输出</span>}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )}
</div>
);
}
