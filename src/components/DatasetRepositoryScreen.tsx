import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Eye,
  FileText,
  Filter,
  GripVertical,
  History,
  Info,
  Layers,
  Music,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Table2,
  Tag,
  Trash2,
  Upload,
  Wand2,
  X
} from 'lucide-react';
import Papa from 'papaparse';
import { DatasetColumnMappings, DatasetFieldRole, DatasetGenerationJob, DatasetModality, DatasetPreviewType, DatasetSchemaField, EvalDataset } from '../types';
import { auth } from '../auth';
import { ConfirmModal } from './ConfirmModal';
import MediaRenderer from './MediaRenderer';
import DatasetGenerationModal from './DatasetGenerationModal';
import { normalizeUrl } from '../utils';
import {
  deleteDataset,
  loadDatasetVersion,
  rollbackDataset,
  saveDataset,
  subscribeDatasets,
  updateDatasetItem as persistDatasetItemEdit,
  updateDatasetManifest as persistDatasetManifestEdit,
} from '../features/datasets/api';
import { DATASET_ITEM_ID_KEY, getDatasetItemStableId } from '../datasetSync';
import { subscribeGenerationJobs } from '../features/generation/api';
import {
  DATASET_MODALITIES,
  STANDARD_DATASET_FIELDS,
  appendDatasetVersion,
  buildDatasetCard,
  buildDatasetSchema,
  getDatasetColumnMappings,
  getDatasetDisplayValue,
  inferDatasetMappings,
  inferDatasetModality,
  inferInputTypeFromDataset,
  inferPreviewType,
  inferSchemaType,
  normalizeDatasetForDisplay,
  normalizeDatasetRows,
  validateDatasetItems
} from '../datasetManifest';

interface DatasetRepositoryScreenProps {
  onBack: () => void;
  mode?: 'repository' | 'generation';
  initialDatasetId?: string;
}

type WizardMode = 'create' | 'append';
type WizardStep = 1 | 2 | 3;

type DatasetValueEditor = 'text' | 'number' | 'boolean' | 'json' | 'list' | 'modality';

interface DatasetEditTarget {
  scope: 'case' | 'manifest';
  label: string;
  fieldKey: string;
  stableItemId?: string;
  rowIndex?: number;
  manifestPath?: string;
  editor: DatasetValueEditor;
  previewType?: DatasetPreviewType;
  originalValue: unknown;
}

interface DatasetFormState {
  name: string;
  description: string;
  tags: string;
  modality: DatasetModality;
  categoryPath: string;
  source: string;
  applicableTasks: string;
  applicableStages: string;
  rubricBinding: string;
  coverageGaps: string;
}

const ROLE_OPTIONS: Array<{ key: DatasetFieldRole; label: string }> = [
  { key: 'case_id', label: '用例ID' },
  { key: 'input', label: '输入列' },
  { key: 'output', label: '模型结果列' },
  { key: 'dimension', label: '评测维度列' },
  { key: 'reference', label: '参考素材列' },
  { key: 'metadata', label: '元数据列' },
  { key: 'rubric', label: 'Rubric列' },
  { key: 'system', label: '系统列' }
];

const PREVIEW_OPTIONS: Array<{ key: DatasetPreviewType; label: string }> = [
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'link', label: '链接' },
  { key: 'none', label: '不预览' }
];

type DatasetPreviewSize = 'small' | 'medium' | 'large';

const PREVIEW_SIZE_OPTIONS: Array<{ key: DatasetPreviewSize; label: string; description: string }> = [
  { key: 'small', label: '小', description: '紧凑浏览' },
  { key: 'medium', label: '中', description: '常规对比' },
  { key: 'large', label: '大', description: '清晰审看' }
];

const PREVIEW_SIZE_STORAGE_KEY = 'eval_studio_dataset_preview_size';
const DATASET_LAYOUT_STORAGE_KEY = 'eval_studio_dataset_repository_layout';
const DEFAULT_LAYOUT_WIDTHS = { left: 280, right: 360 };

const readStoredPreviewSize = (): DatasetPreviewSize => {
  try {
    const value = window.localStorage.getItem(PREVIEW_SIZE_STORAGE_KEY) as DatasetPreviewSize | null;
    return PREVIEW_SIZE_OPTIONS.some(option => option.key === value) ? value as DatasetPreviewSize : 'medium';
  } catch {
    return 'medium';
  }
};

const readStoredLayoutWidths = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DATASET_LAYOUT_STORAGE_KEY) || '{}');
    return {
      left: Number.isFinite(parsed.left) ? parsed.left : DEFAULT_LAYOUT_WIDTHS.left,
      right: Number.isFinite(parsed.right) ? parsed.right : DEFAULT_LAYOUT_WIDTHS.right
    };
  } catch {
    return DEFAULT_LAYOUT_WIDTHS;
  }
};

const DEFAULT_TEMPLATE_HEADERS = STANDARD_DATASET_FIELDS.map(field => field.label);

const emptyForm = (): DatasetFormState => ({
  name: '',
  description: '',
  tags: '',
  modality: 'video',
  categoryPath: '',
  source: '',
  applicableTasks: '',
  applicableStages: '',
  rubricBinding: '',
  coverageGaps: ''
});

const splitList = (value: string) => value.split(/[,，;；|]/).map(item => item.trim()).filter(Boolean);

const firstUrl = (value: any) => String(value || '').match(/https?:\/\/[^\s"'\t|,;>]+/)?.[0] || String(value || '').trim();

const formatDate = (value?: number) => value ? new Date(value).toLocaleString('zh-CN') : '-';

const jobStatusLabel = (status?: DatasetGenerationJob['status']) => {
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'partial') return '部分成功';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'queued') return '排队中';
  return '草稿';
};

const jobStatusClass = (status?: DatasetGenerationJob['status']) => {
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20';
  if (status === 'partial') return 'bg-amber-500/15 text-amber-300 border-amber-500/20';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/15 text-red-300 border-red-500/20';
  if (status === 'running' || status === 'queued') return 'bg-blue-500/15 text-blue-300 border-blue-500/20';
  return 'bg-white/10 text-slate-300 border-white/10';
};

const roleLabel = (role?: DatasetFieldRole) => ROLE_OPTIONS.find(option => option.key === role)?.label || '元数据列';

const previewTypeForField = (field: Pick<DatasetSchemaField, 'previewType' | 'sourceKey' | 'key'>, rows: Record<string, any>[]) =>
  field.previewType || inferPreviewType(field.sourceKey || field.key, rows.slice(0, 5).map(row => row[field.sourceKey || field.key] ?? row[field.key]));

const fieldSample = (field: Pick<DatasetSchemaField, 'sourceKey' | 'key'>, rows: Record<string, any>[]) => {
  const sourceKey = field.sourceKey || field.key;
  const sample = rows.find(row => String(row[sourceKey] ?? row[field.key] ?? '').trim());
  return sample ? String(sample[sourceKey] ?? sample[field.key] ?? '') : '';
};

const ensureUniqueFieldKey = (baseValue: string, existingKeys: string[]) => {
  const base = (baseValue || '自定义字段').trim();
  if (!existingKeys.includes(base)) return base;
  let index = 2;
  while (existingKeys.includes(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
};

const deriveMappingsFromSchemaFields = (fields: DatasetSchemaField[]): DatasetColumnMappings => {
  const mappings: DatasetColumnMappings = {
    inputColumns: [],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
    standard: {}
  };

  fields.forEach(field => {
    if (!field.key) return;
    if (field.canonicalKey) mappings.standard[field.canonicalKey] = field.key;
    if (field.role === 'case_id') mappings.caseId = field.key;
    if (field.role === 'input' || field.role === 'media') mappings.inputColumns.push(field.key);
    if (field.role === 'output') mappings.outputColumns.push(field.key);
    if (field.role === 'dimension') mappings.dimensionColumns.push(field.key);
    if (field.role === 'reference') mappings.referenceColumns.push(field.key);
  });

  return {
    ...mappings,
    inputColumns: Array.from(new Set(mappings.inputColumns)),
    outputColumns: Array.from(new Set(mappings.outputColumns)),
    dimensionColumns: Array.from(new Set(mappings.dimensionColumns)),
    referenceColumns: Array.from(new Set(mappings.referenceColumns))
  };
};

const getDatasetColumnKeys = (dataset?: EvalDataset) => {
  if (!dataset) return [];
  const schemaKeys = dataset.inputSchema?.map(field => field.key).filter(Boolean) || [];
  const sourceKeys = dataset.inputSchema?.map(field => field.sourceKey).filter(Boolean) || [];
  const rowKeys = (dataset.items || []).flatMap(row => Object.keys(row).filter(key => key !== '_originalData' && !key.startsWith('__')));
  return Array.from(new Set([...schemaKeys, ...sourceKeys, ...rowKeys])).filter(key => !key.startsWith('__'));
};

const applyRenameMapToMappings = (mappings: DatasetColumnMappings, renameMap: Map<string, string>): DatasetColumnMappings => {
  const renameValue = (value?: string) => value ? renameMap.get(value) || value : value;
  const renameList = (values: string[] = []) => Array.from(new Set(values.map(value => renameValue(value)).filter(Boolean) as string[]));
  const standard = Object.fromEntries(
    Object.entries(mappings.standard || {}).map(([canonicalKey, sourceKey]) => [canonicalKey, renameValue(sourceKey) || sourceKey])
  );

  return {
    ...mappings,
    caseId: renameValue(mappings.caseId),
    inputColumns: renameList(mappings.inputColumns),
    outputColumns: renameList(mappings.outputColumns),
    dimensionColumns: renameList(mappings.dimensionColumns),
    referenceColumns: renameList(mappings.referenceColumns),
    standard
  };
};

const applyRenameMapToRows = (rows: Record<string, any>[], renameMap: Map<string, string>) =>
  rows.map(row => {
    const next: Record<string, any> = {};
    Object.entries(row).forEach(([key, value]) => {
      if (key === '_originalData') {
        next[key] = value;
        return;
      }
      next[renameMap.get(key) || key] = value;
    });
    return next;
  });

const applyRenameMapToSchema = (fields: DatasetSchemaField[], renameMap: Map<string, string>) =>
  fields.map(field => {
    const nextKey = renameMap.get(field.key) || field.key;
    const nextSourceKey = field.sourceKey ? renameMap.get(field.sourceKey) || field.sourceKey : field.sourceKey;
    const nextLabel = nextKey !== field.key || field.label === field.key ? nextKey : field.label;
    return {
      ...field,
      key: nextKey,
      label: nextLabel,
      sourceKey: nextSourceKey
    };
  });

const createSchemaFieldsFromMappings = (
  headers: string[],
  rows: Record<string, any>[],
  mappings: DatasetColumnMappings,
  existingFields: DatasetSchemaField[] = []
): DatasetSchemaField[] => {
  if (existingFields.length) return existingFields.map(field => {
    const sourceKey = field.sourceKey || field.key;
    const canonicalKey = field.canonicalKey || Object.entries(mappings.standard).find(([, source]) => source === field.key || source === sourceKey)?.[0];
    const standard = STANDARD_DATASET_FIELDS.find(item => item.canonicalKey === canonicalKey);
    const role = field.role
      || standard?.role
      || (mappings.caseId === field.key ? 'case_id' : undefined)
      || (mappings.outputColumns.includes(field.key) ? 'output' : undefined)
      || (mappings.dimensionColumns.includes(field.key) ? 'dimension' : undefined)
      || (mappings.referenceColumns.includes(field.key) ? 'reference' : undefined)
      || (mappings.inputColumns.includes(field.key) ? 'input' : undefined)
      || 'metadata';
    const previewType = field.previewType || standard?.previewType || inferPreviewType(sourceKey, rows.slice(0, 5).map(row => row[sourceKey] ?? row[field.key]));
    return {
      ...field,
      role,
      canonicalKey,
      sourceKey,
      previewType,
      type: field.type || standard?.type || inferSchemaType(previewType)
    };
  });

  const fields: DatasetSchemaField[] = [];
  const usedSourceKeys = new Set<string>();
  const addField = (field: DatasetSchemaField) => {
    if (!field.key || fields.some(item => item.key === field.key)) return;
    fields.push(field);
    if (field.sourceKey) usedSourceKeys.add(field.sourceKey);
  };

  STANDARD_DATASET_FIELDS.forEach(standard => {
    const sourceKey = mappings.standard[standard.canonicalKey];
    if (!sourceKey) return;
    const previewType = standard.previewType || inferPreviewType(sourceKey, rows.slice(0, 5).map(row => row[sourceKey]));
    addField({
      key: standard.label,
      label: standard.label,
      type: standard.type || inferSchemaType(previewType),
      role: standard.role,
      canonicalKey: standard.canonicalKey,
      sourceKey,
      previewType,
      required: standard.required
    });
  });

  const addColumns = (columns: string[], role: DatasetFieldRole) => {
    columns.forEach(column => {
      if (usedSourceKeys.has(column)) return;
      const previewType = inferPreviewType(column, rows.slice(0, 5).map(row => row[column]));
      addField({
        key: column,
        label: column,
        type: inferSchemaType(previewType),
        role,
        sourceKey: column,
        previewType
      });
    });
  };

  addColumns(mappings.outputColumns, 'output');
  addColumns(mappings.inputColumns, 'input');
  addColumns(mappings.dimensionColumns, 'dimension');
  addColumns(mappings.referenceColumns, 'reference');

  if (!fields.some(field => field.role === 'input')) {
    const fallback = headers.find(header => !mappings.outputColumns.includes(header) && header !== mappings.caseId);
    if (fallback) {
      const previewType = inferPreviewType(fallback, rows.slice(0, 5).map(row => row[fallback]));
      addField({
        key: fallback,
        label: fallback,
        type: inferSchemaType(previewType),
        role: 'input',
        sourceKey: fallback,
        previewType
      });
    }
  }

  return fields;
};

const parseTableText = (text: string) => {
  const delimiter = text.includes('\t') ? '\t' : undefined;
  const results = Papa.parse<Record<string, any>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transform: value => String(value ?? '').trim(),
    transformHeader: header => header.trim()
  });
  const rows = (results.data || []).filter(row => Object.values(row).some(value => String(value ?? '').trim()));
  const headers = results.meta.fields || (rows[0] ? Object.keys(rows[0]) : []);
  return { rows, headers };
};

