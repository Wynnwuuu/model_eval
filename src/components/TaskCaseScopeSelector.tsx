import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FilterX, XCircle } from 'lucide-react';

import {
  applyDatasetColumnFilters,
  hasDatasetColumnFilters,
  type DatasetColumnFilterMap,
} from '../datasetRowFilters';
import type { DatasetTableColumnDescriptor } from '../datasetTableColumns';
import {
  applyTaskCaseSelection,
  resolveSelectedTaskCases,
  resolveTaskCaseDisplayId,
  type TaskCaseCandidate,
} from '../taskCaseSelection';
import DatasetColumnFilterMenu from './DatasetColumnFilterMenu';

interface TaskCaseScopeSelectorProps {
  sourceKey: string;
  candidates: TaskCaseCandidate[];
  caseIdColumn?: string;
  dimensionColumns: string[];
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
}

const FALLBACK_CASE_ID_COLUMN = '__taskCaseDisplayId';

const invalidReasonLabel = (candidate: TaskCaseCandidate) => {
  if (candidate.invalidReason === 'mapping_incomplete') return '模型列待配置';
  if (candidate.invalidReason === 'generation_failed') return '生成失败';
  if (candidate.invalidReason === 'missing_media') return '媒体为空或无效';
  return '结果为空';
};

const makeFilterColumn = (
  key: string,
  label: string,
  role: DatasetTableColumnDescriptor['role'],
): DatasetTableColumnDescriptor => ({
  key,
  label,
  role,
  previewType: 'text',
  displayCategory: 'business',
  defaultVisible: true,
  lockedVisible: role === 'case_id',
});

