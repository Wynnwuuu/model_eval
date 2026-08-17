import React from 'react';
import { MessageSquareText } from 'lucide-react';
import { MODEL_FEEDBACK_MAX_LENGTH } from '../modelFeedback';

interface ModelFeedbackEditorProps {
  modelId: string;
  optionLabel: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}

const ModelFeedbackEditor: React.FC<ModelFeedbackEditorProps> = ({
  modelId,
  optionLabel,
  value,
  onChange,
  required = false,
  className = '',
}) => (
  <div className={`border-t border-white/10 bg-[#101419] p-3 ${className}`} data-model-feedback-id={modelId}>
    <label className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-200">
      <span className="inline-flex items-center gap-1.5">
        <MessageSquareText size={14} className="text-amber-300" />
        评价与备注
        {required ? <span className="text-amber-300">*</span> : <span className="font-normal text-slate-500">（选填）</span>}
      </span>
      <span className="font-mono text-[10px] font-normal text-slate-600">{value.length}/{MODEL_FEEDBACK_MAX_LENGTH}</span>
    </label>
    <textarea
      aria-label={`${optionLabel} 评价与备注`}
      value={value}
      maxLength={MODEL_FEEDBACK_MAX_LENGTH}
      required={required}
      onChange={event => onChange(event.target.value)}
      className="glass-input min-h-20 w-full resize-y px-3 py-2 text-sm leading-5"
      placeholder="记录具体优点、问题、失败模式或改进建议"
    />
  </div>
);

export default ModelFeedbackEditor;