const downloadCsv = (filename: string, rows: Record<string, any>[] | string[]) => {
  const csvContent = Array.isArray(rows) && typeof rows[0] === 'string'
    ? (rows as string[]).join(',') + '\n'
    : Papa.unparse((rows as Record<string, any>[]).map(row => {
      const { _originalData, [DATASET_ITEM_ID_KEY]: _stableItemId, ...rest } = row;
      return rest;
    }));
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const mediaSizeClasses: Record<DatasetPreviewSize, { media: string; audio: string; link: string; text: string }> = {
  small: {
    media: 'w-36 h-24',
    audio: 'w-40',
    link: 'max-w-[220px]',
    text: 'max-w-[260px] line-clamp-3',
  },
  medium: {
    media: 'w-64 h-40',
    audio: 'w-64',
    link: 'max-w-[320px]',
    text: 'max-w-[360px] line-clamp-4',
  },
  large: {
    media: 'w-[420px] h-[260px]',
    audio: 'w-[420px]',
    link: 'max-w-[460px]',
    text: 'max-w-[520px] line-clamp-6',
  },
};

const MediaCell = ({
  value,
  previewType,
  previewSize,
}: {
  value: any;
  previewType?: DatasetPreviewType;
  previewSize: DatasetPreviewSize;
}) => {
  const url = firstUrl(value);
  if (!url) return <span className="text-xs text-slate-500">空</span>;

  const inferred = previewType && previewType !== 'none' ? previewType : inferPreviewType('', [url]);
  const sizeClass = mediaSizeClasses[previewSize];
  if (inferred === 'image' || inferred === 'video') {
    return (
      <div className={`${sizeClass.media} rounded-lg overflow-hidden border border-white/10 bg-black/40`}>
        <MediaRenderer
          url={url}
          isActive={false}
          forceType={inferred}
          videoPreload="metadata"
          className="rounded-lg border-0 shadow-none"
        />
      </div>
    );
  }

  if (inferred === 'audio') {
    return (
      <audio
        controls
        preload="metadata"
        src={normalizeUrl(url)}
        className={`${sizeClass.audio} h-9`}
      />
    );
  }

  if (url.startsWith('http')) {
    return (
      <a href={normalizeUrl(url)} target="_blank" rel="noopener noreferrer" className={`text-xs text-blue-300 hover:underline break-all line-clamp-2 ${sizeClass.link}`}>
        {url}
      </a>
    );
  }

  return <span className={`text-xs text-slate-300 ${sizeClass.text} whitespace-pre-wrap`}>{String(value)}</span>;
};

const DatasetRepositoryScreen: React.FC<DatasetRepositoryScreenProps> = ({ onBack, mode = 'repository', initialDatasetId }) => {
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [datasetToDelete, setDatasetToDelete] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalityFilter, setModalityFilter] = useState<DatasetModality | 'all'>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [dimensionFilter, setDimensionFilter] = useState('');
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [generationJobs, setGenerationJobs] = useState<DatasetGenerationJob[]>([]);
  const [columnRenameOpen, setColumnRenameOpen] = useState(false);
  const [columnRenameDrafts, setColumnRenameDrafts] = useState<Record<string, string>>({});
  const [columnRenameError, setColumnRenameError] = useState('');
  const [isSavingColumnNames, setIsSavingColumnNames] = useState(false);
  const [previewSize, setPreviewSize] = useState<DatasetPreviewSize>(readStoredPreviewSize);
  const [layoutWidths, setLayoutWidths] = useState(readStoredLayoutWidths);
  const [resizingPane, setResizingPane] = useState<'left' | 'right' | null>(null);
  const resizeStateRef = useRef<{ pane: 'left' | 'right'; startX: number; startLeft: number; startRight: number } | null>(null);
  const repositoryLayoutRef = useRef<HTMLDivElement>(null);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
  const [isDeletingRow, setIsDeletingRow] = useState(false);
  const [inlineRenameColumn, setInlineRenameColumn] = useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState('');
  const [inlineRenameError, setInlineRenameError] = useState('');
  const [isSavingInlineRename, setIsSavingInlineRename] = useState(false);
  const [viewingVersionDataset, setViewingVersionDataset] = useState<EvalDataset | null>(null);
  const [versionLoading, setVersionLoading] = useState<number | null>(null);
  const [versionError, setVersionError] = useState('');
  const [versionToRollback, setVersionToRollback] = useState<number | null>(null);
  const [isRollingBackVersion, setIsRollingBackVersion] = useState(false);
  const [editTarget, setEditTarget] = useState<DatasetEditTarget | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>('create');
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [wizardTarget, setWizardTarget] = useState<EvalDataset | null>(null);
  const [form, setForm] = useState<DatasetFormState>(emptyForm);
  const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([]);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [schemaFields, setSchemaFields] = useState<DatasetSchemaField[]>(() =>
    createSchemaFieldsFromMappings(DEFAULT_TEMPLATE_HEADERS, [], inferDatasetMappings(DEFAULT_TEMPLATE_HEADERS, []))
  );
  const [wizardError, setWizardError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = subscribeDatasets(setDatasets, (error) => {
      console.error('Error fetching datasets:', error);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_SIZE_STORAGE_KEY, previewSize);
    } catch {
      // Local UI preference only; ignore storage failures.
    }
  }, [previewSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DATASET_LAYOUT_STORAGE_KEY, JSON.stringify(layoutWidths));
    } catch {
      // Local UI preference only; ignore storage failures.
    }
  }, [layoutWidths]);

  useEffect(() => {
    if (!resizingPane) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const containerWidth = repositoryLayoutRef.current?.getBoundingClientRect().width || 1280;
      const minCenterWidth = 520;
      const maxSideTotal = Math.max(0, containerWidth - minCenterWidth);
      const delta = event.clientX - state.startX;
      setLayoutWidths(current => {
        let nextLeft = current.left;
        let nextRight = current.right;
        if (state.pane === 'left') {
          nextLeft = Math.max(220, Math.min(440, state.startLeft + delta));
          if (nextLeft + nextRight > maxSideTotal) nextLeft = Math.max(220, maxSideTotal - nextRight);
        } else {
          nextRight = Math.max(320, Math.min(680, state.startRight - delta));
          if (nextLeft + nextRight > maxSideTotal) nextRight = Math.max(320, maxSideTotal - nextLeft);
        }
        return { left: nextLeft, right: nextRight };
      });
    };
    const handlePointerUp = () => {
      resizeStateRef.current = null;
      setResizingPane(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [resizingPane]);

  const normalizedDatasets = useMemo(() => datasets.map(normalizeDatasetForDisplay), [datasets]);

  const tagOptions = useMemo(() => Array.from(new Set(normalizedDatasets.flatMap(dataset => dataset.tags || []))).sort(), [normalizedDatasets]);

  const dimensionOptions = useMemo(() => {
    const options = new Set<string>();
    normalizedDatasets.forEach(dataset => {
      Object.entries(dataset.validationSummary?.dimensionDistribution || {}).forEach(([key, values]) => {
        Object.keys(values).forEach(value => options.add(`${key}: ${value}`));
      });
    });
    return Array.from(options).sort();
  }, [normalizedDatasets]);

  const filteredDatasets = useMemo(() => normalizedDatasets.filter(dataset => {
    const search = searchTerm.trim().toLowerCase();
    const matchesSearch = !search || [dataset.name, dataset.description, ...(dataset.tags || [])].join(' ').toLowerCase().includes(search);
    const matchesModality = modalityFilter === 'all' || dataset.modality === modalityFilter;
    const matchesTag = !tagFilter || dataset.tags?.includes(tagFilter);
    const matchesDimension = !dimensionFilter || (() => {
      const [key, value] = dimensionFilter.split(':').map(part => part.trim());
      return !!dataset.validationSummary?.dimensionDistribution?.[key]?.[value];
    })();
    return matchesSearch && matchesModality && matchesTag && matchesDimension;
  }), [normalizedDatasets, searchTerm, modalityFilter, tagFilter, dimensionFilter]);

  useEffect(() => {
    if (!selectedDatasetId && filteredDatasets.length) {
      setSelectedDatasetId(filteredDatasets[0].id);
      return;
    }
    if (selectedDatasetId && !filteredDatasets.some(dataset => dataset.id === selectedDatasetId) && filteredDatasets.length) {
      setSelectedDatasetId(filteredDatasets[0].id);
    }
  }, [filteredDatasets, selectedDatasetId]);

  useEffect(() => {
    if (initialDatasetId && normalizedDatasets.some(dataset => dataset.id === initialDatasetId)) {
      setSelectedDatasetId(initialDatasetId);
    }
  }, [initialDatasetId, normalizedDatasets]);

  const selectedDataset = normalizedDatasets.find(dataset => dataset.id === selectedDatasetId) || filteredDatasets[0];
  const tableDataset = viewingVersionDataset || selectedDataset;
  const isViewingHistoricalVersion = !!viewingVersionDataset;
  const selectedMappings = getDatasetColumnMappings(tableDataset);
  const selectedRows = tableDataset?.items || [];
  const selectedRow = selectedRows[Math.min(selectedRowIndex, Math.max(selectedRows.length - 1, 0))];
  const outputColumns = selectedMappings.outputColumns;
  const referenceColumns = selectedMappings.referenceColumns;
  const currentColumnKeys = useMemo(() => getDatasetColumnKeys(selectedDataset), [selectedDataset]);
  const promptKeys = [
    selectedMappings.standard.full_prompt,
    selectedMappings.standard.zh_prompt,
    '完整Prompt',
    '中文Prompt',
    'prompt',
    'Prompt'
  ].filter(Boolean) as string[];
  const idKeys = [selectedMappings.standard.case_id, selectedMappings.caseId, '用例ID', 'id', 'Case_ID']
    .filter((key): key is string => Boolean(key) && key !== DATASET_ITEM_ID_KEY && !key.startsWith('__'));
  const tagKeys = [selectedMappings.standard.tags, '标签', 'tags'].filter(Boolean) as string[];

  useEffect(() => {
    if (!selectedDataset?.id) {
      setGenerationJobs([]);
      return;
    }
    const unsubscribe = subscribeGenerationJobs({ datasetId: selectedDataset.id }, (jobs) => {
      setGenerationJobs(jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    }, (error) => {
      console.error('Error fetching generation jobs:', error);
      setGenerationJobs([]);
    });
    return () => unsubscribe();
  }, [selectedDataset?.id]);


  const isGenerationMode = mode === 'generation';
  const runningGenerationJobs = generationJobs.filter(job => job.status === 'running' || job.status === 'queued' || job.status === 'partial');
  const latestGenerationJob = generationJobs[0];

  useEffect(() => {
    setViewingVersionDataset(null);
    setVersionError('');
    setSyncNotice('');
    setVersionLoading(null);
    setVersionToRollback(null);
    setSelectedRowIndex(0);
  }, [selectedDatasetId]);

  const formatEditDraft = (value: unknown, editor: DatasetValueEditor) => {
    if (editor === 'json') return JSON.stringify(value ?? null, null, 2);
    if (editor === 'list') return Array.isArray(value) ? value.join('\n') : String(value ?? '');
    if (editor === 'boolean') return value ? 'true' : 'false';
    return String(value ?? '');
  };

  const openCaseEditor = (rowIndex: number, fieldKey: string) => {
    if (!selectedDataset || isViewingHistoricalVersion || fieldKey === DATASET_ITEM_ID_KEY || fieldKey.startsWith('__')) return;
    const row = selectedRows[rowIndex];
    if (!row) return;
    const stableItemId = getDatasetItemStableId(row);
    if (!stableItemId) {
      setVersionError('这个旧 case 尚未建立稳定来源 ID，请刷新页面后重试。');
      return;
    }
    const value = row[fieldKey];
    const schemaField = tableDataset?.inputSchema.find(field => field.key === fieldKey);
    const editor: DatasetValueEditor = typeof value === 'number'
      ? 'number'
      : typeof value === 'boolean'
        ? 'boolean'
        : value && typeof value === 'object'
          ? 'json'
          : 'text';
    const target: DatasetEditTarget = {
      scope: 'case',
      label: `${getDatasetDisplayValue(row, idKeys) || `case-${rowIndex + 1}`} / ${fieldKey}`,
      fieldKey,
      stableItemId,
      rowIndex,
      editor,
      previewType: schemaField?.previewType,
      originalValue: value,
    };
    setEditTarget(target);
    setEditDraft(formatEditDraft(value, editor));
    setEditError('');
  };

  const openManifestEditor = (
    manifestPath: string,
    label: string,
    value: unknown,
    editor: DatasetValueEditor = 'text'
  ) => {
    if (!selectedDataset || isViewingHistoricalVersion) return;
    const target: DatasetEditTarget = {
      scope: 'manifest',
      label,
      fieldKey: manifestPath.split('.').at(-1) || manifestPath,
      manifestPath,
      editor,
      originalValue: value,
    };
    setEditTarget(target);
    setEditDraft(formatEditDraft(value, editor));
    setEditError('');
  };

  const closeValueEditor = () => {
    if (isSavingEdit) return;
    setEditTarget(null);
    setEditDraft('');
    setEditError('');
  };

  const parseEditDraft = () => {
    if (!editTarget) return editDraft;
    if (editTarget.editor === 'number') {
      const number = Number(editDraft);
      if (!Number.isFinite(number)) throw new Error('请输入有效数字。');
      return number;
    }
    if (editTarget.editor === 'boolean') return editDraft === 'true';
    if (editTarget.editor === 'json') {
      try {
        return JSON.parse(editDraft);
      } catch {
        throw new Error('JSON 格式不正确，请检查括号、引号和逗号。');
      }
    }
    if (editTarget.editor === 'list') {
      return editDraft.split(/[\n,，]/).map(value => value.trim()).filter(Boolean);
    }
    return editDraft;
  };

  const commitValueEdit = async () => {
    if (!selectedDataset || !editTarget || isSavingEdit) return;
    try {
      const value = parseEditDraft();
      setIsSavingEdit(true);
      setEditError('');
      let saved: EvalDataset;
      if (editTarget.scope === 'case') {
        saved = await persistDatasetItemEdit(
          selectedDataset,
          editTarget.stableItemId || '',
          editTarget.fieldKey,
          value
        );
      } else {
        const path = editTarget.manifestPath || editTarget.fieldKey;
        const patch = path.startsWith('datasetCard.')
          ? { datasetCard: { [path.slice('datasetCard.'.length)]: value } }
          : { [path]: value };
        saved = await persistDatasetManifestEdit(selectedDataset, patch as Partial<EvalDataset>);
      }
      setDatasets(current => current.map(dataset => dataset.id === saved.id ? saved : dataset));
      setSelectedDatasetId(saved.id);
      setViewingVersionDataset(null);
      setEditTarget(null);
      setEditDraft('');
      if (saved.syncSummary) {
        const sync = saved.syncSummary;
        setSyncNotice(`已生成 v${saved.version}；同步 ${sync.tasks} 个任务、${sync.votesUpdated} 条结果记录。`);
      }
    } catch (error: any) {
      const isConflict = error?.status === 409 || error?.code === 'VERSION_CONFLICT';
      setEditError(isConflict ? '评测集刚刚被其他人更新，请关闭编辑器、刷新后重试。' : (error?.message || String(error)));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const beginPaneResize = (pane: 'left' | 'right', event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      pane,
      startX: event.clientX,
      startLeft: layoutWidths.left,
      startRight: layoutWidths.right,
    };
    setResizingPane(pane);
  };

  const adjustPaneWidth = (pane: 'left' | 'right', delta: number) => {
    setLayoutWidths(current => {
      if (pane === 'left') {
        return { ...current, left: Math.max(220, Math.min(440, current.left + delta)) };
      }
      return { ...current, right: Math.max(320, Math.min(680, current.right + delta)) };
    });
  };

  const openColumnRenameEditor = () => {
    if (!selectedDataset || isViewingHistoricalVersion) return;
    const drafts = Object.fromEntries(getDatasetColumnKeys(selectedDataset).map(column => [column, column]));
    setColumnRenameDrafts(drafts);
    setColumnRenameError('');
    setColumnRenameOpen(true);
  };

  const closeColumnRenameEditor = () => {
    setColumnRenameOpen(false);
    setColumnRenameError('');
    setIsSavingColumnNames(false);
  };

  const saveColumnRenameEntries = async (
    renameEntries: Array<readonly [string, string]>,
    options: {
      setSaving: (value: boolean) => void;
      setError: (value: string) => void;
      onSuccess: () => void;
    }
  ) => {
    if (!selectedDataset || isViewingHistoricalVersion) {
      options.setError('历史版本为只读状态，请先返回当前版本再编辑列名。');
      return;
    }
    if (!renameEntries.length) {
      options.onSuccess();
      return;
    }

    const renameMap = new Map<string, string>(renameEntries);
    const userName = auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown';
    const now = Date.now();
    const nextItems = applyRenameMapToRows(selectedDataset.items || [], renameMap);
    const baseMappings = getDatasetColumnMappings(selectedDataset);
    const nextMappings = applyRenameMapToMappings(baseMappings, renameMap);
    const nextSchema = applyRenameMapToSchema(selectedDataset.inputSchema || [], renameMap);
    const nextInputType = inferInputTypeFromDataset({ ...selectedDataset, items: nextItems, inputSchema: nextSchema, columnMappings: nextMappings } as EvalDataset);
    const nextModality = inferDatasetModality(nextItems, nextMappings, selectedDataset.modality || 'other', nextSchema);
    const changeSummary = `重命名列：${renameEntries.map(([oldName, newName]) => `${oldName} -> ${newName}`).join('；')}`;
    const versionMeta = appendDatasetVersion(
      selectedDataset,
      userName,
      changeSummary,
      selectedDataset.items?.length || 0,
      nextItems.length
    );

    const nextDataset: EvalDataset = {
      ...selectedDataset,
      items: nextItems,
      inputSchema: nextSchema,
      inputType: nextInputType,
      modality: nextModality,
      columnMappings: nextMappings,
      datasetCard: buildDatasetCard(
        {
          ...selectedDataset,
          items: nextItems,
          inputSchema: nextSchema,
          columnMappings: nextMappings,
          modality: nextModality
        } as EvalDataset,
        nextMappings,
        {
          applicableTasks: selectedDataset.datasetCard?.applicableTasks || [],
          applicableStages: selectedDataset.datasetCard?.applicableStages || [],
          source: selectedDataset.datasetCard?.source || '',
          rubricBinding: selectedDataset.datasetCard?.rubricBinding || '',
          coverageGaps: selectedDataset.datasetCard?.coverageGaps || [],
          latestChange: changeSummary,
          modality: nextModality
        }
      ),
      validationSummary: validateDatasetItems(nextItems, nextMappings),
      ...versionMeta,
      updatedAt: now
    };

    try {
      options.setSaving(true);
      const savedDataset = await saveDataset(nextDataset, { expectedVersion: selectedDataset.version || 1 });
      setDatasets(prev => prev.map(dataset => dataset.id === savedDataset.id ? savedDataset : dataset));
      setSelectedDatasetId(savedDataset.id);
      setSelectedRowIndex(0);
      setViewingVersionDataset(null);
      options.onSuccess();
    } catch (error: any) {
      console.error('Error renaming dataset columns:', error);
      options.setError(`保存列名失败：${error.message || error}`);
      options.setSaving(false);
    }
  };

  const handleSaveColumnNames = async () => {
    if (!selectedDataset || isSavingColumnNames || isViewingHistoricalVersion) return;
    const columns = currentColumnKeys;
    const trimmedDrafts = Object.fromEntries(columns.map(column => [column, (columnRenameDrafts[column] ?? column).trim()]));
    const emptyColumn = columns.find(column => !trimmedDrafts[column]);
    if (emptyColumn) {
      setColumnRenameError(`列「${emptyColumn}」的新名称不能为空。`);
      return;
    }
    const reservedColumn = columns.find(column => trimmedDrafts[column] === '_originalData');
    if (reservedColumn) {
      setColumnRenameError('列名不能使用系统保留字段 _originalData。');
      return;
    }
    const normalizedNames = columns.map(column => trimmedDrafts[column]);
    const duplicateName = normalizedNames.find((name, index) => normalizedNames.indexOf(name) !== index);
    if (duplicateName) {
      setColumnRenameError(`列名「${duplicateName}」重复，请为每一列设置唯一名称。`);
      return;
    }

    const renameEntries = columns
      .map(column => [column, trimmedDrafts[column]] as const)
      .filter(([oldName, newName]) => oldName !== newName);

    await saveColumnRenameEntries(renameEntries, {
      setSaving: setIsSavingColumnNames,
      setError: setColumnRenameError,
      onSuccess: closeColumnRenameEditor,
    });
  };

  const openInlineColumnRename = (column: string) => {
    if (isViewingHistoricalVersion) return;
    setInlineRenameColumn(column);
    setInlineRenameValue(column);
    setInlineRenameError('');
  };

  const cancelInlineColumnRename = () => {
    setInlineRenameColumn(null);
    setInlineRenameValue('');
    setInlineRenameError('');
    setIsSavingInlineRename(false);
  };

  const commitInlineColumnRename = async () => {
    if (!selectedDataset || !inlineRenameColumn || isSavingInlineRename) return;
    const nextName = inlineRenameValue.trim();
    if (!nextName) {
      setInlineRenameError('新列名不能为空。');
      return;
    }
    if (nextName === '_originalData') {
      setInlineRenameError('列名不能使用系统保留字段 _originalData。');
      return;
    }
    const duplicateName = currentColumnKeys.some(column => column !== inlineRenameColumn && column === nextName);
    if (duplicateName) {
      setInlineRenameError(`列名「${nextName}」已存在。`);
      return;
    }
    if (nextName === inlineRenameColumn) {
      cancelInlineColumnRename();
      return;
    }

    await saveColumnRenameEntries([[inlineRenameColumn, nextName]], {
      setSaving: setIsSavingInlineRename,
      setError: setInlineRenameError,
      onSuccess: cancelInlineColumnRename,
    });
  };

  const openWizard = (mode: WizardMode, target?: EvalDataset) => {
    const normalizedTarget = target ? normalizeDatasetForDisplay(target) : null;
    setWizardMode(mode);
    setWizardTarget(normalizedTarget);
    setWizardStep(mode === 'append' ? 2 : 1);
    setWizardOpen(true);
    setWizardError('');
    setParsedRows([]);
    setParsedHeaders(normalizedTarget?.inputSchema?.map(field => field.key) || []);
    setPastedText('');
    const initialMappings = normalizedTarget ? getDatasetColumnMappings(normalizedTarget) : inferDatasetMappings(DEFAULT_TEMPLATE_HEADERS, []);
    const initialFields = createSchemaFieldsFromMappings(
      normalizedTarget?.inputSchema?.map(field => field.key) || DEFAULT_TEMPLATE_HEADERS,
      normalizedTarget?.items || [],
      initialMappings,
      normalizedTarget?.inputSchema || []
    );
    setSchemaFields(initialFields);
    setForm({
      name: normalizedTarget?.name || '',
      description: normalizedTarget?.description || '',
      tags: normalizedTarget?.tags?.join(', ') || '',
      modality: normalizedTarget?.modality || 'video',
      categoryPath: normalizedTarget?.categoryPath?.join(' / ') || '',
      source: normalizedTarget?.datasetCard?.source || '',
      applicableTasks: normalizedTarget?.datasetCard?.applicableTasks?.join(', ') || '',
      applicableStages: normalizedTarget?.datasetCard?.applicableStages?.join(', ') || '',
      rubricBinding: normalizedTarget?.datasetCard?.rubricBinding || '',
      coverageGaps: normalizedTarget?.datasetCard?.coverageGaps?.join('\n') || ''
    });
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardTarget(null);
    setWizardError('');
  };

  const applyParsedData = (text: string) => {
    const { rows, headers } = parseTableText(text);
    if (!headers.length) {
      setWizardError('未识别到表头，请确认 CSV/TSV 或粘贴内容第一行为字段名。');
      return;
    }
    const inferred = inferDatasetMappings(headers, rows);
    const fields = createSchemaFieldsFromMappings(headers, rows, inferred);
    const derivedMappings = deriveMappingsFromSchemaFields(fields);
    const modality = inferDatasetModality(rows, derivedMappings, form.modality, fields);
    setParsedRows(rows);
    setParsedHeaders(headers);
    setSchemaFields(fields);
    setForm(prev => ({ ...prev, modality }));
    setWizardError('');
    setWizardStep(3);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    applyParsedData(text);
    event.target.value = '';
  };

  const commitSchemaFields = (updater: (prev: DatasetSchemaField[]) => DatasetSchemaField[]) => {
    setSchemaFields(prev => {
      const next = updater(prev);
      const nextMappings = deriveMappingsFromSchemaFields(next);
      setForm(current => ({
        ...current,
        modality: inferDatasetModality(parsedRows, nextMappings, current.modality, next)
      }));
      return next;
    });
  };

  const updateStandardSource = (standard: typeof STANDARD_DATASET_FIELDS[number], sourceKey: string) => {
    commitSchemaFields(prev => {
      const next = prev.filter(field => field.canonicalKey !== standard.canonicalKey);
      if (!sourceKey) return next;
      const previewType = standard.previewType || inferPreviewType(sourceKey, parsedRows.slice(0, 5).map(row => row[sourceKey]));
      return [
        ...next,
        {
          key: standard.label,
          label: standard.label,
          type: standard.type || inferSchemaType(previewType),
          role: standard.role,
          canonicalKey: standard.canonicalKey,
          sourceKey,
          previewType,
          required: standard.required
        }
      ];
    });
  };

  const updateField = (fieldKey: string, patch: Partial<DatasetSchemaField>) => {
    commitSchemaFields(prev => prev.map(field => {
      if (field.key !== fieldKey) return field;
      const sourceKey = patch.sourceKey ?? field.sourceKey ?? field.key;
      const nextKey = patch.key
        ? ensureUniqueFieldKey(patch.key, prev.filter(item => item.key !== fieldKey).map(item => item.key))
        : field.key;
      const previewType = patch.previewType || field.previewType || inferPreviewType(sourceKey, parsedRows.slice(0, 5).map(row => row[sourceKey]));
      return {
        ...field,
        ...patch,
        key: nextKey,
        label: patch.label ?? patch.key ?? field.label ?? nextKey,
        sourceKey,
        previewType,
        type: patch.type || inferSchemaType(previewType)
      };
    }));
  };

  const removeField = (fieldKey: string) => {
    commitSchemaFields(prev => prev.filter(field => field.key !== fieldKey));
  };

  const addCustomField = (role: DatasetFieldRole = 'metadata') => {
    commitSchemaFields(prev => {
      const preferredSource = parsedHeaders.find(header => !prev.some(field => field.sourceKey === header)) || parsedHeaders[0] || '';
      const key = ensureUniqueFieldKey(preferredSource || roleLabel(role), prev.map(field => field.key));
      const previewType = preferredSource ? inferPreviewType(preferredSource, parsedRows.slice(0, 5).map(row => row[preferredSource])) : 'text';
      return [
        ...prev,
        {
          key,
          label: key,
          type: inferSchemaType(previewType),
          role,
          sourceKey: preferredSource,
          previewType
        }
      ];
    });
  };

  const handleSaveWizard = async () => {
    if (!form.name.trim()) {
      setWizardError('请填写评测集名称。');
      setWizardStep(1);
      return;
    }
    if (wizardMode === 'append' && parsedRows.length === 0) {
      setWizardError('追加内容前请先上传或粘贴数据。');
      setWizardStep(2);
      return;
    }

    const now = Date.now();
    const userName = auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown';
    const tags = splitList(form.tags);
    const headers = parsedHeaders.length
      ? parsedHeaders
      : wizardTarget?.inputSchema?.map(field => field.key) || DEFAULT_TEMPLATE_HEADERS;
    const activeMappings = deriveMappingsFromSchemaFields(schemaFields);
    const normalizedRows = normalizeDatasetRows(parsedRows, activeMappings, schemaFields);
    const previousItems = wizardMode === 'append' ? wizardTarget?.items || [] : [];
    const nextItems = wizardMode === 'append' ? [...previousItems, ...normalizedRows] : normalizedRows;
    const validationSummary = validateDatasetItems(nextItems, activeMappings);
    const inputSchema = buildDatasetSchema(headers, normalizedRows.length ? normalizedRows : nextItems, activeMappings, schemaFields);
    const inputType = inferInputTypeFromDataset({ inputSchema, items: nextItems, columnMappings: activeMappings } as EvalDataset);
    const categoryPath = form.categoryPath.split('/').map(part => part.trim()).filter(Boolean);
    const versionMeta = appendDatasetVersion(
      wizardTarget || {},
      userName,
      wizardMode === 'append' ? `追加 ${normalizedRows.length} 条 case` : '创建结构化评测集',
      previousItems.length,
      nextItems.length
    );

    const datasetBase: EvalDataset = {
      id: wizardTarget?.id || `ds-${now}`,
      name: form.name.trim().slice(0, 100),
      description: form.description.trim(),
      tags,
      inputSchema,
      items: nextItems,
      inputType,
      modality: form.modality,
      categoryPath: categoryPath.length ? categoryPath : ['未分类'],
      standardFields: STANDARD_DATASET_FIELDS,
      columnMappings: activeMappings,
      datasetCard: buildDatasetCard(
        {
          ...(wizardTarget || {}),
          name: form.name,
          description: form.description,
          tags,
          items: nextItems,
          modality: form.modality
        },
        activeMappings,
        {
          applicableTasks: splitList(form.applicableTasks),
          applicableStages: splitList(form.applicableStages),
          source: form.source.trim(),
          rubricBinding: form.rubricBinding.trim(),
          coverageGaps: form.coverageGaps.split('\n').map(item => item.trim()).filter(Boolean),
          latestChange: wizardMode === 'append' ? `追加 ${normalizedRows.length} 条 case` : '创建结构化评测集',
          modality: form.modality
        }
      ),
      validationSummary,
      ...versionMeta,
      creatorUid: wizardTarget?.creatorUid || auth.currentUser.uid,
      creatorName: wizardTarget?.creatorName || userName,
      createdAt: wizardTarget?.createdAt || now,
      updatedAt: now
    };

    try {
      const savedDataset = await saveDataset(datasetBase, wizardTarget ? { expectedVersion: wizardTarget.version || 1 } : {});
      setDatasets(current => {
        const exists = current.some(dataset => dataset.id === savedDataset.id);
        return exists
          ? current.map(dataset => dataset.id === savedDataset.id ? savedDataset : dataset)
          : [savedDataset, ...current];
      });
      setSelectedDatasetId(datasetBase.id);
      setSelectedRowIndex(0);
      closeWizard();
    } catch (error: any) {
      console.error('Error saving dataset:', error);
      setWizardError(`保存评测集失败：${error.message || error}`);
    }
  };

  const buildDatasetWithEditedItems = (dataset: EvalDataset, nextItems: Record<string, any>[], changeSummary: string): EvalDataset => {
    const now = Date.now();
    const userName = auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown';
    const mappings = getDatasetColumnMappings(dataset);
    const inputSchema = dataset.inputSchema || [];
    const nextInputType = inferInputTypeFromDataset({ ...dataset, items: nextItems, inputSchema, columnMappings: mappings } as EvalDataset);
    const nextModality = inferDatasetModality(nextItems, mappings, dataset.modality || 'other', inputSchema);
    const versionMeta = appendDatasetVersion(
      dataset,
      userName,
      changeSummary,
      dataset.items?.length || 0,
      nextItems.length
    );

    return {
      ...dataset,
      items: nextItems,
      inputSchema,
      inputType: nextInputType,
      modality: nextModality,
      columnMappings: mappings,
      datasetCard: buildDatasetCard(
        {
          ...dataset,
          items: nextItems,
          inputSchema,
          columnMappings: mappings,
          modality: nextModality,
        } as EvalDataset,
        mappings,
        {
          applicableTasks: dataset.datasetCard?.applicableTasks || [],
          applicableStages: dataset.datasetCard?.applicableStages || [],
          source: dataset.datasetCard?.source || '',
          rubricBinding: dataset.datasetCard?.rubricBinding || '',
          coverageGaps: dataset.datasetCard?.coverageGaps || [],
          latestChange: changeSummary,
          modality: nextModality,
        }
      ),
      validationSummary: validateDatasetItems(nextItems, mappings),
      ...versionMeta,
      updatedAt: now,
    };
  };

  const confirmDeleteRow = async () => {
    if (!selectedDataset || rowToDelete === null || isDeletingRow || isViewingHistoricalVersion) return;
    const row = selectedDataset.items[rowToDelete];
    if (!row) {
      setRowToDelete(null);
      return;
    }
    const caseLabel = getDatasetDisplayValue(row, idKeys) || `第 ${rowToDelete + 1} 行`;
    const nextItems = selectedDataset.items.filter((_, index) => index !== rowToDelete);
    const nextDataset = buildDatasetWithEditedItems(selectedDataset, nextItems, `删除 case：${caseLabel}`);

    try {
      setIsDeletingRow(true);
      const savedDataset = await saveDataset(nextDataset, { expectedVersion: selectedDataset.version || 1 });
      setDatasets(prev => prev.map(dataset => dataset.id === savedDataset.id ? savedDataset : dataset));
      setSelectedDatasetId(savedDataset.id);
      setSelectedRowIndex(Math.max(0, Math.min(rowToDelete, nextItems.length - 1)));
      setRowToDelete(null);
    } catch (error: any) {
      console.error('Error deleting dataset row:', error);
      alert(`删除行失败：${error.message || error}`);
    } finally {
      setIsDeletingRow(false);
    }
  };

  const handleViewVersion = async (version: number) => {
    if (!selectedDataset) return;
    if (version === selectedDataset.version) {
      setViewingVersionDataset(null);
      setVersionError('');
      setSelectedRowIndex(0);
      return;
    }
    try {
      setVersionLoading(version);
      setVersionError('');
      const dataset = await loadDatasetVersion(selectedDataset.id, version);
      setViewingVersionDataset(normalizeDatasetForDisplay(dataset));
      setSelectedRowIndex(0);
    } catch (error: any) {
      console.error('Error loading dataset version:', error);
      setVersionError(`读取 v${version} 失败：${error.message || error}`);
    } finally {
      setVersionLoading(null);
    }
  };

  const confirmRollbackVersion = async () => {
    if (!selectedDataset || versionToRollback === null || isRollingBackVersion) return;
    try {
      setIsRollingBackVersion(true);
      setVersionError('');
      const savedDataset = await rollbackDataset(
        selectedDataset.id,
        versionToRollback,
        `从 v${versionToRollback} 回退生成新版本`,
        selectedDataset.version || 1
      );
      setDatasets(prev => prev.map(dataset => dataset.id === savedDataset.id ? savedDataset : dataset));
      setSelectedDatasetId(savedDataset.id);
      setViewingVersionDataset(null);
      setSelectedRowIndex(0);
      setVersionToRollback(null);
      if (savedDataset.syncSummary) {
        setSyncNotice(`回退已生成 v${savedDataset.version}；同步 ${savedDataset.syncSummary.tasks} 个任务、${savedDataset.syncSummary.votesUpdated} 条结果记录。`);
      }
    } catch (error: any) {
      console.error('Error rolling back dataset version:', error);
      setVersionError(`回退失败：${error.message || error}`);
    } finally {
      setIsRollingBackVersion(false);
    }
  };

  const confirmDeleteDataset = async () => {
    if (!datasetToDelete) return;
    try {
      await deleteDataset(datasetToDelete);
      setDatasetToDelete(null);
      if (selectedDatasetId === datasetToDelete) {
        setSelectedDatasetId('');
      }
    } catch (error: any) {
      console.error('Error deleting dataset:', error);
      alert('删除失败: ' + error.message);
      setDatasetToDelete(null);
    }
  };

  const renderEditableHeader = (column: string, className = 'px-4 py-3') => {
    const isEditing = inlineRenameColumn === column;
    return (
      <th key={column} className={className}>
        {isEditing ? (
          <div className="min-w-[180px] space-y-1">
            <input
              value={inlineRenameValue}
              onChange={event => setInlineRenameValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') commitInlineColumnRename();
                if (event.key === 'Escape') cancelInlineColumnRename();
              }}
              onBlur={() => {
                if (!isSavingInlineRename) commitInlineColumnRename();
              }}
              disabled={isSavingInlineRename}
              autoFocus
              className="w-full rounded-md border border-amber-400/40 bg-black/40 px-2 py-1 text-xs normal-case tracking-normal text-slate-100 outline-none"
            />
            {inlineRenameError && <div className="text-[11px] normal-case tracking-normal text-red-300">{inlineRenameError}</div>}
          </div>
        ) : (
          <button
            type="button"
            onDoubleClick={() => openInlineColumnRename(column)}
            disabled={isViewingHistoricalVersion}
            title={isViewingHistoricalVersion ? '历史版本为只读' : '双击修改列名'}
            className="group flex max-w-[260px] items-center gap-1 text-left uppercase tracking-wide text-slate-400 disabled:cursor-not-allowed"
          >
            <span className="truncate">{column}</span>
            {!isViewingHistoricalVersion && <Pencil size={12} className="opacity-0 transition-opacity group-hover:opacity-70" />}
          </button>
        )}
      </th>
    );
  };

  const renderWizard = () => {
    if (!wizardOpen) return null;
    const headers = parsedHeaders.length ? parsedHeaders : wizardTarget?.inputSchema?.map(field => field.key) || DEFAULT_TEMPLATE_HEADERS;
    const previewRows = parsedRows.slice(0, 5);
    const activeMappings = deriveMappingsFromSchemaFields(schemaFields);
    const normalizedPreviewRows = normalizeDatasetRows(parsedRows, activeMappings, schemaFields);
    const validation = validateDatasetItems(normalizedPreviewRows, activeMappings);
    const standardGroups = STANDARD_DATASET_FIELDS.reduce<Record<string, typeof STANDARD_DATASET_FIELDS>>((groups, field) => {
      const group = field.group || '其他';
      groups[group] = [...(groups[group] || []), field];
      return groups;
    }, {});
    const outputFields = schemaFields.filter(field => field.role === 'output');
    const customFields = schemaFields.filter(field => !field.canonicalKey && field.role !== 'output');
    const sourceUsage = schemaFields.reduce<Record<string, number>>((usage, field) => {
      if (field.sourceKey) usage[field.sourceKey] = (usage[field.sourceKey] || 0) + 1;
      return usage;
    }, {});

    return (
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-100">{wizardMode === 'append' ? '向评测集追加内容' : '新建结构化评测集'}</h2>
              <p className="text-xs text-slate-400 mt-1">基础信息 {'->'} 上传/粘贴 {'->'} 字段映射与校验</p>
            </div>
            <button onClick={closeWizard} className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-3 border-b border-white/10 flex gap-2 shrink-0">
            {[1, 2, 3].map(step => (
              <button
                key={step}
                onClick={() => setWizardStep(step as WizardStep)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${wizardStep === step ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/5 text-slate-300 border-white/10'}`}
              >
                {step === 1 ? '1 基础信息' : step === 2 ? '2 上传/粘贴' : '3 字段映射'}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto p-6 flex-1">
            {wizardError && (
              <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {wizardError}
              </div>
            )}

            {wizardStep === 1 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">评测集名称 *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="例如：VidMuse MV 核心回归集" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">评测产物模态</label>
                  <select value={form.modality} onChange={e => setForm({ ...form, modality: e.target.value as DatasetModality })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200">
                    {DATASET_MODALITIES.map(option => <option key={option.key} value={option.key}>{option.label} - {option.description}</option>)}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">这里按被评测模型输出的产物分类，参考图/音频等输入素材不会改变分类。</p>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">描述</label>
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="用途、来源、适用范围、不可外推边界..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">标签</label>
                  <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="MV, 回归, hard case" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">分类路径</label>
                  <input value={form.categoryPath} onChange={e => setForm({ ...form, categoryPath: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="视频 / MV / 回归" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">样本来源</label>
                  <input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="飞书 Base / 真实 case / 竞品横评..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">Rubric 绑定</label>
                  <input value={form.rubricBinding} onChange={e => setForm({ ...form, rubricBinding: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="例如：MV 音画一致性 v1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">适用任务</label>
                  <input value={form.applicableTasks} onChange={e => setForm({ ...form, applicableTasks: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="模型回归, 竞品横评" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">适用阶段</label>
                  <input value={form.applicableStages} onChange={e => setForm({ ...form, applicableStages: e.target.value })} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="PRD, 灰度, 上线前" />
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-sm font-medium text-slate-200 mb-1.5">覆盖缺口</label>
                  <textarea value={form.coverageGaps} onChange={e => setForm({ ...form, coverageGaps: e.target.value })} rows={3} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="每行一个缺口，例如：缺少长音乐 / 缺少复杂人物 ID case" />
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-slate-100 mb-2 flex items-center gap-2"><Upload size={18} className="text-amber-400" /> 上传文件</h3>
                  <p className="text-sm text-slate-400 mb-4">支持 CSV、TSV、TXT；Excel/飞书复制建议使用右侧粘贴。</p>
                  <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFileUpload} />
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 rounded-xl border-2 border-dashed border-white/20 text-slate-300 hover:text-white hover:border-amber-400/50 hover:bg-white/5 transition-colors">
                    选择文件并解析
                  </button>
                  <button onClick={() => downloadCsv('eval_dataset_template.csv', DEFAULT_TEMPLATE_HEADERS)} className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 glass-panel-hover text-slate-300 text-sm">
                    <Download size={15} /> 下载标准字段模板
                  </button>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-slate-100 mb-2 flex items-center gap-2"><ClipboardList size={18} className="text-blue-400" /> 粘贴表格</h3>
                  <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={9} className="w-full px-4 py-3 glass-input rounded-xl text-xs font-mono text-slate-200" placeholder="粘贴包含表头的 CSV/TSV/飞书表格内容..." />
                  <button onClick={() => applyParsedData(pastedText)} disabled={!pastedText.trim()} className="mt-3 w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium">
                    解析粘贴内容
                  </button>
                </div>
                <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-slate-200">当前解析结果</span>
                    <span className="text-xs text-slate-400">{parsedRows.length} 行 / {parsedHeaders.length || headers.length} 列</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-400 border-b border-white/10">
                        <tr>{(parsedHeaders.length ? parsedHeaders : headers).slice(0, 8).map(header => <th key={header} className="py-2 pr-4 whitespace-nowrap">{header}</th>)}</tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {(previewRows.length ? previewRows : [{}]).map((row, index) => (
                          <tr key={index} className="border-b border-white/5">
                            {(parsedHeaders.length ? parsedHeaders : headers).slice(0, 8).map(header => <td key={header} className="py-2 pr-4 max-w-[220px] truncate">{row[header] || (previewRows.length ? '' : '等待导入')}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
                <div className="space-y-5 min-w-0">
                  <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                      <h3 className="font-semibold text-slate-100 flex items-center gap-2"><Settings size={18} className="text-amber-400" /> 字段映射</h3>
                      <span className="text-xs text-slate-400">按标准字段选择原始列；预览类型可手动覆盖</span>
                    </div>
                    <div className="divide-y divide-white/10">
                      {Object.entries(standardGroups).map(([group, fields]) => (
                        <div key={group} className="p-4">
                          <div className="text-xs font-semibold text-slate-400 mb-3">{group}</div>
                          <div className="space-y-2">
                            {fields.map(standard => {
                              const mappedField = schemaFields.find(field => field.canonicalKey === standard.canonicalKey);
                              const sourceKey = mappedField?.sourceKey || '';
                              const previewType = mappedField ? previewTypeForField(mappedField, parsedRows) : standard.previewType || 'text';
                              return (
                                <div key={standard.canonicalKey} className="grid grid-cols-1 lg:grid-cols-[160px_110px_minmax(180px,1fr)_120px_minmax(120px,1fr)] gap-2 items-center rounded-lg bg-black/10 px-3 py-2">
                                  <div>
                                    <div className="text-sm font-medium text-slate-100">{standard.label}</div>
                                    {standard.required && <div className="text-[11px] text-amber-300">建议映射</div>}
                                  </div>
                                  <div className="text-xs text-slate-400">{roleLabel(standard.role)}</div>
                                  <select
                                    value={sourceKey}
                                    onChange={e => updateStandardSource(standard, e.target.value)}
                                    className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200 min-w-0"
                                  >
                                    <option value="">不映射</option>
                                    {headers.map(header => <option key={header} value={header}>{header}</option>)}
                                  </select>
                                  <select
                                    value={previewType}
                                    disabled={!mappedField}
                                    onChange={e => mappedField && updateField(mappedField.key, { previewType: e.target.value as DatasetPreviewType, type: inferSchemaType(e.target.value as DatasetPreviewType) })}
                                    className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200 disabled:opacity-50"
                                  >
                                    {PREVIEW_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                                  </select>
                                  <div className="text-xs text-slate-400 truncate" title={mappedField ? fieldSample(mappedField, previewRows) : ''}>
                                    {mappedField ? fieldSample(mappedField, previewRows) || '空样例' : '-'}
                                    {sourceKey && sourceUsage[sourceKey] > 1 && <span className="ml-2 text-amber-300">重复使用</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-100">模型结果列</h3>
                        <p className="text-xs text-slate-400 mt-0.5">列名会作为创建评测物料时的模型名称。</p>
                      </div>
                      <button onClick={() => addCustomField('output')} className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 text-xs border border-amber-500/20 flex items-center gap-1.5">
                        <Plus size={14} /> 添加结果列
                      </button>
                    </div>
                    <div className="p-4 space-y-2">
                      {outputFields.map(field => (
                        <div key={field.key} className="grid grid-cols-1 lg:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_120px_32px] gap-2 items-center rounded-lg bg-black/10 px-3 py-2">
                          <input
                            value={field.label}
                            onChange={e => updateField(field.key, { key: e.target.value, label: e.target.value })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                            placeholder="模型名称/结果列名"
                          />
                          <select
                            value={field.sourceKey || ''}
                            onChange={e => updateField(field.key, {
                              sourceKey: e.target.value,
                              previewType: inferPreviewType(e.target.value, parsedRows.slice(0, 5).map(row => row[e.target.value]))
                            })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                          >
                            <option value="">选择原始字段</option>
                            {headers.map(header => <option key={header} value={header}>{header}</option>)}
                          </select>
                          <select
                            value={previewTypeForField(field, parsedRows)}
                            onChange={e => updateField(field.key, { previewType: e.target.value as DatasetPreviewType, type: inferSchemaType(e.target.value as DatasetPreviewType) })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                          >
                            {PREVIEW_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                          </select>
                          <button onClick={() => removeField(field.key)} className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      {outputFields.length === 0 && <div className="text-xs text-slate-400">还没有模型结果列。请至少添加两个用于 GSB/Arena，或三个用于 Arena-rank。</div>}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-100">自定义字段</h3>
                        <p className="text-xs text-slate-400 mt-0.5">用于标准字段未覆盖的额外输入、维度、参考素材或元数据。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => addCustomField('input')} className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs border border-white/10 flex items-center gap-1.5"><Plus size={14} /> 输入列</button>
                        <button onClick={() => addCustomField('dimension')} className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs border border-white/10 flex items-center gap-1.5"><Plus size={14} /> 维度列</button>
                        <button onClick={() => addCustomField('metadata')} className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs border border-white/10 flex items-center gap-1.5"><Plus size={14} /> 自定义</button>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      {customFields.map(field => (
                        <div key={field.key} className="grid grid-cols-1 xl:grid-cols-[minmax(140px,1fr)_130px_minmax(180px,1fr)_120px_32px] gap-2 items-center rounded-lg bg-black/10 px-3 py-2">
                          <input
                            value={field.label}
                            onChange={e => updateField(field.key, { key: e.target.value, label: e.target.value })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                            placeholder="显示名"
                          />
                          <select
                            value={field.role || 'metadata'}
                            onChange={e => updateField(field.key, { role: e.target.value as DatasetFieldRole })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                          >
                            {ROLE_OPTIONS.filter(option => option.key !== 'case_id').map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                          </select>
                          <select
                            value={field.sourceKey || ''}
                            onChange={e => updateField(field.key, {
                              sourceKey: e.target.value,
                              previewType: inferPreviewType(e.target.value, parsedRows.slice(0, 5).map(row => row[e.target.value]))
                            })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                          >
                            <option value="">选择原始字段</option>
                            {headers.map(header => <option key={header} value={header}>{header}</option>)}
                          </select>
                          <select
                            value={previewTypeForField(field, parsedRows)}
                            onChange={e => updateField(field.key, { previewType: e.target.value as DatasetPreviewType, type: inferSchemaType(e.target.value as DatasetPreviewType) })}
                            className="px-2 py-1.5 glass-input rounded-lg text-xs text-slate-200"
                          >
                            {PREVIEW_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                          </select>
                          <button onClick={() => removeField(field.key)} className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      {customFields.length === 0 && <div className="text-xs text-slate-400">标准字段和模型结果列之外暂无自定义字段。</div>}
                    </div>
                  </div>
                </div>
                <aside className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <h3 className="font-semibold text-slate-100 mb-3 flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-400" /> 上传校验</h3>
                    <div className={`text-sm font-semibold mb-3 ${validation.status === 'ok' ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {validation.status === 'ok' ? '可保存' : '有警告，可保存后继续修正'}
                    </div>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div>输入列：{activeMappings.inputColumns.length}</div>
                      <div>模型结果列：{activeMappings.outputColumns.length}</div>
                      <div>评测维度列：{activeMappings.dimensionColumns.length}</div>
                      <div>参考素材列：{activeMappings.referenceColumns.length}</div>
                      <div>空输出单元格：{validation.emptyOutputCells}</div>
                    </div>
                    {validation.warnings.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {validation.warnings.map(warning => <div key={warning} className="text-xs text-amber-200">- {warning}</div>)}
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <h3 className="font-semibold text-slate-100 mb-3">维度分布</h3>
                    <div className="space-y-2 max-h-56 overflow-auto">
                      {Object.entries(validation.dimensionDistribution).length === 0 ? (
                        <div className="text-xs text-slate-400">暂无维度列</div>
                      ) : Object.entries(validation.dimensionDistribution).map(([key, values]) => (
                        <div key={key}>
                          <div className="text-xs text-slate-400 mb-1">{key}</div>
                          {Object.entries(values).map(([value, count]) => (
                            <div key={value} className="flex justify-between text-xs text-slate-200">
                              <span>{value}</span><span>{count}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center shrink-0">
            <button onClick={closeWizard} className="px-4 py-2 rounded-xl glass-panel-hover text-slate-300 text-sm">取消</button>
            <div className="flex gap-3">
              {wizardStep > 1 && <button onClick={() => setWizardStep((wizardStep - 1) as WizardStep)} className="px-4 py-2 rounded-xl bg-white/5 glass-panel-hover text-slate-300 text-sm">上一步</button>}
              {wizardStep < 3 ? (
                <button onClick={() => setWizardStep((wizardStep + 1) as WizardStep)} className="px-5 py-2 rounded-xl bg-amber-500 text-black font-medium text-sm">下一步</button>
              ) : (
                <button onClick={handleSaveWizard} className="px-5 py-2 rounded-xl bg-amber-500 text-black font-medium text-sm flex items-center gap-2">
                  <Save size={16} /> 保存评测集
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderColumnRenameModal = () => {
    if (!columnRenameOpen || !selectedDataset) return null;
    const schemaByColumn = new Map<string, DatasetSchemaField>();
    (selectedDataset.inputSchema || []).forEach(field => {
      schemaByColumn.set(field.key, field);
      if (field.sourceKey) schemaByColumn.set(field.sourceKey, field);
    });

    return (
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-4xl max-h-[88vh] overflow-hidden shadow-2xl flex flex-col">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                <Pencil size={18} className="text-amber-400" /> 编辑列名
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                修改后会同步更新数据列、字段映射、Dataset Card、版本记录，并影响后续创建评测物料时看到的列名。
              </p>
            </div>
            <button onClick={closeColumnRenameEditor} className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" aria-label="关闭编辑列名窗口">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto p-6 flex-1">
            {columnRenameError && (
              <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {columnRenameError}
              </div>
            )}
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="hidden md:grid md:grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_120px_120px] gap-3 px-4 py-3 bg-black/20 text-xs uppercase tracking-wide text-slate-400">
                <div>当前列名</div>
                <div>新列名</div>
                <div>字段角色</div>
                <div>预览类型</div>
              </div>
              <div className="divide-y divide-white/10">
                {currentColumnKeys.map(column => {
                  const field = schemaByColumn.get(column);
                  const previewLabel = PREVIEW_OPTIONS.find(option => option.key === field?.previewType)?.label || field?.previewType || '-';
                  return (
                    <div key={column} className="grid grid-cols-1 md:grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_120px_120px] gap-3 px-4 py-3 items-center bg-white/[0.03]">
                      <div>
                        <div className="md:hidden text-[11px] text-slate-500 mb-1">当前列名</div>
                        <div className="text-sm text-slate-300 break-all">{column}</div>
                      </div>
                      <div>
                        <div className="md:hidden text-[11px] text-slate-500 mb-1">新列名</div>
                        <input
                          value={columnRenameDrafts[column] ?? column}
                          onChange={e => {
                            setColumnRenameDrafts(prev => ({ ...prev, [column]: e.target.value }));
                            setColumnRenameError('');
                          }}
                          className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-100"
                          placeholder="输入新列名"
                        />
                      </div>
                      <div>
                        <div className="md:hidden text-[11px] text-slate-500 mb-1">字段角色</div>
                        <div className="text-xs text-slate-400">{roleLabel(field?.role)}</div>
                      </div>
                      <div>
                        <div className="md:hidden text-[11px] text-slate-500 mb-1">预览类型</div>
                        <div className="text-xs text-slate-400">{previewLabel}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {currentColumnKeys.length === 0 && (
              <div className="py-12 text-center text-slate-400">当前评测集还没有可重命名的列。</div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-white/10 flex flex-col gap-3 md:flex-row md:justify-between md:items-center shrink-0">
            <div className="text-xs text-slate-500">重命名不会删除原始追溯数据；CSV 下载和物料创建会使用新列名。</div>
            <div className="flex gap-3 justify-end">
              <button onClick={closeColumnRenameEditor} className="px-4 py-2 rounded-xl glass-panel-hover text-slate-300 text-sm">取消</button>
              <button
                onClick={handleSaveColumnNames}
                disabled={isSavingColumnNames || currentColumnKeys.length === 0}
                className="px-5 py-2 rounded-xl bg-amber-500 text-black font-medium text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Save size={16} /> {isSavingColumnNames ? '保存中...' : '保存列名'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-[1800px] mx-auto px-4 md:px-6 py-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="bg-white/5 glass-panel-hover text-slate-300 px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors border border-white/10">
            <ArrowRight className="rotate-180" size={16} /> 返回大盘
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3 tracking-tight">
              {isGenerationMode ? <Wand2 className="text-amber-500" size={30} /> : <Database className="text-amber-500" size={30} />}
              {isGenerationMode ? '生产工作台' : '评测集仓库'}
            </h1>
            <p className="text-slate-300 mt-1 text-sm">
              {isGenerationMode
                ? '选择评测集，批量调用生成服务，把产物写回为可预览的模型输出列，并保留 seed、参数和失败记录。'
                : '结构化管理 case、输入、模型输出、维度、参考素材与 Dataset Card。'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setGenerationModalOpen(true)} disabled={!selectedDataset || isViewingHistoricalVersion} className={`${isGenerationMode ? 'bg-gradient-accent text-black shadow-lg shadow-amber-500/20 hover:opacity-90' : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20'} flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm disabled:opacity-40`}>
            <Wand2 size={18} /> {isGenerationMode ? '开始批量生产' : '批量生产产物'}
          </button>
          <button onClick={() => selectedDataset && openWizard('append', selectedDataset)} disabled={!selectedDataset || isViewingHistoricalVersion} className="flex items-center gap-2 bg-white/5 glass-panel-hover text-slate-300 px-4 py-2.5 rounded-xl font-medium text-sm border border-white/10 disabled:opacity-40">
            <Upload size={18} /> 追加内容
          </button>
          <button onClick={openColumnRenameEditor} disabled={!selectedDataset || isViewingHistoricalVersion} className="flex items-center gap-2 bg-white/5 glass-panel-hover text-slate-300 px-4 py-2.5 rounded-xl font-medium text-sm border border-white/10 disabled:opacity-40">
            <Pencil size={18} /> 编辑列名
          </button>
          <button onClick={() => openWizard('create')} className="flex items-center gap-2 bg-gradient-accent text-black px-5 py-2.5 rounded-xl font-medium text-sm shadow-lg shadow-amber-500/20 transition-all hover:opacity-90">
            <Plus size={18} /> 新建/导入评测集
          </button>
        </div>
      </div>

      {isGenerationMode && (
        <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Generation Pipeline</div>
              <h2 className="mt-2 text-xl font-semibold text-slate-100">从评测集直接生产模型产物列</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                当前入口只服务于生产：选择左侧评测集，确认 prompt、参考图/音频、首尾帧和控制变量后启动批量生成；成功结果会立即写回为新的输出列，可继续用于评测物料构建。
              </p>
            </div>
            <div className="grid min-w-[280px] grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-slate-400">当前评测集</div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-100" title={selectedDataset?.name}>{selectedDataset?.name || '未选择'}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-slate-400">输出列</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{outputColumns.length}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-slate-400">运行批次</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{runningGenerationJobs.length}</div>
              </div>
            </div>
            <button onClick={() => setGenerationModalOpen(true)} disabled={!selectedDataset || isViewingHistoricalVersion} className="btn-primary shrink-0 disabled:opacity-40">
              <Wand2 size={18} /> 配置并启动生产
            </button>
          </div>
          {latestGenerationJob && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-300">
              <span className="text-slate-500">最近批次</span>
              <span className="font-medium text-slate-100">{latestGenerationJob.targetColumn}</span>
              <span className={`px-2 py-1 rounded-md border ${jobStatusClass(latestGenerationJob.status)}`}>{jobStatusLabel(latestGenerationJob.status)}</span>
              <span>成功 {latestGenerationJob.succeeded || 0}/{latestGenerationJob.total || 0}</span>
              {!!latestGenerationJob.failed && <span className="text-red-300">失败 {latestGenerationJob.failed}</span>}
            </div>
          )}
        </div>
      )}

      <div
        ref={repositoryLayoutRef}
        className="grid grid-cols-1 xl:grid-cols-[var(--dataset-left)_minmax(0,1fr)_var(--dataset-right)] gap-4"
        style={{
          '--dataset-left': `${layoutWidths.left}px`,
          '--dataset-right': `${layoutWidths.right}px`,
        } as React.CSSProperties}
      >
        <aside className="glass-panel rounded-2xl border border-white/10 p-4 h-fit xl:sticky xl:top-4 relative">
          <button
            type="button"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整左侧筛选栏宽度"
            aria-valuemin={220}
            aria-valuemax={440}
            aria-valuenow={Math.round(layoutWidths.left)}
            onPointerDown={event => beginPaneResize('left', event)}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft') adjustPaneWidth('left', -16);
              if (event.key === 'ArrowRight') adjustPaneWidth('left', 16);
            }}
            className={`hidden xl:flex absolute -right-3 top-6 bottom-6 z-20 w-5 cursor-col-resize items-center justify-center rounded-full border border-white/10 bg-black/60 text-slate-500 hover:text-amber-300 hover:border-amber-400/40 ${resizingPane === 'left' ? 'text-amber-300 border-amber-400/50' : ''}`}
          >
            <GripVertical size={14} />
          </button>
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2.5 glass-input rounded-xl text-sm text-slate-200" placeholder="搜索评测集/标签" />
          </div>
          <div className="space-y-2 mb-5">
            <div className="text-xs text-slate-400 px-3 pb-1">评测产物模态</div>
            <button onClick={() => setModalityFilter('all')} className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm ${modalityFilter === 'all' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-300 hover:bg-white/5'}`}>
              <span className="flex items-center gap-2"><Layers size={16} /> 全部</span><span>{normalizedDatasets.length}</span>
            </button>
            {DATASET_MODALITIES.map(option => {
              const count = normalizedDatasets.filter(dataset => dataset.modality === option.key).length;
              const Icon = option.key === 'image' ? FileText : option.key === 'video' ? Table2 : option.key === 'audio' ? Music : Layers;
              return (
                <button key={option.key} onClick={() => setModalityFilter(option.key)} className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm ${modalityFilter === option.key ? 'bg-amber-500/20 text-amber-200' : 'text-slate-300 hover:bg-white/5'}`}>
                  <span className="flex items-center gap-2"><Icon size={16} /> {option.label}</span><span>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="space-y-3 mb-5">
            <div>
              <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1"><Tag size={12} /> 标签</label>
              <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                <option value="">全部标签</option>
                {tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1"><Filter size={12} /> 评测维度</label>
              <select value={dimensionFilter} onChange={e => setDimensionFilter(e.target.value)} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                <option value="">全部维度</option>
                {dimensionOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>
          <div className="border-t border-white/10 pt-4">
            <div className="text-xs text-slate-400 mb-2">{isGenerationMode ? '可生产评测集' : '评测集'}</div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredDatasets.map(dataset => (
                <button key={dataset.id} onClick={() => { setSelectedDatasetId(dataset.id); setSelectedRowIndex(0); }} className={`w-full text-left p-3 rounded-xl border transition-colors ${selectedDataset?.id === dataset.id ? 'bg-white/10 border-amber-400/40' : 'bg-white/5 border-white/10 hover:bg-white/[0.08]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-100 text-sm line-clamp-1">{dataset.name}</span>
                    <span className="text-[10px] text-slate-400">{dataset.items.length}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 line-clamp-1">{dataset.categoryPath?.join(' / ') || '未分类'}</div>
                </button>
              ))}
              {filteredDatasets.length === 0 && <div className="text-sm text-slate-400 p-3">暂无匹配评测集</div>}
            </div>
          </div>
        </aside>

        <main className="glass-panel rounded-2xl border border-white/10 overflow-hidden min-w-0">
          {selectedDataset ? (
            <>
              <div className="p-5 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      className="text-xl font-bold text-slate-100"
                      onDoubleClick={() => openManifestEditor('name', '评测集名称', selectedDataset.name)}
                      title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑评测集名称'}
                    >{selectedDataset.name}</h2>
                    <span
                      className="px-2 py-1 rounded-md bg-white/10 text-xs text-slate-300"
                      onDoubleClick={() => openManifestEditor('modality', '评测产物模态', selectedDataset.modality || 'other', 'modality')}
                      title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑评测产物模态'}
                    >产物：{DATASET_MODALITIES.find(item => item.key === selectedDataset.modality)?.label || '未分类'}</span>
                    {isViewingHistoricalVersion && (
                      <span className="px-2 py-1 rounded-md bg-purple-500/15 text-xs text-purple-200 border border-purple-400/20">
                        正在查看历史 v{tableDataset?.version}
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded-md text-xs ${selectedDataset.validationSummary?.status === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {selectedDataset.validationSummary?.status === 'ok' ? '校验通过' : '有警告'}
                    </span>
                  </div>
                  <p
                    className="text-sm text-slate-400 mt-1 line-clamp-2"
                    onDoubleClick={() => openManifestEditor('description', '评测集描述', selectedDataset.description)}
                    title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑评测集描述'}
                  >{selectedDataset.description || '暂无描述'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center rounded-xl border border-white/10 bg-black/20 p-1">
                    {PREVIEW_SIZE_OPTIONS.map(option => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setPreviewSize(option.key)}
                        title={option.description}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${previewSize === option.key ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/10'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {isViewingHistoricalVersion && (
                    <button onClick={() => { setViewingVersionDataset(null); setSelectedRowIndex(0); }} className="px-3 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-200 text-sm flex items-center gap-2 border border-purple-400/20">
                      <RotateCcw size={16} /> 返回当前版本
                    </button>
                  )}
                  <button onClick={() => setGenerationModalOpen(true)} disabled={isViewingHistoricalVersion} className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-sm flex items-center gap-2 border border-amber-500/20 disabled:opacity-40">
                    <Wand2 size={16} /> 批量生产
                  </button>
                  <button onClick={() => tableDataset && downloadCsv(tableDataset.items.length ? `${selectedDataset.name}_v${tableDataset.version || selectedDataset.version || 1}_data.csv` : `template_${selectedDataset.id}.csv`, tableDataset.items.length ? tableDataset.items : tableDataset.inputSchema.map(field => field.key))} className="px-3 py-2 rounded-xl bg-white/5 glass-panel-hover text-slate-300 text-sm flex items-center gap-2 border border-white/10">
                    <Download size={16} /> {tableDataset?.items.length ? '下载数据' : '下载模板'}
                  </button>
                  <button onClick={openColumnRenameEditor} disabled={isViewingHistoricalVersion} className="px-3 py-2 rounded-xl bg-white/5 glass-panel-hover text-slate-300 text-sm flex items-center gap-2 border border-white/10 disabled:opacity-40">
                    <Pencil size={16} /> 编辑列名
                  </button>
                  <button onClick={() => openWizard('append', selectedDataset)} disabled={isViewingHistoricalVersion} className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-sm flex items-center gap-2 border border-amber-500/20 disabled:opacity-40">
                    <Upload size={16} /> 追加
                  </button>
                  <button onClick={() => setDatasetToDelete(selectedDataset.id)} disabled={isViewingHistoricalVersion} className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm flex items-center gap-2 border border-red-500/20 disabled:opacity-40">
                    <Trash2 size={16} /> 删除
                  </button>
                </div>
              </div>
              {isViewingHistoricalVersion && (
                <div className="border-b border-purple-400/20 bg-purple-500/10 px-5 py-3 text-sm text-purple-100">
                  当前表格是 v{tableDataset?.version} 的只读快照。若要恢复，请在右侧版本记录点击“回退”，系统会复制该快照生成新的当前版本。
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-black/20 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-3 sticky left-0 bg-black/40 z-10">用例ID</th>
                      <th className="px-4 py-3 min-w-[260px]">Prompt</th>
                      <th className="px-4 py-3 min-w-[180px]">评测维度</th>
                      {outputColumns.map(column => renderEditableHeader(column, `${previewSize === 'large' ? 'min-w-[440px]' : previewSize === 'medium' ? 'min-w-[280px]' : 'min-w-[180px]'} px-4 py-3`))}
                      {referenceColumns.slice(0, 2).map(column => renderEditableHeader(column, `${previewSize === 'large' ? 'min-w-[440px]' : previewSize === 'medium' ? 'min-w-[280px]' : 'min-w-[180px]'} px-4 py-3`))}
                      <th className="px-4 py-3">标签</th>
                      <th className="px-4 py-3">校验</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {selectedRows.map((row, index) => {
                      const dimensions = selectedMappings.dimensionColumns.map(column => [column, row[column]]).filter(([, value]) => String(value || '').trim());
                      const rowSelected = index === selectedRowIndex;
                      return (
                        <tr key={`${getDatasetDisplayValue(row, idKeys) || index}-${index}`} onClick={() => setSelectedRowIndex(index)} className={`cursor-pointer ${rowSelected ? 'bg-amber-500/10' : 'hover:bg-white/[0.04]'}`}>
                          <td
                            className="px-4 py-3 sticky left-0 bg-slate-950/95 z-10 text-sm font-mono text-slate-200"
                            onDoubleClick={() => openCaseEditor(index, idKeys.find(key => row[key] !== undefined) || '用例ID')}
                            title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑用例 ID'}
                          >{getDatasetDisplayValue(row, idKeys) || `case-${index + 1}`}</td>
                          <td
                            className="px-4 py-3 text-sm text-slate-200"
                            onDoubleClick={() => openCaseEditor(index, promptKeys.find(key => row[key] !== undefined) || '完整Prompt')}
                            title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑 Prompt'}
                          >
                            <div className="line-clamp-4 whitespace-pre-wrap max-w-[360px]">{getDatasetDisplayValue(row, promptKeys) || '无 Prompt'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {dimensions.length ? dimensions.map(([key, value]) => (
                                <span
                                  key={`${key}-${value}`}
                                  onDoubleClick={event => { event.stopPropagation(); openCaseEditor(index, String(key)); }}
                                  title={isViewingHistoricalVersion ? '历史版本只读' : `双击编辑 ${key}`}
                                  className="text-[11px] bg-blue-500/10 text-blue-200 border border-blue-500/20 px-2 py-1 rounded-md"
                                >{key}: {String(value)}</span>
                              )) : <span className="text-xs text-slate-500">无</span>}
                            </div>
                          </td>
                          {outputColumns.map(column => (
                            <td
                              key={column}
                              className="px-4 py-3 align-top"
                              onDoubleClick={() => openCaseEditor(index, column)}
                              title={isViewingHistoricalVersion ? '历史版本只读' : `双击编辑 ${column}`}
                            >
                              <MediaCell value={row[column]} previewType={tableDataset?.inputSchema.find(field => field.key === column)?.previewType} previewSize={previewSize} />
                            </td>
                          ))}
                          {referenceColumns.slice(0, 2).map(column => (
                            <td
                              key={column}
                              className="px-4 py-3 align-top"
                              onDoubleClick={() => openCaseEditor(index, column)}
                              title={isViewingHistoricalVersion ? '历史版本只读' : `双击编辑 ${column}`}
                            >
                              <MediaCell value={row[column]} previewType={tableDataset?.inputSchema.find(field => field.key === column)?.previewType} previewSize={previewSize} />
                            </td>
                          ))}
                          <td
                            className="px-4 py-3 text-xs text-slate-300"
                            onDoubleClick={() => openCaseEditor(index, tagKeys.find(key => row[key] !== undefined) || '标签')}
                            title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑标签'}
                          >{getDatasetDisplayValue(row, tagKeys) || '-'}</td>
                          <td className="px-4 py-3">
                            <CheckCircle2 size={16} className="text-emerald-400" />
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                setRowToDelete(index);
                              }}
                              disabled={isViewingHistoricalVersion}
                              title={isViewingHistoricalVersion ? '历史版本为只读' : '删除这一行'}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-400/20 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 size={13} /> 删除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {selectedRows.length === 0 && (
                  <div className="py-16 text-center text-slate-400">
                    这个评测集还没有 case。点击“追加内容”上传或粘贴表格。
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="py-24 text-center text-slate-400">
              <Database size={40} className="mx-auto mb-4 text-slate-500" />
              暂无评测集。点击右上角“新建/导入评测集”开始。
            </div>
          )}
        </main>

        <aside className="glass-panel rounded-2xl border border-white/10 p-5 h-fit xl:sticky xl:top-4 min-w-0 relative">
          <button
            type="button"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整右侧详情栏宽度"
            aria-valuemin={320}
            aria-valuemax={680}
            aria-valuenow={Math.round(layoutWidths.right)}
            onPointerDown={event => beginPaneResize('right', event)}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft') adjustPaneWidth('right', 16);
              if (event.key === 'ArrowRight') adjustPaneWidth('right', -16);
            }}
            className={`hidden xl:flex absolute -left-3 top-6 bottom-6 z-20 w-5 cursor-col-resize items-center justify-center rounded-full border border-white/10 bg-black/60 text-slate-500 hover:text-amber-300 hover:border-amber-400/40 ${resizingPane === 'right' ? 'text-amber-300 border-amber-400/50' : ''}`}
          >
            <GripVertical size={14} />
          </button>
          {selectedDataset ? (
            <div className="space-y-6">
              <section>
                <h3 className="font-semibold text-slate-100 mb-3 flex items-center gap-2"><Info size={18} className="text-amber-400" /> Dataset Card</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-xs text-slate-400">样本规模</div>
                    <div className="text-lg font-bold text-slate-100">{tableDataset?.datasetCard?.sampleSize || tableDataset?.items.length || 0}</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-xs text-slate-400">版本</div>
                    <div className="text-lg font-bold text-slate-100">v{tableDataset?.version || 1}</div>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div onDoubleClick={() => openManifestEditor('datasetCard.source', '样本来源', tableDataset?.datasetCard?.source || '')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑'}><dt className="text-slate-400">来源</dt><dd className="text-slate-200 break-words">{tableDataset?.datasetCard?.source || '-'}</dd></div>
                  <div onDoubleClick={() => openManifestEditor('datasetCard.rubricBinding', 'Rubric 绑定', tableDataset?.datasetCard?.rubricBinding || '')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑'}><dt className="text-slate-400">Rubric</dt><dd className="text-slate-200 break-words">{tableDataset?.datasetCard?.rubricBinding || '-'}</dd></div>
                  <div onDoubleClick={() => openManifestEditor('categoryPath', '分类路径', tableDataset?.categoryPath || [], 'list')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑'}><dt className="text-slate-400">分类路径</dt><dd className="text-slate-200 break-words">{tableDataset?.categoryPath?.join(' / ') || '-'}</dd></div>
                  <div onDoubleClick={() => openManifestEditor('datasetCard.applicableTasks', '适用任务', tableDataset?.datasetCard?.applicableTasks || [], 'list')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑'}><dt className="text-slate-400">适用任务</dt><dd className="text-slate-200 break-words">{tableDataset?.datasetCard?.applicableTasks?.join('、') || '-'}</dd></div>
                  <div onDoubleClick={() => openManifestEditor('datasetCard.applicableStages', '适用阶段', tableDataset?.datasetCard?.applicableStages || [], 'list')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑'}><dt className="text-slate-400">适用阶段</dt><dd className="text-slate-200 break-words">{tableDataset?.datasetCard?.applicableStages?.join('、') || '-'}</dd></div>
                  <div onDoubleClick={() => openManifestEditor('datasetCard.coverageGaps', '覆盖缺口', tableDataset?.datasetCard?.coverageGaps || [], 'list')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑'}><dt className="text-slate-400">覆盖缺口</dt><dd className="text-slate-200 break-words">{tableDataset?.datasetCard?.coverageGaps?.join('、') || '-'}</dd></div>
                  <div><dt className="text-slate-400">最近变更</dt><dd className="text-slate-200">{tableDataset?.datasetCard?.latestChange || '-'}</dd></div>
                  <div><dt className="text-slate-400">更新时间</dt><dd className="text-slate-200">{formatDate(tableDataset?.updatedAt)}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="flex flex-wrap gap-2" onDoubleClick={() => openManifestEditor('tags', '评测集标签', tableDataset?.tags || [], 'list')} title={isViewingHistoricalVersion ? '历史版本只读' : '双击编辑标签'}>
                    {tableDataset?.tags?.map(tag => <span key={tag} className="text-xs bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-1 rounded-md">{tag}</span>)}
                    {!tableDataset?.tags?.length && <span className="text-xs text-slate-500">双击添加标签</span>}
                  </div>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-slate-100 mb-3 flex items-center gap-2"><Settings size={18} className="text-blue-400" /> 默认字段映射</h3>
                <div className="space-y-2 text-xs text-slate-300">
                  <div>输入列：{selectedMappings.inputColumns.join(', ') || '-'}</div>
                  <div>模型结果列：{selectedMappings.outputColumns.join(', ') || '-'}</div>
                  <div>评测维度列：{selectedMappings.dimensionColumns.join(', ') || '-'}</div>
                  <div>参考素材列：{selectedMappings.referenceColumns.join(', ') || '-'}</div>
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-slate-100 mb-3 flex items-center gap-2"><Wand2 size={18} className="text-amber-400" /> 生产历史</h3>
                <div className="space-y-2 max-h-56 overflow-auto pr-1">
                  {generationJobs.slice(0, 8).map(job => (
                    <div key={job.id} className="bg-white/5 rounded-xl p-3 text-xs border border-white/10">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-slate-100 font-semibold truncate" title={job.targetColumn}>{job.targetColumn}</div>
                          <div className="text-slate-400 mt-1 truncate" title={job.modelConfig?.displayName}>{job.modelConfig?.displayName || '-'}</div>
                        </div>
                        <span className={`shrink-0 px-2 py-1 rounded-md border ${jobStatusClass(job.status)}`}>{jobStatusLabel(job.status)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-slate-300">
                        <div>总计 {job.total || 0}</div>
                        <div className="text-emerald-300">成功 {job.succeeded || 0}</div>
                        <div className="text-red-300">失败 {job.failed || 0}</div>
                      </div>
                      <div className="mt-1 text-slate-500">{formatDate(job.createdAt)}</div>
                    </div>
                  ))}
                  {generationJobs.length === 0 && <div className="text-xs text-slate-400">暂无生产记录。点击“批量生产”后会在这里保留批次、参数和结果列。</div>}
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-slate-100 mb-3 flex items-center gap-2"><History size={18} className="text-purple-400" /> 版本记录</h3>
                {versionError && (
                  <div className="mb-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {versionError}
                  </div>
                )}
                {syncNotice && (
                  <div className="mb-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {syncNotice}
                  </div>
                )}
                <div className="space-y-2 max-h-64 overflow-auto">
                  {(selectedDataset.versionHistory || []).slice().reverse().map(entry => (
                    <div key={`${entry.version}-${entry.changedAt}`} className="bg-white/5 rounded-xl p-3 text-xs">
                      <div className="flex justify-between text-slate-200"><span>v{entry.version}</span><span>{entry.itemCountBefore} {'->'} {entry.itemCountAfter}</span></div>
                      <div className="text-slate-400 mt-1">{entry.changeSummary}</div>
                      {entry.syncSummary && (
                        <div className="mt-2 text-[11px] text-slate-400">
                          同步 {entry.syncSummary.tasks} 个任务 / 更新 {entry.syncSummary.taskItemsUpdated} 个 case / {entry.syncSummary.votesUpdated} 条结果
                          {entry.syncSummary.taskItemsArchived > 0 ? ` / 归档 ${entry.syncSummary.taskItemsArchived} 个 case` : ''}
                        </div>
                      )}
                      <div className="text-slate-500 mt-1">{formatDate(entry.changedAt)}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleViewVersion(entry.version)}
                          disabled={versionLoading === entry.version}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-50"
                        >
                          <Eye size={12} /> {versionLoading === entry.version ? '读取中' : entry.version === selectedDataset.version && !isViewingHistoricalVersion ? '当前' : '查看'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVersionToRollback(entry.version)}
                          disabled={entry.version === selectedDataset.version || isRollingBackVersion}
                          className="inline-flex items-center gap-1 rounded-lg border border-purple-400/20 bg-purple-500/10 px-2 py-1 text-[11px] text-purple-100 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RotateCcw size={12} /> 回退到此版本
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!selectedDataset.versionHistory || selectedDataset.versionHistory.length === 0) && <div className="text-xs text-slate-400">旧版评测集暂无版本记录</div>}
                </div>
              </section>

              <section>
                <h3 className="font-semibold text-slate-100 mb-3 flex items-center gap-2"><FileText size={18} className="text-emerald-400" /> 当前 Case</h3>
                {selectedRow ? (
                  <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                    {Object.entries(selectedRow).filter(([key]) => key !== '_originalData' && key !== DATASET_ITEM_ID_KEY && !key.startsWith('__')).map(([key, value]) => (
                      <div
                        key={key}
                        className="bg-white/5 rounded-lg p-2 hover:bg-white/10 cursor-text"
                        onDoubleClick={() => openCaseEditor(selectedRowIndex, key)}
                        title={isViewingHistoricalVersion ? '历史版本只读' : `双击编辑 ${key}`}
                      >
                        <div className="text-[11px] text-slate-400 mb-1">{key}</div>
                        <div className="text-xs text-slate-200 break-words whitespace-pre-wrap">{value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '-')}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">未选择 case</div>
                )}
              </section>
            </div>
          ) : (
            <div className="text-sm text-slate-400">选择一个评测集后查看 Dataset Card。</div>
          )}
        </aside>
      </div>

      {renderWizard()}
      {renderColumnRenameModal()}
      {generationModalOpen && selectedDataset && !isViewingHistoricalVersion && (
        <DatasetGenerationModal
          dataset={selectedDataset}
          onClose={() => setGenerationModalOpen(false)}
        />
      )}

      {editTarget && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4"
          onMouseDown={event => { if (event.target === event.currentTarget) closeValueEditor(); }}
          onKeyDown={event => {
            if (event.key === 'Escape') closeValueEditor();
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') commitValueEdit();
          }}
        >
          <div className="w-full max-w-2xl border border-white/15 bg-slate-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-xs uppercase text-amber-300">{editTarget.scope === 'case' ? 'Case 字段编辑' : 'Dataset Card 编辑'}</div>
                <h3 className="mt-1 text-lg font-semibold text-slate-100">{editTarget.label}</h3>
                <p className="mt-1 text-xs text-slate-400">保存后立即生成一个新版本，并同步关联任务与结果。</p>
              </div>
              <button type="button" onClick={closeValueEditor} disabled={isSavingEdit} aria-label="关闭编辑器" className="p-2 text-slate-400 hover:text-white disabled:opacity-40"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              {editTarget.editor === 'boolean' ? (
                <select autoFocus value={editDraft} onChange={event => setEditDraft(event.target.value)} className="glass-input w-full px-3 py-3 text-sm">
                  <option value="true">是 / true</option>
                  <option value="false">否 / false</option>
                </select>
              ) : editTarget.editor === 'modality' ? (
                <select autoFocus value={editDraft} onChange={event => setEditDraft(event.target.value)} className="glass-input w-full px-3 py-3 text-sm">
                  {DATASET_MODALITIES.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              ) : editTarget.editor === 'json' || editTarget.editor === 'list' || (editTarget.editor === 'text' && editDraft.length > 100) ? (
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={event => setEditDraft(event.target.value)}
                  rows={editTarget.editor === 'json' ? 14 : 8}
                  className="glass-input w-full resize-y px-3 py-3 font-mono text-sm"
                  placeholder={editTarget.editor === 'list' ? '每行一个值，也可以使用逗号分隔' : undefined}
                />
              ) : (
                <input
                  autoFocus
                  type={editTarget.editor === 'number' ? 'number' : 'text'}
                  value={editDraft}
                  onChange={event => setEditDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') commitValueEdit();
                  }}
                  className="glass-input w-full px-3 py-3 text-sm"
                />
              )}

              {editTarget.previewType && ['image', 'video', 'audio'].includes(editTarget.previewType) && editDraft.trim() && (
                <div className="border border-white/10 bg-black/30 p-3">
                  <div className="mb-2 text-xs text-slate-400">修改后预览</div>
                  <MediaCell value={editDraft} previewType={editTarget.previewType} previewSize="medium" />
                </div>
              )}

              {editError && <div className="border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{editError}</div>}
              <div className="text-xs text-slate-500">快捷键：Enter 保存单行字段，Ctrl/Cmd + Enter 保存多行字段，Esc 取消。</div>
            </div>
            <div className="flex justify-end gap-3 border-t border-white/10 px-5 py-4">
              <button type="button" onClick={closeValueEditor} disabled={isSavingEdit} className="btn-secondary px-4 py-2 text-sm">取消</button>
              <button type="button" onClick={commitValueEdit} disabled={isSavingEdit} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm">
                {isSavingEdit ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" /> 保存中</> : <><Save size={16} /> 保存并生成版本</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={rowToDelete !== null}
        title="删除当前行"
        message={rowToDelete !== null ? `确定要删除第 ${rowToDelete + 1} 行吗？删除后会生成新的评测集版本，可在版本记录中回退。` : ''}
        onConfirm={confirmDeleteRow}
        onCancel={() => setRowToDelete(null)}
        confirmText={isDeletingRow ? '删除中...' : '删除行'}
      />

      <ConfirmModal
        isOpen={versionToRollback !== null}
        title="回退历史版本"
        message={versionToRollback !== null ? `确定要从 v${versionToRollback} 生成新的当前版本吗？原有历史版本会完整保留。` : ''}
        onConfirm={confirmRollbackVersion}
        onCancel={() => setVersionToRollback(null)}
        confirmText={isRollingBackVersion ? '回退中...' : '生成新版本'}
      />

      <ConfirmModal
        isOpen={!!datasetToDelete}
        title="删除评测集"
        message="确定要删除这个评测集吗？此操作不可恢复，相关的评测物料可能无法正常工作。"
        onConfirm={confirmDeleteDataset}
        onCancel={() => setDatasetToDelete(null)}
        confirmText="删除"
      />
    </div>
  );
};

export default DatasetRepositoryScreen;