const TaskCaseScopeSelector: React.FC<TaskCaseScopeSelectorProps> = ({
  sourceKey,
  candidates,
  caseIdColumn,
  dimensionColumns,
  selectedKeys,
  onSelectionChange,
}) => {
  const [filters, setFilters] = useState<DatasetColumnFilterMap>({});

  useEffect(() => {
    setFilters({});
  }, [sourceKey]);

  useEffect(() => {
    const allowedKeys = new Set([caseIdColumn || FALLBACK_CASE_ID_COLUMN, ...dimensionColumns].filter(Boolean));
    setFilters(previous => Object.fromEntries(
      Object.entries(previous).filter(([key]) => allowedKeys.has(key)),
    ));
  }, [caseIdColumn, dimensionColumns]);

  const filterColumns = useMemo(() => {
    const resolvedCaseIdColumn = caseIdColumn || FALLBACK_CASE_ID_COLUMN;
    const columns: DatasetTableColumnDescriptor[] = [makeFilterColumn(resolvedCaseIdColumn, '用例 ID', 'case_id')];
    dimensionColumns.forEach(column => {
      if (!columns.some(existing => existing.key === column)) {
        columns.push(makeFilterColumn(column, column, 'dimension'));
      }
    });
    return columns;
  }, [caseIdColumn, dimensionColumns]);

  const filterableCandidates = useMemo(() => candidates.map(candidate => ({
    ...candidate,
    row: caseIdColumn ? candidate.row : {
      ...candidate.row,
      [FALLBACK_CASE_ID_COLUMN]: resolveTaskCaseDisplayId(candidate),
    },
  })), [candidates, caseIdColumn]);

  const filteredCandidates = useMemo(
    () => applyDatasetColumnFilters(filterableCandidates, filters) as TaskCaseCandidate[],
    [filterableCandidates, filters],
  );
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedValid = useMemo(
    () => resolveSelectedTaskCases(candidates, selectedKeys),
    [candidates, selectedKeys],
  );
  const pendingMappingCount = candidates.filter(candidate => candidate.invalidReason === 'mapping_incomplete').length;
  const invalidCount = candidates.filter(candidate => !candidate.eligible && candidate.invalidReason !== 'mapping_incomplete').length;
  const filtersActive = hasDatasetColumnFilters(filters);

  const updateFilter = (columnKey: string, keys?: string[]) => {
    setFilters(previous => {
      const next = { ...previous };
      if (keys?.length) next[columnKey] = keys;
      else delete next[columnKey];
      return next;
    });
  };

  const applySelection = (action: 'replace' | 'add' | 'remove') => {
    onSelectionChange(applyTaskCaseSelection(selectedKeys, filteredCandidates, action));
  };

  return (
    <section className="border border-white/10 bg-black/20 p-4 space-y-4" aria-labelledby="task-case-scope-title">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 id="task-case-scope-title" className="text-sm font-bold text-slate-100">Case 范围</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            筛选只缩小当前候选视图，最终物料范围以勾选结果为准。创建后会固定这些 case，不会自动纳入评测集后续新增内容。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px border border-white/10 bg-white/10 sm:grid-cols-4 xl:min-w-[520px]">
          {[
            ['来源总数', candidates.length],
            ['筛选匹配', filteredCandidates.length],
            ['最终纳入', selectedValid.length],
            [pendingMappingCount ? '待配置' : '产物无效', pendingMappingCount || invalidCount],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#111316] px-3 py-2">
              <div className="text-[11px] text-slate-500">{label}</div>
              <div className="mt-0.5 text-lg font-semibold text-slate-100">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => applySelection('replace')}
          disabled={!filteredCandidates.some(candidate => candidate.eligible)}
          className="border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          仅选择当前筛选
        </button>
        <button
          type="button"
          onClick={() => applySelection('add')}
          disabled={!filteredCandidates.some(candidate => candidate.eligible)}
          className="border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          添加当前筛选
        </button>
        <button
          type="button"
          onClick={() => applySelection('remove')}
          disabled={!filteredCandidates.length}
          className="border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          取消当前筛选
        </button>
        {filtersActive && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="ml-auto flex items-center gap-1.5 px-2 py-2 text-xs text-slate-400 hover:text-slate-100"
          >
            <FilterX size={14} /> 清除筛选
          </button>
        )}
      </div>

      <div className="max-h-[420px] overflow-auto border border-white/10">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#17191d] text-slate-300">
            <tr>
              <th className="w-14 border-b border-white/10 px-3 py-2 text-center">选择</th>
              {filterColumns.map(column => (
                <th key={column.key} className="min-w-36 border-b border-l border-white/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate" title={column.label}>{column.label}</span>
                    <DatasetColumnFilterMenu
                      column={column}
                      rows={filterableCandidates}
                      filters={filters}
                      onChange={updateFilter}
                    />
                  </div>
                </th>
              ))}
              <th className="min-w-44 border-b border-l border-white/10 px-3 py-2">有效性</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredCandidates.map(candidate => {
              const checked = selected.has(candidate.key);
              return (
                <tr key={candidate.key} className={candidate.eligible ? 'hover:bg-white/[0.04]' : 'bg-red-950/10 text-slate-500'}>
                  <td className="px-3 py-2 text-center align-top">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!candidate.eligible}
                      aria-label={`${checked ? '取消选择' : '选择'} ${resolveTaskCaseDisplayId(candidate, caseIdColumn)}`}
                      onChange={(event) => onSelectionChange(applyTaskCaseSelection(
                        selectedKeys,
                        [candidate],
                        event.target.checked ? 'add' : 'remove',
                      ))}
                      className="rounded text-amber-400 focus:ring-amber-500 disabled:opacity-40"
                    />
                  </td>
                  {filterColumns.map(column => (
                    <td key={column.key} className="max-w-72 border-l border-white/5 px-3 py-2 align-top text-slate-300">
                      <div className="line-clamp-3 break-words whitespace-pre-wrap">
                        {column.role === 'case_id'
                          ? resolveTaskCaseDisplayId(candidate, column.key)
                          : String(candidate.row[column.key] ?? '')}
                      </div>
                    </td>
                  ))}
                  <td className="border-l border-white/5 px-3 py-2 align-top">
                    {candidate.eligible ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-300">
                        <CheckCircle2 size={13} /> 可评测
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 text-red-300">
                          <XCircle size={13} /> {invalidReasonLabel(candidate)}
                        </span>
                        {!!candidate.invalidColumns.length && (
                          <div className="break-words text-[11px] text-slate-500" title={candidate.invalidColumns.join(', ')}>
                            {candidate.invalidColumns.join('、')}
                          </div>
                        )}
                        {checked && <div className="text-[11px] text-amber-300">产物恢复后将重新纳入</div>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filteredCandidates.length && (
              <tr>
                <td colSpan={filterColumns.length + 2} className="px-4 py-10 text-center text-sm text-slate-500">
                  当前筛选没有匹配 case。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default TaskCaseScopeSelector;
