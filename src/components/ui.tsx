import React from 'react';
import { ArrowUpDown, Search } from 'lucide-react';
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';

export const PageFrame: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`ark-page-frame mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 ${className}`}>
    {children}
  </div>
);

export const PageHeader: React.FC<{
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, description, actions }) => (
  <header className="ark-page-header mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0">
      {eyebrow && (
        <div className="mb-2 font-mono text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">
          {eyebrow}
        </div>
      )}
      <h1 className="ark-page-title text-2xl text-[var(--text-primary)] sm:text-3xl">{title}</h1>
      {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export const Toolbar: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`ark-toolbar mb-4 flex flex-wrap items-center justify-between gap-3 px-3 py-3 ${className}`}>
    {children}
  </div>
);

export const SectionPanel: React.FC<{
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, description, actions, children, className = '' }) => (
  <section className={`ark-section ${className}`}>
    {(title || description || actions) && (
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {title && <h2 className="text-sm font-black uppercase tracking-wide text-[var(--text-primary)]">{title}</h2>}
          {description && <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'purple';
}> = ({ label, value, hint, icon, tone = 'neutral' }) => {
  const toneClass = {
    neutral: 'text-[var(--text-secondary)]',
    blue: 'text-[var(--accent-cold)]',
    amber: 'text-[var(--accent)]',
    green: 'text-[var(--success)]',
    red: 'text-[var(--danger)]',
    purple: 'text-violet-300'
  }[tone];

  return (
    <div className="ark-stat p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-xs font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
        {icon && <div className={toneClass}>{icon}</div>}
      </div>
      <div className="mt-3 text-2xl font-black tracking-tight text-[var(--text-primary)]">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--text-secondary)]">{hint}</div>}
    </div>
  );
};

export const StatusBadge: React.FC<{
  status?: string;
  children?: React.ReactNode;
  tone?: 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'purple';
}> = ({
  status,
  children,
  tone = 'neutral'
}) => {
  const toneClass = {
    neutral: 'border-white/10 bg-white/5 text-slate-300',
    blue: 'border-blue-400/20 bg-blue-500/10 text-blue-200',
    amber: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
    green: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    red: 'border-red-400/20 bg-red-500/10 text-red-200',
    purple: 'border-purple-400/20 bg-purple-500/10 text-purple-200'
  }[tone];
  return (
    <span className={`ark-status-badge inline-flex items-center border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {children || status || '未知'}
    </span>
  );
};

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="ark-empty flex min-h-56 flex-col items-center justify-center border border-dashed border-[var(--border-subtle)] px-6 py-10 text-center">
    {icon && <div className="mb-4 text-[var(--text-muted)]">{icon}</div>}
    <h3 className="text-base font-black text-[var(--text-primary)]">{title}</h3>
    {description && <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const MediaCell: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => (
  <div className="ark-media-cell overflow-hidden border border-[var(--border-subtle)] bg-black/30">
    {label && <div className="border-b border-[var(--border-subtle)] px-2.5 py-2 font-mono text-xs font-semibold text-[var(--text-secondary)]">{label}</div>}
    <div className="h-[104px]">{children}</div>
  </div>
);

export interface DataTableShellProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  searchPlaceholder?: string;
  emptyTitle?: string;
  className?: string;
  onRowClick?: (row: TData) => void;
  isRowInteractive?: (row: TData) => boolean;
}

export function DataTableShell<TData>({
  data,
  columns,
  searchPlaceholder = '搜索...',
  emptyTitle = '暂无数据',
  className = '',
  onRowClick,
  isRowInteractive
}: DataTableShellProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState('');
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  });

  return (
    <div className={`ark-table-shell ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={globalFilter ?? ''}
            onChange={event => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="glass-input h-9 w-full pl-9 pr-3 text-sm"
          />
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {table.getFilteredRowModel().rows.length} / {data.length} 行
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="border-b border-[var(--border-subtle)] px-4 py-3 font-semibold">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1.5 text-left hover:text-[var(--text-primary)]"
                        disabled={!header.column.getCanSort()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && <ArrowUpDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? table.getRowModel().rows.map(row => {
              const rowInteractive = Boolean(onRowClick && (isRowInteractive?.(row.original) ?? true));
              return (
                <tr
                  key={row.id}
                  role={rowInteractive ? 'button' : undefined}
                  tabIndex={rowInteractive ? 0 : undefined}
                  onClick={event => {
                    if (!rowInteractive || !onRowClick) return;
                    const target = event.target as HTMLElement;
                    if (target.closest('button,a,input,select,textarea')) return;
                    onRowClick(row.original);
                  }}
                  onKeyDown={event => {
                    if (!rowInteractive || !onRowClick) return;
                    const target = event.target as HTMLElement;
                    if (target.closest('button,a,input,select,textarea')) return;
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onRowClick(row.original);
                  }}
                  className={`border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/[0.03] ${rowInteractive ? 'cursor-pointer focus:outline-none focus-visible:bg-white/[0.06]' : ''}`}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-4 py-3 align-top text-[var(--text-secondary)]">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-[var(--text-muted)]">{emptyTitle}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
