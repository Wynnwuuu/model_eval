import React, { useState, useEffect } from 'react';
import { LayoutTemplate, Plus, Settings, ArrowRight, Trash2, Edit2, FileText, CheckCircle2 } from 'lucide-react';
import { EvalTemplate, EvalDimension, EvalParadigm } from '../types';
import { auth } from '../auth';
import { ConfirmModal } from './ConfirmModal';
import { DEFAULT_SCORE_LEVELS, buildDefaultDimensionsForMethod, getEvaluationMethodShortLabel, getMethodFromParadigm, normalizeDimensions } from '../evaluationMethods';
import { deleteTemplate, saveTemplate, subscribeTemplates } from '../features/templates/api';

interface TemplateRepositoryScreenProps {
  onBack: () => void;
}

const TemplateRepositoryScreen: React.FC<TemplateRepositoryScreenProps> = ({ onBack }) => {
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);

  // New Template Form State
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newParadigm, setNewParadigm] = useState<EvalParadigm>('GSB');
  const [dimensions, setDimensions] = useState<EvalDimension[]>([
    { id: 'dim-new-1', name: '整体评价', description: '综合评估', type: 'radio_select', options: ['A 更好', 'B 更好', '平局'] }
  ]);

  useEffect(() => {
    const unsubscribe = subscribeTemplates(setTemplates, (error) => {
      console.error("Error fetching templates:", error);
    });

    return () => unsubscribe();
  }, []);

  const handleAddDimension = () => {
    setDimensions([
      ...dimensions, 
      {
        id: `dim-new-${Date.now()}`,
        name: '新维度',
        description: '',
        type: 'star_rating',
        weight: 1,
        required: true,
        scope: 'secondary',
        aggregationRole: 'score',
        scale: DEFAULT_SCORE_LEVELS
      }
    ]);
  };

  const handleUpdateDimension = (index: number, updates: Partial<EvalDimension>) => {
    const newDims = [...dimensions];
    newDims[index] = { ...newDims[index], ...updates };
    setDimensions(normalizeDimensions(newDims, getMethodFromParadigm(newParadigm)));
  };

  const handleRemoveDimension = (index: number) => {
    setDimensions(dimensions.filter((_, i) => i !== index));
  };

  const confirmDeleteTemplate = async () => {
    if (!templateToDelete) return;
    try {
      await deleteTemplate(templateToDelete);
      setTemplateToDelete(null);
    } catch (error: any) {
      console.error("Error deleting template:", error);
      alert("删除失败: " + error.message);
      setTemplateToDelete(null);
    }
  };

  const handleEditTemplate = (template: EvalTemplate) => {
    setEditingTemplateId(template.id);
    setNewName(template.name);
    setNewDesc(template.description);
    setNewParadigm(template.paradigm);
    setDimensions(template.dimensions);
    setIsCreating(true);
  };

  const handleSaveTemplate = async () => {
    if (!newName.trim()) return;

    const templateId = editingTemplateId || `tpl-${Date.now()}`;
    const templateData: EvalTemplate = {
      id: templateId,
      name: newName,
      description: newDesc,
      paradigm: newParadigm,
      dimensions: normalizeDimensions(dimensions, getMethodFromParadigm(newParadigm)),
      creatorUid: auth.currentUser.uid,
      creatorName: auth.currentUser.displayName || auth.currentUser.email || 'Unknown',
      createdAt: editingTemplateId ? (templates.find(t => t.id === editingTemplateId)?.createdAt || Date.now()) : Date.now()
    };

    try {
      await saveTemplate(templateData);
      setIsCreating(false);
      setEditingTemplateId(null);
      
      // Reset form
      setNewName('');
      setNewDesc('');
      setNewParadigm('GSB');
      setDimensions([
        { id: `dim-new-${Date.now()}`, name: '整体评价', description: '综合评估', type: 'radio_select', options: ['A 更好', 'B 更好', '平局'], scope: 'primary', aggregationRole: 'preference', required: true }
      ]);
    } catch (error) {
      console.error("Error saving template:", error);
      alert("保存 Rubric 失败，请重试。");
    }
  };

  if (isCreating) {
    return (
      <div className="max-w-4xl mx-auto p-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => { setIsCreating(false); setEditingTemplateId(null); }} className="text-slate-300 hover:text-slate-200 transition-colors">
            &larr; 返回列表
          </button>
          <h1 className="text-2xl font-bold text-slate-200">{editingTemplateId ? '编辑 Rubric' : '创建新 Rubric'}</h1>
        </div>

        <div className="glass-panel rounded-2xl border border-white/10 p-8 space-y-8 shadow-2xl">
          {/* Basic Info */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <FileText size={20} className="text-amber-500" /> 基本信息
            </h2>
            <div className="grid gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Rubric 名称 *</label>
                <input 
                  type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all placeholder:text-slate-400"
                  placeholder="例如：视频生成多维度 Rubric 评分"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">描述</label>
                <textarea 
                  value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={3}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all placeholder:text-slate-400"
                  placeholder="描述这个 Rubric 的适用产物模态、评测目标、通过/失败边界和不可判断规则..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">适用评测方式</label>
                <select 
                  value={newParadigm}
                  onChange={e => {
                    const next = e.target.value as EvalParadigm;
                    setNewParadigm(next);
                    const method = getMethodFromParadigm(next);
                    if (method === 'direct_score' || method === 'rubric_score') {
                      setDimensions(buildDefaultDimensionsForMethod(method));
                    } else if (method === 'pairwise' || method === 'ab_preference') {
                      setDimensions([{ id: `dim-${Date.now()}`, name: '整体偏好', description: '按当前 Rubric 判断哪一侧更好。', type: 'radio_select', options: ['A 更好', 'B 更好', '平局'], scope: 'primary', aggregationRole: 'preference', required: true }]);
                    } else {
                      setDimensions([]);
                    }
                  }}
                  className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all"
                >
                  <option value="GSB" className="bg-black/40">A/B 偏好 - 双模型对比</option>
                  <option value="Pairwise" className="bg-black/40">Pairwise 对战 - 多模型两两比较</option>
                  <option value="MOS" className="bg-black/40">直接评分 / MOS - 1-5 分</option>
                  <option value="RubricScore" className="bg-black/40">Rubric 多维评分</option>
                  <option value="Arena-rank" className="bg-black/40">全量排序 / Arena-rank</option>
                </select>
              </div>
            </div>
          </div>

          <hr className="border-white/10" />

          {/* Dimensions Builder */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <Settings size={20} className="text-amber-500" /> 定义评测维度 (Dimensions)
              </h2>
              <button 
                onClick={handleAddDimension}
                className="text-sm flex items-center gap-1 text-amber-500 hover:text-amber-400 font-medium bg-amber-500/10 px-3 py-1.5 rounded-lg transition-colors border border-amber-500/20"
              >
                <Plus size={16} /> 添加维度
              </button>
            </div>
            <p className="text-sm text-slate-300">
              定义评测人员需要对哪些方面进行打分或选择。
            </p>

            <div className="space-y-4 mt-4">
              {dimensions.map((dim, idx) => (
                <div key={dim.id} className="bg-white/5 p-4 rounded-xl border border-white/10 relative group">
                  <button 
                    onClick={() => handleRemoveDimension(idx)}
                    className="absolute top-4 right-4 text-slate-300 hover:text-red-400 hover:bg-red-400/10 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 pr-10">
                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">维度名称</label>
                      <input 
                        type="text" value={dim.name} onChange={e => handleUpdateDimension(idx, { name: e.target.value })}
                        className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none placeholder:text-slate-400"
                        placeholder="e.g., 文本一致性"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">打分控件类型</label>
                      <select 
                        value={dim.type} onChange={e => handleUpdateDimension(idx, {
                          type: e.target.value as 'star_rating' | 'radio_select' | 'text_input',
                          aggregationRole: e.target.value === 'text_input' ? 'rationale' : e.target.value === 'star_rating' ? 'score' : 'preference',
                          scale: e.target.value === 'star_rating' ? DEFAULT_SCORE_LEVELS : undefined
                        })}
                        className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none"
                      >
                        <option value="star_rating" className="bg-black/40">星级打分 (1-5)</option>
                        <option value="radio_select" className="bg-black/40">单选按钮 (Radio)</option>
                        <option value="text_input" className="bg-black/40">文本输入 (主观评价)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">用途</label>
                      <select
                        value={dim.scope || 'secondary'}
                        onChange={e => handleUpdateDimension(idx, { scope: e.target.value as EvalDimension['scope'] })}
                        className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none"
                      >
                        <option value="primary" className="bg-black/40">主判断项</option>
                        <option value="secondary" className="bg-black/40">附加评分项</option>
                        <option value="rationale" className="bg-black/40">理由记录项</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">权重</label>
                      <input
                        type="number"
                        min="0"
                        step="0.05"
                        value={dim.weight ?? 1}
                        onChange={e => handleUpdateDimension(idx, { weight: Number(e.target.value) })}
                        disabled={dim.type !== 'star_rating'}
                        className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-xs text-slate-300 mb-1.5">维度描述 (提示给评测人员)</label>
                    <input 
                      type="text" value={dim.description} onChange={e => handleUpdateDimension(idx, { description: e.target.value })}
                      className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none placeholder:text-slate-400"
                      placeholder="e.g., 评估生成的图像是否准确反映了提示词中的所有元素..."
                    />
                  </div>

                  {dim.type === 'radio_select' && (
                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">选项 (逗号分隔)</label>
                      <input 
                        type="text" 
                        value={dim.options?.join(', ') || ''} 
                        onChange={e => handleUpdateDimension(idx, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        className="w-full px-3 py-2 glass-input rounded-lg text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none placeholder:text-slate-400"
                        placeholder="A 更好, B 更好, 平局"
                      />
                    </div>
                  )}
                  <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={dim.required !== false}
                      onChange={e => handleUpdateDimension(idx, { required: e.target.checked })}
                      className="rounded text-amber-400 focus:ring-amber-500"
                    />
                    评测执行时必填
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t border-white/10">
            <button 
              onClick={() => { setIsCreating(false); setEditingTemplateId(null); }}
              className="px-6 py-2.5 rounded-xl font-medium text-slate-300 glass-panel-hover hover:text-slate-200 transition-colors text-sm"
            >
              取消
            </button>
            <button 
              onClick={handleSaveTemplate}
              disabled={!newName.trim() || ((getMethodFromParadigm(newParadigm) === 'direct_score' || getMethodFromParadigm(newParadigm) === 'rubric_score') && dimensions.length === 0)}
              className="px-6 py-2.5 rounded-xl font-medium bg-gradient-accent text-black shadow-lg shadow-amber-500/20 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              保存 Rubric
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8 relative">
        <button 
          onClick={onBack}
          className="absolute left-0 top-0 bg-white/5 glass-panel-hover text-slate-300 px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors border border-white/10"
        >
          <ArrowRight className="rotate-180" size={16} /> 返回大盘
        </button>
        <div className="ml-32">
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <LayoutTemplate className="text-amber-500" /> Rubric 库
          </h1>
          <p className="text-slate-300 mt-1 text-sm">沉淀可复用的评测方式、评分维度、尺度锚点和不可判断规则。</p>
        </div>
        <button 
          onClick={() => {
            setEditingTemplateId(null);
            setNewName('');
            setNewDesc('');
            setNewParadigm('GSB');
              setDimensions([{ id: `dim-new-${Date.now()}`, name: '整体评价', description: '综合评估', type: 'radio_select', options: ['A 更好', 'B 更好', '平局'], scope: 'primary', aggregationRole: 'preference', required: true }]);
              setIsCreating(true);
            }}
          className="flex items-center gap-2 bg-gradient-accent text-black px-6 py-2.5 rounded-xl font-medium text-sm shadow-lg shadow-amber-500/20 transition-all hover:opacity-90"
        >
          <Plus size={18} /> 新建 Rubric
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(template => (
          <div key={template.id} className="glass-panel rounded-2xl border border-white/10 hover:border-white/10 hover:bg-white/[0.05] transition-all p-6 flex flex-col relative group">
            <button 
              onClick={() => setTemplateToDelete(template.id)}
              className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-400 hover:bg-red-400/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
              title="删除 Rubric"
            >
              <Trash2 size={18} />
            </button>
            <div className="flex justify-between items-start mb-3 pr-8">
              <h3 className="font-bold text-lg text-slate-200 line-clamp-1" title={template.name}>{template.name}</h3>
              <span className={`text-xs px-2.5 py-1 rounded-md font-bold shrink-0 border ${
                template.paradigm === 'GSB' || template.paradigm === 'Pairwise' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                template.paradigm === 'MOS' || template.paradigm === 'RubricScore' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {getEvaluationMethodShortLabel(getMethodFromParadigm(template.paradigm))}
              </span>
            </div>
            <p className="text-sm text-slate-300 line-clamp-2 mb-4 flex-1">
              {template.description || '暂无描述'}
            </p>
            
            <div className="glass-panel rounded-xl p-4 mb-4">
              <div className="text-xs font-medium text-slate-300 mb-3">评分标准 / 维度 ({template.dimensions.length}):</div>
              <ul className="space-y-2">
                {template.dimensions.slice(0, 3).map(dim => (
                  <li key={dim.id} className="text-sm text-slate-300 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500/50"></div>
                    <span className="truncate">{dim.name}</span>
                    <span className="text-[10px] text-slate-300 ml-auto border border-white/10 px-1.5 py-0.5 rounded bg-white/5">
                      {dim.type === 'star_rating' ? `星级 · w ${dim.weight ?? 1}` : dim.type === 'radio_select' ? '单选' : '文本'}
                    </span>
                  </li>
                ))}
                {template.dimensions.length > 3 && (
                  <li className="text-xs text-slate-300 pl-3 pt-2 border-t border-white/10 mt-2">... 等 {template.dimensions.length - 3} 个维度</li>
                )}
              </ul>
            </div>

            <div className="pt-4 border-t border-white/10 flex gap-2">
              <button 
                onClick={() => handleEditTemplate(template)}
                className="flex-1 flex items-center justify-center gap-2 bg-white/5 glass-panel-hover text-slate-300 py-2.5 rounded-xl text-sm font-medium transition-colors border border-white/10"
              >
                <Edit2 size={16} /> 编辑 Rubric
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        isOpen={!!templateToDelete}
        title="删除 Rubric"
        message="确定要删除这个 Rubric 吗？此操作不可恢复，已创建的评测物料仍会保留当时保存的评分配置。"
        onConfirm={confirmDeleteTemplate}
        onCancel={() => setTemplateToDelete(null)}
        confirmText="删除"
      />
    </div>
  );
};

export default TemplateRepositoryScreen;
