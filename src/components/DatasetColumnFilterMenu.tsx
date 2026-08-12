import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownAZ, ArrowUpAZ, Filter, Search, X } from 'lucide-react';

import {
  buildDatasetFilterValueOptions,
  partitionDatasetFilterValueOptions,
  type DatasetColumnFilterMap,
  type DatasetSortSpec,
  type IndexedDatasetRow,
} from '../datasetRowFilters';
import type { DatasetTableColumnDescriptor } from '../datasetTableColumns';

interface DatasetColumnFilterMenuProps {
  column: DatasetTableColumnDescriptor;
  rows: IndexedDatasetRow[];
  filters: DatasetColumnFilterMap;
  onChange: (columnKey: string, selectedKeys?: string[]) => void;
  sort?: DatasetSortSpec;
  onSortChange?: (sort?: DatasetSortSpec) => void;
}

interface PopoverPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface PopoverAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const resolveDatasetFilterPopoverPosition = (
  rect: PopoverAnchorRect,
  viewportWidth: number,
  viewportHeight: number,
): PopoverPosition => {
  const width = Math.min(360, Math.max(288, viewportWidth - 16));
  const left = Math.max(8, Math.min(viewportWidth - width - 8, rect.right - width));
  const spaceBelow = viewportHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openAbove = spaceBelow < 300 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(160, Math.min(460, openAbove ? spaceAbove : spaceBelow));
  const top = openAbove
    ? Math.max(8, rect.top - maxHeight - 6)
    : Math.min(viewportHeight - 8, rect.bottom + 6);
  return { left, top, maxHeight };
};

const FILTER_KIND_LABELS = {
  blank: '空白',
  string: '文本',
  number: '数字',
  boolean: '布尔',
  json: 'JSON',
} as const;

