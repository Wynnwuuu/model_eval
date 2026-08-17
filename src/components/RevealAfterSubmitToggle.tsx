import React from 'react';

interface RevealAfterSubmitToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const RevealAfterSubmitToggle: React.FC<RevealAfterSubmitToggleProps> = ({ checked, onChange }) => (
  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-4 py-2 md:px-6">
    <div className="min-w-0 text-xs">
      <span className="font-semibold text-slate-100">提交后流程</span>
      <span className="ml-2 hidden text-slate-400 sm:inline">
        {checked ? '揭示实际模型并停留当前 case 复盘' : '不揭示模型，保存后直接下一题'}
      </span>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs font-semibold text-slate-100">揭示模型</span>
      <span className={checked ? 'text-xs font-semibold text-emerald-300' : 'text-xs font-semibold text-slate-400'}>
        {checked ? '开启' : '关闭'}
      </span>
      <button
        type="button"
        role="switch"
        aria-label="提交后揭示模型"
        aria-checked={checked}
        title={checked ? '提交后停留当前 case 并揭示模型' : '提交后直接进入下一题'}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
          checked
            ? 'border-emerald-300/70 bg-emerald-400/80'
            : 'border-white/20 bg-white/10 hover:bg-white/15'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`}
        />
      </button>
    </div>
  </div>
);

export default RevealAfterSubmitToggle;
