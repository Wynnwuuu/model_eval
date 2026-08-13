import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { EvaluationProject, Category, Priority, ProjectType } from '../types';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (project: Partial<EvaluationProject>) => Promise<EvaluationProject | void>;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [type, setType] = useState<ProjectType>('轻度评测 (快速/专项)');
  const [priority, setPriority] = useState<Priority>('P1');
  const [category, setCategory] = useState<Category>('产品上游模型能力评测');
  const [cycle, setCycle] = useState('');
  const [support, setSupport] = useState('');
  const [datasetIds, setDatasetIds] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Step owners and execution types
  const [step1Owner, setStep1Owner] = useState('');
  const [step1Type, setStep1Type] = useState<'internal' | 'external'>('external');
  const [step2Owner, setStep2Owner] = useState('');
  const [step2Type, setStep2Type] = useState<'internal' | 'external'>('internal');
  const [step3Owner, setStep3Owner] = useState('');
  const [step3Type, setStep3Type] = useState<'internal' | 'external'>('internal');

  useEffect(() => {
    if (isOpen) setSubmitError('');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        name,
        goal,
        type,
        priority,
        category,
        cycle,
        support: support.split(',').map(s => s.trim()).filter(s => s),
        progress: 0,
        steps: [
          { id: 1, name: '评测物料生产', owner: step1Owner || '待分配', status: 'in-progress', executionType: step1Type },
          { id: 2, name: '评测执行', owner: step2Owner || '待分配', status: 'pending', executionType: step2Type },
          { id: 3, name: '评测结果分析', owner: step3Owner || '待分配', status: 'pending', executionType: step3Type }
        ],
        resultSummary: '待产出',
        link: '',
        datasetIds: [],
        dimensions: [],
        generatedDataStatus: '未开始',
        analysis: '暂无',
      });
      setName('');
      setGoal('');
      setCycle('');
      setSupport('');
      setDatasetIds('');
      setStep1Owner('');
      setStep2Owner('');
      setStep3Owner('');
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error && error.message
        ? `创建失败：${error.message}`
        : '创建失败，请检查网络或权限后重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="glass-panel rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/10 shadow-2xl">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
          <h2 className="text-xl font-bold text-slate-200">创建项目</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-500 hover:text-slate-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="关闭创建项目弹窗"
          >
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <form id="create-project-form" onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">项目名称 *</label>
              <input 
                required
                type="text" 
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all placeholder:text-slate-400"
                placeholder="例如：V2.5 版本迭代主客观评测"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">项目目标 *</label>
              <textarea 
                required
                value={goal}
                onChange={e => setGoal(e.target.value)}
                className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all min-h-[100px] placeholder:text-slate-400"
                placeholder="描述本次评测的核心目的..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">评测类型</label>
                <select 
                  value={type}
                  onChange={e => setType(e.target.value as ProjectType)}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all"
                >
                  <option value="重度评测 (周期/版本)" className="bg-white/5">重度评测 (周期/版本)</option>
                  <option value="轻度评测 (快速/专项)" className="bg-white/5">轻度评测 (快速/专项)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">优先级</label>
                <select 
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all"
                >
                  <option value="P0" className="bg-white/5">P0 (最高)</option>
                  <option value="P1" className="bg-white/5">P1 (高)</option>
                  <option value="P2" className="bg-white/5">P2 (普通)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">业务分类</label>
                <select 
                  value={category}
                  onChange={e => setCategory(e.target.value as Category)}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all"
                >
                  <option value="产品上游模型能力评测" className="bg-white/5">产品上游模型能力评测</option>
                  <option value="生成效果评测-中间态" className="bg-white/5">生成效果评测-中间态</option>
                  <option value="生成效果评测-成片" className="bg-white/5">生成效果评测-成片</option>
                  <option value="工程团队专项" className="bg-white/5">工程团队专项</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">预计周期</label>
                <input 
                  type="text" 
                  value={cycle}
                  onChange={e => setCycle(e.target.value)}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all placeholder:text-slate-400"
                  placeholder="例如：2026-03-15 至 2026-03-22"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">人员支持 (逗号分隔)</label>
              <input 
                type="text" 
                value={support}
                onChange={e => setSupport(e.target.value)}
                className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all placeholder:text-slate-400"
                placeholder="例如：数据组, 算法组A, 测试组"
              />
            </div>

            <div className="pt-6 border-t border-white/10">
              <h3 className="text-sm font-bold text-slate-200 mb-4">执行进度拆解设置</h3>
              
              <div className="space-y-4">
                {/* Step 1 */}
                <div className="p-4 glass-panel rounded-xl">
                  <div className="font-medium text-slate-200 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 border border-white/10 text-slate-400 flex items-center justify-center text-xs">1</span>
                    评测物料生产
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" 
                      value={step1Owner}
                      onChange={e => setStep1Owner(e.target.value)}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none placeholder:text-slate-400"
                      placeholder="负责人 (选填)"
                    />
                    <select 
                      value={step1Type}
                      onChange={e => setStep1Type(e.target.value as 'internal' | 'external')}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none"
                    >
                      <option value="internal" className="bg-white/5">平台内执行</option>
                      <option value="external" className="bg-white/5">外部执行</option>
                    </select>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="p-4 glass-panel rounded-xl">
                  <div className="font-medium text-slate-200 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 border border-white/10 text-slate-400 flex items-center justify-center text-xs">2</span>
                    评测执行
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" 
                      value={step2Owner}
                      onChange={e => setStep2Owner(e.target.value)}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none placeholder:text-slate-400"
                      placeholder="负责人 (选填)"
                    />
                    <select 
                      value={step2Type}
                      onChange={e => setStep2Type(e.target.value as 'internal' | 'external')}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none"
                    >
                      <option value="internal" className="bg-white/5">平台内执行</option>
                      <option value="external" className="bg-white/5">外部自动化执行</option>
                    </select>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="p-4 glass-panel rounded-xl">
                  <div className="font-medium text-slate-200 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 border border-white/10 text-slate-400 flex items-center justify-center text-xs">3</span>
                    评测结果分析
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" 
                      value={step3Owner}
                      onChange={e => setStep3Owner(e.target.value)}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none placeholder:text-slate-400"
                      placeholder="负责人 (选填)"
                    />
                    <select 
                      value={step3Type}
                      onChange={e => setStep3Type(e.target.value as 'internal' | 'external')}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none"
                    >
                      <option value="internal" className="bg-white/5">平台内执行</option>
                      <option value="external" className="bg-white/5">外部执行</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 flex-1" role="status" aria-live="polite">
            {submitError && (
              <div className="flex items-start gap-2 text-sm text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2 text-slate-400 glass-panel-hover hover:text-slate-200 rounded-xl font-medium transition-colors text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              form="create-project-form"
              disabled={isSubmitting}
              className="px-5 py-2 bg-gradient-accent text-black rounded-xl font-medium shadow-lg shadow-amber-500/20 hover:opacity-90 transition-all text-sm disabled:cursor-wait disabled:opacity-60 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {isSubmitting ? '正在创建...' : '创建项目'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
