import React from 'react';
import { getDimensionEntries } from '../dimensionUtils';

interface DimensionChipsProps {
  values?: Record<string, string>;
  className?: string;
  label?: string;
}

const DimensionChips: React.FC<DimensionChipsProps> = ({ values, className = '', label = '评测维度' }) => {
  const entries = getDimensionEntries(values);
  if (entries.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {label && <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">{label}</span>}
      {entries.map(([key, value]) => (
        <span
          key={`${key}-${value}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100"
          title={`${key}: ${value}`}
        >
          <span className="shrink-0 font-semibold text-amber-300">{key}</span>
          <span className="truncate text-slate-100">{value}</span>
        </span>
      ))}
    </div>
  );
};

export default DimensionChips;