const DatasetColumnFilterMenu: React.FC<DatasetColumnFilterMenuProps> = ({
  column,
  rows,
  filters,
  onChange,
  sort,
  onSortChange,
}) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [position, setPosition] = useState<PopoverPosition>({ left: 8, top: 8, maxHeight: 420 });
  const selectedKeys = filters[column.key] || [];
  const active = selectedKeys.length > 0;
  const sortDirection = sort?.columnKey === column.key ? sort.direction : undefined;
  const options = useMemo(
    () => buildDatasetFilterValueOptions(rows, column.key, filters),
    [column.key, filters, rows],
  );
  const allColumnOptions = useMemo(
    () => buildDatasetFilterValueOptions(rows, column.key, {}),
    [column.key, rows],
  );
  const { available: availableOptions, unavailableSelected: unavailableSelectedOptions } = useMemo(
    () => partitionDatasetFilterValueOptions(options, selectedKeys),
    [options, selectedKeys],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (label: string) => !normalizedQuery
    || label.toLocaleLowerCase().includes(normalizedQuery);
  const visibleOptions = useMemo(
    () => availableOptions.filter(option => matchesQuery(option.label)),
    [availableOptions, normalizedQuery],
  );
  const visibleUnavailableSelectedOptions = useMemo(
    () => unavailableSelectedOptions.filter(option => matchesQuery(option.label)),
    [normalizedQuery, unavailableSelectedOptions],
  );
  const draftSet = useMemo(() => new Set(draftKeys), [draftKeys]);
  const allVisibleSelected = visibleOptions.length > 0 && visibleOptions.every(option => draftSet.has(option.key));
  const someVisibleSelected = visibleOptions.some(option => draftSet.has(option.key));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    setPosition(resolveDatasetFilterPopoverPosition(
      triggerRef.current.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
    ));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleViewportChange = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      if (!triggerRef.current) return;
      setPosition(resolveDatasetFilterPopoverPosition(
        triggerRef.current.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ));
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open]);

  const openMenu = () => {
    setQuery('');
    setDraftKeys(active ? selectedKeys : availableOptions.map(option => option.key));
    setOpen(true);
  };

  const toggleKey = (key: string) => {
    setDraftKeys(current => current.includes(key)
      ? current.filter(value => value !== key)
      : [...current, key]);
  };

  const toggleVisible = () => {
    const visibleKeys = new Set(visibleOptions.map(option => option.key));
    setDraftKeys(current => {
      if (allVisibleSelected) return current.filter(key => !visibleKeys.has(key));
      return [...new Set([...current, ...visibleKeys])];
    });
  };

  const apply = () => {
    if (!draftKeys.length) return;
    const selected = new Set(draftKeys);
    const nextKeys = options.filter(option => selected.has(option.key)).map(option => option.key);
    onChange(column.key, nextKeys.length === options.length ? undefined : nextKeys);
    setOpen(false);
  };

  const clearFilter = () => {
    onChange(column.key, undefined);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={event => {
          event.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
        title={`${active ? '修改' : '筛选'} ${column.label}`}
        aria-label={`${active ? '修改筛选' : '筛选'} ${column.label}`}
        aria-expanded={open}
        className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center border transition-colors ${active || sortDirection
          ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
          : 'border-transparent text-slate-500 hover:border-white/10 hover:bg-white/5 hover:text-slate-200'}`}
      >
        <Filter size={13} aria-hidden="true" />
        {active && (
          <span className="absolute -right-1.5 -top-1.5 min-w-4 border border-slate-950 bg-amber-400 px-0.5 text-center text-[9px] font-bold leading-[14px] text-black">
            {selectedKeys.length > 99 ? '99+' : selectedKeys.length}
          </span>
        )}
      </button>

      {open && createPortal(
        <section
          ref={popoverRef}
          role="dialog"
          aria-label={`${column.label} 列筛选`}
          className="fixed z-[140] flex w-[min(360px,calc(100vw-16px))] flex-col border border-white/15 bg-slate-950 shadow-2xl"
          style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
        >
          <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-100" title={column.label}>{column.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">同列多选任意匹配，与其他列同时满足</div>
              <div className="mt-1 text-[11px] text-slate-400">
                基于其他筛选，可选 {availableOptions.length} 个 / 全列 {allColumnOptions.length} 个
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="取消筛选" className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-white/10 text-slate-400 hover:text-white">
              <X size={15} />
            </button>
          </header>

          <div className="border-b border-white/10 p-3">
            {onSortChange && (
              <div className="mb-3 grid grid-cols-3 border border-white/10 p-1">
                <button type="button" onClick={() => onSortChange({ columnKey: column.key, direction: 'asc' })} className={`flex items-center justify-center gap-1 px-2 py-2 text-xs ${sortDirection === 'asc' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}><ArrowUpAZ size={14} /> 升序</button>
                <button type="button" onClick={() => onSortChange({ columnKey: column.key, direction: 'desc' })} className={`flex items-center justify-center gap-1 px-2 py-2 text-xs ${sortDirection === 'desc' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}><ArrowDownAZ size={14} /> 降序</button>
                <button type="button" onClick={() => onSortChange(undefined)} disabled={!sortDirection} className="px-2 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-100 disabled:opacity-40">清除排序</button>
              </div>
            )}
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索值"
                autoFocus
                className="w-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-amber-400/50"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 text-slate-300">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={!visibleOptions.length}
                  onChange={toggleVisible}
                  className="h-4 w-4 accent-amber-400"
                />
                <span className="truncate">全选当前搜索结果</span>
              </label>
              <button type="button" onClick={() => setDraftKeys([])} className="shrink-0 text-slate-400 hover:text-slate-100">清空选择</button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleOptions.map(option => (
              <label key={option.key} className="flex cursor-pointer items-start gap-2 px-2 py-2 text-xs hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={draftSet.has(option.key)}
                  onChange={() => toggleKey(option.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
                />
                <span className="min-w-0 flex-1 break-all text-slate-200" title={option.label}>{option.label}</span>
                <span className="shrink-0 border border-white/10 px-1 py-0.5 text-[9px] text-slate-500">
                  {FILTER_KIND_LABELS[option.kind]}
                </span>
                <span className={`shrink-0 font-mono ${option.count ? 'text-slate-400' : 'text-slate-600'}`}>{option.count}</span>
              </label>
            ))}
            {visibleUnavailableSelectedOptions.length > 0 && (
              <div className="mt-2 border-t border-amber-400/20 pt-2">
                <div className="px-2 pb-1 text-[11px] font-medium text-amber-200">
                  已选但当前无匹配 ({visibleUnavailableSelectedOptions.length})
                </div>
                <div className="px-2 pb-2 text-[10px] leading-4 text-slate-500">
                  这些条件仍在生效。取消勾选或清除此列筛选后，相关限制才会移除。
                </div>
                {visibleUnavailableSelectedOptions.map(option => (
                  <label key={option.key} className="flex cursor-pointer items-start gap-2 bg-amber-500/[0.04] px-2 py-2 text-xs hover:bg-amber-500/[0.08]">
                    <input
                      type="checkbox"
                      checked={draftSet.has(option.key)}
                      onChange={() => toggleKey(option.key)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
                    />
                    <span className="min-w-0 flex-1 break-all text-slate-300" title={option.label}>{option.label}</span>
                    <span className="shrink-0 border border-white/10 px-1 py-0.5 text-[9px] text-slate-500">
                      {FILTER_KIND_LABELS[option.kind]}
                    </span>
                    <span className="shrink-0 font-mono text-amber-300/70">0</span>
                  </label>
                ))}
              </div>
            )}
            {!visibleOptions.length && !visibleUnavailableSelectedOptions.length && (
              <div className="px-3 py-8 text-center text-xs text-slate-500">没有匹配的值</div>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 p-3">
            <button type="button" onClick={clearFilter} disabled={!active} className="px-2 py-2 text-xs text-slate-400 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40">清除此列筛选</button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">取消</button>
              <button type="button" onClick={apply} disabled={!draftKeys.length} className="bg-amber-400 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">应用</button>
            </div>
          </footer>
        </section>,
        document.body,
      )}
    </>
  );
};

export default DatasetColumnFilterMenu;
