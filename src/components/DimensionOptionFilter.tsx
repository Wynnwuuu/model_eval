import React from 'react';
import { toggleDimensionOption, type DimensionOptionSelection } from '../dimensionUtils';

type CatalogGroup = {
  key: string;
  options: Array<{ value: string; count: number }>;
};

const DimensionOptionFilter: React.FC<{
  catalog: CatalogGroup[];
  selected: DimensionOptionSelection;
  onChange: (next: DimensionOptionSelection) => void;
}> = ({ catalog, selected, onChange }) => {
  if (!catalog.length) return null;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-100">按维度选项筛选</h3>
        <p className="mt-1 text-xs text-slate-500">点选同一维度下的多个选项，只保留同时包含这些选项的 case，并重算排名。</p>
      </div>
      <div className="space-y-3">
        {catalog.map(group => (
          <div key={group.key}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.key}</div>
            <div className="flex flex-wrap gap-2">
              {group.options.map(option => {
                const active = selected[group.key]?.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(toggleDimensionOption(selected, group.key, option.value))}
                    className={`border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-amber-400 bg-amber-400 text-black'
                        : 'border-white/10 bg-[#12171d] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {option.value}
                    <span className={active ? 'ml-1 text-black/70' : 'ml-1 text-slate-500'}>{option.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default DimensionOptionFilter;
