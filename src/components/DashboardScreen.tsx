import React, { useState, useEffect } from 'react';
import { Layers, Plus, Search, Filter, Calendar, Users, BarChart2, ArrowRight, Activity, Target, Link as LinkIcon, LogIn, LogOut, X, Edit2, Database, LayoutTemplate, Play, ChevronRight, FolderOpen, Trash2 } from 'lucide-react';
import { EvalParadigm, EvaluationProject, EvaluationStep, EvaluationItem, EvalTask } from '../types';
import { CreateProjectModal } from './CreateProjectModal';
import { db, auth, signInWithGoogle, logout } from '../firebase';
import { collection, onSnapshot, addDoc, query, orderBy, doc, updateDoc, where, getDocs, getDoc, setDoc, deleteDoc } from '../datastore';
import { getDimensionValuesForItem, getDimensionValuesFromRecord } from '../dimensionUtils';

interface DashboardScreenProps {
  initialProject?: EvaluationProject | null;
  onProjectSelect?: (project: EvaluationProject | null) => void;
  onGoToExecution: (project: EvaluationProject, taskItems?: EvaluationItem[], taskName?: string, modelNames?: { a: string, b: string }, taskId?: string, existingVotes?: any[], paradigm?: EvalParadigm, models?: { id: string; name: string }[]) => void;
  onGoToAnalysis: (project: EvaluationProject) => void;
  onGoToDatasetRepo: () => void;
  onGoToTemplateRepo: () => void;
  onGoToTaskBuilder: (project: EvaluationProject, mode?: 'create' | 'list') => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ initialProject, onProjectSelect, onGoToExecution, onGoToAnalysis, onGoToDatasetRepo, onGoToTemplateRepo, onGoToTaskBuilder }) => {
  const [projects, setProjects] = useState<EvaluationProject[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<EvaluationProject | null>(initialProject || null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<{projectId: string, step: EvaluationStep} | null>(null);
  const [user, setUser] = useState<any>(auth.currentUser);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(setUser);
    return () => unsub();
  }, []);

  const [loading, setLoading] = useState(true);
  const [projectTasks, setProjectTasks] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [tempLink, setTempLink] = useState('');

  useEffect(() => {
    if (onProjectSelect) {
      onProjectSelect(selectedProject);
    }
  }, [selectedProject, onProjectSelect]);

  useEffect(() => {
    if (!selectedProject?.id) {
      setProjectTasks([]);
      return;
    }
    const q = query(collection(db, 'evalTasks'), where('projectId', '==', selectedProject.id));
    const unsubscribeTasks = onSnapshot(q, (snapshot) => {
      const tasks: any[] = [];
      snapshot.forEach(doc => tasks.push({ id: doc.id, ...doc.data() }));
      setProjectTasks(tasks);
    });
    
    const unsubscribeDatasets = onSnapshot(collection(db, 'evalDatasets'), (snapshot) => {
      const ds: any[] = [];
      snapshot.forEach(doc => ds.push({ id: doc.id, ...doc.data() }));
      setDatasets(ds);
    });
    
    const unsubscribeTemplates = onSnapshot(collection(db, 'evalTemplates'), (snapshot) => {
      const ts: any[] = [];
      snapshot.forEach(doc => ts.push({ id: doc.id, ...doc.data() }));
      setTemplates(ts);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeDatasets();
      unsubscribeTemplates();
    };
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedProjects: EvaluationProject[] = [];
      const uid = auth.currentUser?.uid;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as EvaluationProject;
        const canAutoWriteProject =
          !!uid && data.initiatorUid != null && data.initiatorUid === uid;

        // Auto-migrate old projects to the new 3-step structure
        let needsMigration = false;
        let migratedSteps = data.steps;

        if (data.steps && data.steps.length === 4 && data.steps[0].name === '评测集准备') {
          needsMigration = true;
          migratedSteps = [
            { id: 1, name: '评测物料生产', owner: data.steps[0].owner, status: data.steps[0].status, executionType: 'external' },
            { id: 2, name: '评测执行', owner: data.steps[1].owner, status: data.steps[1].status, executionType: 'internal' },
            { id: 3, name: '评测结果分析', owner: data.steps[3].owner, status: data.steps[3].status, executionType: 'internal' }
          ];
        } else if (data.steps && data.steps.length === 7 && data.steps[0].name === '明确目的与周期') {
          needsMigration = true;
          migratedSteps = [
            { id: 1, name: '评测物料生产', owner: data.steps[1].owner, status: data.steps[1].status, executionType: 'external' },
            { id: 2, name: '评测执行', owner: data.steps[4].owner, status: data.steps[4].status, executionType: 'internal' },
            { id: 3, name: '评测结果分析', owner: data.steps[5].owner, status: data.steps[5].status, executionType: 'internal' }
          ];
        } else if (data.steps && data.steps.length === 3 && data.steps[0].name === '评测集准备与标准设计') {
          // Rename step 1 if it's the intermediate 3-step version
          needsMigration = true;
          migratedSteps = [
            { ...data.steps[0], name: '评测物料生产' },
            data.steps[1],
            data.steps[2]
          ];
        }

        // Only the project initiator may write; otherwise updateDoc fails and this listener would retry forever.
        if (needsMigration && canAutoWriteProject) {
          const cleanMigratedSteps = JSON.parse(JSON.stringify(migratedSteps));
          updateDoc(doc(db, 'projects', docSnap.id), { steps: cleanMigratedSteps }).catch(console.error);
          data.steps = migratedSteps;
        }

        // Ensure step 1 is never 'pending' (initiator only — same as above)
        if (
          canAutoWriteProject &&
          data.steps &&
          data.steps[0] &&
          data.steps[0].status === 'pending'
        ) {
          data.steps[0].status = 'in-progress';
          updateDoc(doc(db, 'projects', docSnap.id), { steps: data.steps }).catch(console.error);
        }

        fetchedProjects.push({ id: docSnap.id, ...data });
      });
      setProjects(fetchedProjects);
      
      // Also update selectedProject if it's currently open and was migrated
      setSelectedProject(prev => {
        if (!prev) return null;
        const updated = fetchedProjects.find(p => p.id === prev.id);
        return updated || prev;
      });
      
      setLoading(false);
    }, (error) => {
      console.error("Error fetching projects:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleCreateProject = async (projectData: Partial<EvaluationProject>) => {
    if (!user) return;
    
    // Strip undefined values to prevent Firestore errors
    const cleanProjectData = JSON.parse(JSON.stringify(projectData));
    
    try {
      await addDoc(collection(db, 'projects'), {
        ...cleanProjectData,
        initiatorUid: user.uid,
        initiatorName: user.displayName || user.email || 'Anonymous',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      });
    } catch (error) {
      console.error("Error adding document: ", error);
      alert("创建任务失败，请检查权限或重试。");
    }
  };

  const handleUpdateStepStatus = async (projectId: string, stepId: number, currentStatus: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Cycle status: pending -> in-progress -> completed -> pending
    // For step 1, we only want in-progress -> completed -> in-progress
    let nextStatus;
    if (stepId === 1) {
      nextStatus = currentStatus === 'completed' ? 'in-progress' : 'completed';
    } else {
      nextStatus = currentStatus === 'pending' ? 'in-progress' : currentStatus === 'in-progress' ? 'completed' : 'pending';
    }
    
    const updatedSteps = project.steps.map(s => s.id === stepId ? { ...s, status: nextStatus } : s);
    const completedCount = updatedSteps.filter(s => s.status === 'completed').length;
    const newProgress = Math.round((completedCount / updatedSteps.length) * 100);

    // Strip undefined values to prevent Firestore errors
    const cleanSteps = JSON.parse(JSON.stringify(updatedSteps));

    try {
      const docRef = doc(db, 'projects', projectId);
      await updateDoc(docRef, {
        steps: cleanSteps,
        progress: newProgress,
        lastUpdated: Date.now()
      });
      
      // Update local state for selectedProject if it's the one being edited
      if (selectedProject?.id === projectId) {
        setSelectedProject({ ...project, steps: updatedSteps, progress: newProgress });
      }
    } catch (error) {
      console.error("Error updating step:", error);
      alert("更新状态失败，请检查权限");
    }
  };

  const handleSaveStepEdit = async (updatedStep: EvaluationStep) => {
    if (!editingStep || !user) return;
    
    const project = projects.find(p => p.id === editingStep.projectId);
    if (!project) return;

    const updatedSteps = project.steps.map(s => s.id === updatedStep.id ? updatedStep : s);
    const completedCount = updatedSteps.filter(s => s.status === 'completed').length;
    const newProgress = Math.round((completedCount / updatedSteps.length) * 100);

    // Strip undefined values to prevent Firestore errors
    const cleanSteps = JSON.parse(JSON.stringify(updatedSteps));

    try {
      const docRef = doc(db, 'projects', editingStep.projectId);
      await updateDoc(docRef, {
        steps: cleanSteps,
        progress: newProgress,
        lastUpdated: Date.now()
      });
      
      if (selectedProject?.id === editingStep.projectId) {
        setSelectedProject({ ...project, steps: updatedSteps, progress: newProgress });
      }
      setEditingStep(null);
    } catch (error) {
      console.error("Error saving step edit:", error);
      alert("保存失败，请检查权限");
    }
  };

  const handleSaveLink = async () => {
    if (!selectedProject || !user) return;
    try {
      const docRef = doc(db, 'projects', selectedProject.id);
      await updateDoc(docRef, { link: tempLink });
      setSelectedProject({ ...selectedProject, link: tempLink });
      setIsEditingLink(false);
    } catch (error) {
      console.error("Error saving link:", error);
      alert("保存链接失败，请检查权限");
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (window.confirm('确定要删除这个项目吗？删除后不可恢复。')) {
      try {
        await deleteDoc(doc(db, 'projects', projectId));
        if (selectedProject?.id === projectId) {
          setSelectedProject(null);
        }
      } catch (error) {
        console.error("Error deleting project:", error);
        alert("删除失败，请检查权限");
      }
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (window.confirm('确定要删除这个评测任务吗？删除后不可恢复。')) {
      try {
        await deleteDoc(doc(db, 'evalTasks', taskId));
      } catch (error) {
        console.error("Error deleting task:", error);
        alert("删除失败，请检查权限");
      }
    }
  };

  const handleStartTask = async (task: EvalTask) => {
    try {
      const template = templates.find(t => t.id === task.templateId);
      const paradigm = (template?.paradigm || 'Arena') as EvalParadigm;
      const taskModelList = task.models?.length ? task.models : [
        { id: 'model-a', name: 'Model A' },
        { id: 'model-b', name: 'Model B' }
      ];
      const itemsSnapshot = await getDocs(collection(db, 'evalTasks', task.id, 'items'));
      let items = itemsSnapshot.docs.map(docSnap => {
        const data = { id: docSnap.id, ...docSnap.data() } as EvaluationItem;
        data.dimensionValues = getDimensionValuesForItem(data as any, task.dimensionColumns || []);
        if (!data.modelOutputs?.length) {
          const originalData = (data as any).originalData || {};
          data.modelOutputs = taskModelList.map((model, idx) => ({
            modelId: model.id || `model-${idx}`,
            modelName: model.name || `Model ${idx + 1}`,
            url: idx === 0
              ? data.modelA_Url
              : idx === 1
                ? data.modelB_Url
                : originalData[model.name] || originalData[model.id] || ''
          })).filter(output => output.url);
        }
        return data;
      });
      
      if (items.length === 0 && task.datasetId && task.datasetId !== 'external-csv') {
        // Fetch from dataset
        const dsDoc = await getDoc(doc(db, 'evalDatasets', task.datasetId));
        if (dsDoc.exists) {
          const dsData = dsDoc.data() as any;
          if (dsData.items && dsData.items.length > 0) {
            items = dsData.items.map((row: any, idx: number) => {
              const keys = Object.keys(row);
              const fallbackModelKeys = keys.filter(key => !key.toLowerCase().includes('id')).slice(-(taskModelList.length || 2));
              const modelKeys = taskModelList.map((model, modelIdx) => (
                row[model.name] !== undefined ? model.name :
                row[model.id] !== undefined ? model.id :
                fallbackModelKeys[modelIdx]
              )).filter(Boolean);
              const modelAKey = modelKeys[0] || keys[keys.length - 2];
              const modelBKey = modelKeys[1] || keys[keys.length - 1];
              
              const inputs = { ...row };
              modelKeys.forEach(key => delete inputs[key]);
              (task.dimensionColumns || []).forEach(key => delete inputs[key]);
              
              let startImageUrl: string | undefined;
              let referenceUrls: string[] = [];
              
              Object.keys(inputs).forEach(col => {
                const val = inputs[col];
                if (typeof val === 'string') {
                  const urls = val.match(/https?:\/\/[^\s"'\t|,;>]+/g);
                  if (urls) {
                    const lowerCol = col.toLowerCase();
                    urls.forEach(u => {
                      if (lowerCol.includes('start') || lowerCol.includes('首帧') || lowerCol.includes('first')) {
                        if (!startImageUrl) startImageUrl = u;
                        else referenceUrls.push(u);
                      } else if (lowerCol.includes('ref') || lowerCol.includes('参考')) {
                        referenceUrls.push(u);
                      } else {
                        if (!startImageUrl) startImageUrl = u;
                        else referenceUrls.push(u);
                      }
                    });
                  }
                }
              });

              return {
                id: `ds-item-${idx}`,
                modelA_Url: row[modelAKey] || '',
                modelB_Url: row[modelBKey] || '',
                modelOutputs: taskModelList.map((model, modelIdx) => ({
                  modelId: model.id || `model-${modelIdx}`,
                  modelName: model.name || `Model ${modelIdx + 1}`,
                  url: row[modelKeys[modelIdx]] || ''
                })).filter(output => output.url),
                inputs,
                dimensionValues: getDimensionValuesFromRecord(row, task.dimensionColumns || []),
                prompt: inputs['prompt'] || inputs['提示词'] || Object.values(inputs)[0] || '',
                type: task.outputType || 'text',
                startImageUrl,
                referenceUrls: referenceUrls.length > 0 ? referenceUrls : undefined
              } as EvaluationItem;
            });
          }
        }
      }

      // Update totalItems if it's missing or incorrect
      if (items.length > 0 && task.totalItems !== items.length) {
        try {
          await updateDoc(doc(db, 'evalTasks', task.id), { totalItems: items.length });
        } catch (e) {
          console.error("Failed to update totalItems", e);
        }
      }
      
      const modelNames = {
        a: taskModelList[0]?.name || 'Model A',
        b: taskModelList[1]?.name || 'Model B'
      };
      
      const userName = auth.currentUser?.email || auth.currentUser?.displayName || localStorage.getItem('eval_username') || 'Anonymous';
      let existingVotes: any[] = [];
      try {
        const voteDoc = await getDoc(doc(db, 'evalTasks', task.id, 'userVotes', userName));
        if (voteDoc.exists) {
          existingVotes = voteDoc.data().votes || [];
        }
        
        // Initialize progress for this user if not present
        if (task.progress?.[userName] === undefined) {
          await setDoc(doc(db, 'evalTasks', task.id), {
            progress: {
              [userName]: existingVotes.length
            }
          }, { merge: true });
        }
      } catch (e) {
        console.error("Failed to fetch existing votes or update progress", e);
      }
      
      onGoToExecution(selectedProject!, items, task.name, modelNames, task.id, existingVotes, paradigm, taskModelList);
    } catch (error) {
      console.error("Error fetching task items:", error);
      alert("获取评测数据失败");
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.initiatorName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // If a project is selected, show its details
  if (selectedProject) {
    return (
      <div className="max-w-7xl mx-auto p-6 animate-in fade-in duration-300">
        <button 
          onClick={() => setSelectedProject(null)}
          className="text-slate-300 hover:text-slate-200 mb-6 flex items-center gap-2 text-sm font-medium transition-colors"
        >
          ← 返回大盘
        </button>

        <div className="glass-panel rounded-[2rem] overflow-hidden">
          {/* Header */}
          <div className="p-8 border-b border-white/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
                    selectedProject.type.includes('重度') ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  }`}>
                    {selectedProject.type}
                  </span>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
                    selectedProject.priority === 'P0' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                    selectedProject.priority === 'P1' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-white/10 text-slate-300 border-white/10'
                  }`}>
                    {selectedProject.priority}
                  </span>
                </div>
                <h1 className="text-3xl font-bold text-slate-100 tracking-tight">{selectedProject.name}</h1>
              </div>
            </div>
            <p className="text-slate-300 max-w-3xl leading-relaxed relative z-10">{selectedProject.goal}</p>
          </div>

          {/* Meta Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/10 glass-panel border-b-0">
            <div className="p-6">
              <div className="text-xs text-slate-300 font-bold uppercase tracking-wider mb-2">发起人</div>
              <div className="font-medium text-slate-200 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs border border-white/10">
                  {selectedProject.initiatorName?.[0] || '?'}
                </div>
                {selectedProject.initiatorName || '未知'}
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-300 font-bold uppercase tracking-wider mb-2">预计周期</div>
              <div className="font-medium text-slate-200 flex items-center gap-2">
                <Calendar size={16} className="text-slate-300" />
                {selectedProject.cycle || '未设置'}
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-300 font-bold uppercase tracking-wider mb-2">人员支持</div>
              <div className="font-medium text-slate-200 flex items-center gap-2">
                <Users size={16} className="text-slate-300" />
                {selectedProject.support?.join(', ') || '无'}
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-300 font-bold uppercase tracking-wider mb-2">当前进度</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-black/20 rounded-full overflow-hidden border border-white/10">
                  <div 
                    className={`h-full rounded-full ${selectedProject.progress === 100 ? 'bg-emerald-500' : 'bg-gradient-accent'}`}
                    style={{ width: `${selectedProject.progress || 0}%` }}
                  />
                </div>
                <span className="font-mono font-bold text-slate-200">{selectedProject.progress || 0}%</span>
              </div>
            </div>
          </div>

          {/* Details Content */}
          <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              {/* Progress Steps */}
              <section>
                <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                  <Activity size={20} className="text-amber-500" />
                  执行进度拆解 <span className="text-xs text-slate-300 font-normal ml-2">(点击状态可切换，点击编辑可更新详情)</span>
                </h3>
                <div className="space-y-4">
                  {selectedProject.steps?.map((step, idx) => (
                    <div key={step.id} className="flex items-start gap-4 p-5 rounded-2xl glass-panel glass-panel-hover transition-colors group">
                      <div className={`w-7 h-7 mt-0.5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-md shadow-black/20 ${
                        step.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        step.status === 'in-progress' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-white/10 text-slate-300 border border-white/10'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-200 flex items-center gap-2 flex-wrap text-base">
                          {step.name}
                          {step.executionType === 'internal' && <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-md">平台内执行</span>}
                          {step.executionType === 'external' && <span className="text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30 px-2 py-0.5 rounded-md">外部执行</span>}
                        </div>
                        <div className="text-sm text-slate-300 mt-1.5">负责人: {step.owner}</div>
                        
                        {(step.resultNote || step.materialFile) && (
                          <div className="mt-4 p-4 glass-panel rounded-xl text-sm">
                            {step.materialFile && (
                              <div className="text-slate-300 mb-2 flex items-center gap-2">
                                <span className="text-slate-300 font-medium">已上传物料:</span> {step.materialFile.name}
                              </div>
                            )}
                            {step.resultNote && <div className="text-slate-300 whitespace-pre-wrap mb-2 leading-relaxed">{step.resultNote}</div>}
                          </div>
                        )}
                        
                        {/* Action buttons based on step */}
                        {step.id === 1 && (
                          <div className="mt-5 space-y-4">
                            {projectTasks.length > 0 && (
                              <div className="glass-panel rounded-xl p-4">
                                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">本轮评测物料</h4>
                                <div className="space-y-3">
                                  {projectTasks.map(task => {
                                    const ds = datasets.find(d => d.id === task.datasetId);
                                    const tpl = templates.find(t => t.id === task.templateId);
                                    return (
                                      <div key={task.id} className="flex flex-col gap-1.5 text-sm border-b border-white/10 last:border-0 pb-3 last:pb-0">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium text-slate-200">{task.name}</span>
                                          <div className="flex items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                                              task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                              task.status === 'active' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-white/10 text-slate-300 border-white/10'
                                            }`}>
                                              {task.status === 'completed' ? '已完成' : task.status === 'active' ? '进行中' : '草稿'}
                                            </span>
                                            <button 
                                              onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                              className="text-slate-400 hover:text-red-400 transition-colors p-1 rounded-md glass-panel-hover" 
                                              title="删除任务"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-slate-300 mt-1">
                                          <div className="flex items-center gap-1.5"><Database size={12} className="text-slate-300"/> {ds?.name || '未知评测集'}</div>
                                          <div className="flex items-center gap-1.5"><LayoutTemplate size={12} className="text-slate-300"/> {tpl?.name || '未知模板'}</div>
                                          {task.inputType && (
                                            <div className="flex items-center gap-1">
                                              <span className="px-1.5 py-0.5 glass-panel rounded text-[10px] text-slate-300">
                                                {task.inputType === 'text' ? '纯文本' : 
                                                 task.inputType === 'text_image' ? '图文混合' : 
                                                 task.inputType === 'text_audio' ? '音文混合' : 
                                                 task.inputType === 'multi_turn' ? '多轮对话' : '其他输入'}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                        {task.externalResultsLink && (
                                          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400">
                                            <LinkIcon size={12} />
                                            <a 
                                              href={task.externalResultsLink.startsWith('http') ? task.externalResultsLink : `https://${task.externalResultsLink}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="hover:underline truncate max-w-[200px]"
                                              title={task.externalResultsLink}
                                            >
                                              外部生成结果
                                            </a>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            
                            {projectTasks.length === 0 && step.status === 'completed' && (
                              <div className="text-sm text-slate-300 italic p-4 glass-panel rounded-xl">
                                该环节已标记为完成，但尚未创建任何评测物料。
                              </div>
                            )}
                            
                            {step.status === 'in-progress' && (
                              <div className="flex flex-wrap items-center gap-3">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onGoToTaskBuilder(selectedProject, projectTasks.length > 0 ? 'list' : 'create');
                                  }}
                                  className="bg-gradient-accent text-black px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90 flex items-center gap-2 shadow-lg shadow-amber-500/20"
                                >
                                  <Plus size={16} /> {projectTasks.length > 0 ? '管理评测物料' : '创建评测物料'}
                                </button>
                                
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onGoToDatasetRepo();
                                  }}
                                  className="glass-panel glass-panel-hover text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                  <Database size={14} className="text-amber-500" /> 评测集仓库
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onGoToTemplateRepo();
                                  }}
                                  className="glass-panel glass-panel-hover text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                  <LayoutTemplate size={14} className="text-yellow-500" /> 评测模板仓库
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {step.id === 2 && step.executionType === 'internal' && (
                          <div className="mt-5 space-y-4">
                            {projectTasks.length > 0 ? (
                              <div className="glass-panel rounded-xl p-4">
                                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">待执行评测任务</h4>
                                <div className="space-y-3">
                                  {projectTasks.map(task => (
                                    <div key={task.id} className="flex items-center justify-between p-4 glass-panel rounded-xl glass-panel-hover transition-colors">
                                      <div>
                                        <div className="font-medium text-slate-200 flex items-center gap-2">
                                          {task.name}
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                            className="text-slate-400 hover:text-red-400 transition-colors p-1 rounded-md glass-panel-hover" 
                                            title="删除任务"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                        {(() => {
                                          const rawUsers = [
                                            ...(task.assignees || []),
                                            ...Object.keys(task.progress || {})
                                          ];
                                          // Deduplicate based on email prefix
                                          const uniqueUsersMap = new Map();
                                          rawUsers.forEach(u => {
                                            const prefix = u.split('@')[0];
                                            // Prefer the email version if both exist
                                            if (u.includes('@') || !uniqueUsersMap.has(prefix)) {
                                              uniqueUsersMap.set(prefix, u);
                                            }
                                          });
                                          const allProgressUsers = Array.from(uniqueUsersMap.values());
                                          
                                          if (allProgressUsers.length === 0) return null;

                                          return (
                                            <div className="text-xs text-slate-300 mt-2.5 space-y-2">
                                              <div className="flex items-center gap-1.5 font-medium text-slate-300">
                                                <Users size={12} /> 评测进度:
                                              </div>
                                              {allProgressUsers.map(assignee => {
                                                const progress = task.progress?.[assignee] || Object.entries(task.progress || {}).find(([k]) => k.split('@')[0] === assignee || k === assignee.split('@')[0])?.[1] || 0;
                                                const total = task.totalItems || (task.datasetId && task.datasetId !== 'external-csv' ? datasets.find(d => d.id === task.datasetId)?.items?.length : 0) || 0;
                                                const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
                                                return (
                                                  <div key={assignee} className="flex items-center gap-3 ml-5">
                                                    <span className="w-24 truncate" title={assignee}>{assignee.split('@')[0]}</span>
                                                    <div className="flex-1 max-w-[120px] h-1.5 bg-black/20 rounded-full overflow-hidden border border-white/10">
                                                      <div 
                                                        className={`h-full rounded-full ${percentage === 100 ? 'bg-emerald-500' : 'bg-gradient-accent'}`}
                                                        style={{ width: `${percentage}%` }}
                                                      />
                                                    </div>
                                                    <span className="font-mono text-[10px] w-12 text-right text-slate-300">{progress} / {total}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleStartTask(task);
                                        }}
                                        className="glass-panel glass-panel-hover text-slate-200 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                                      >
                                        <Play size={14} fill="currentColor" className="text-amber-500" /> 开始评测
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-slate-300 italic p-4 glass-panel rounded-xl">
                                暂无评测物料，请先在“评测物料生产”环节创建。
                              </div>
                            )}
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onGoToExecution(selectedProject);
                              }}
                              className="mt-3 glass-panel glass-panel-hover text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 w-fit"
                            >
                              上传CSV执行 (旧版) <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                        {step.id === 3 && (
                          <div className="mt-5 space-y-4">
                            <div className="glass-panel rounded-xl p-5">
                              <h4 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">
                                <BarChart2 size={16} className="text-amber-500" />
                                评测结果分析
                              </h4>
                              <div className="text-sm text-slate-300 mb-4">
                                {selectedProject.resultSummary || '待产出'}
                              </div>
                              {selectedProject.progress === 100 && selectedProject.analysis && (
                                <div className="p-4 glass-panel rounded-xl text-sm leading-relaxed mb-4 text-slate-300">
                                  {selectedProject.analysis}
                                </div>
                              )}
                              {step.executionType === 'internal' && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onGoToAnalysis(selectedProject);
                                  }}
                                  className="w-fit bg-gradient-accent text-black px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90 flex items-center gap-2 shadow-lg shadow-amber-500/20"
                                >
                                  查看详细数据大盘 <ArrowRight size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <button 
                          onClick={() => handleUpdateStepStatus(selectedProject.id, step.id, step.status)}
                          className="focus:outline-none transition-transform active:scale-95"
                        >
                          {step.status === 'completed' && <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-emerald-500/20 transition-colors">已完成</span>}
                          {step.status === 'in-progress' && <span className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors">进行中</span>}
                          {step.status === 'pending' && <span className="text-xs font-bold text-slate-300 glass-panel glass-panel-hover px-3 py-1.5 rounded-lg cursor-pointer transition-colors">待开始</span>}
                        </button>
                        <button 
                          onClick={() => setEditingStep({projectId: selectedProject.id, step})}
                          className="text-slate-300 hover:text-amber-400 p-2 rounded-lg glass-panel-hover transition-colors opacity-0 group-hover:opacity-100"
                          title="编辑进度详情"
                        >
                          <Edit2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              {/* Project Links */}
              <div className="glass-panel p-6 rounded-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="font-bold text-slate-200">项目资源</h4>
                  {!isEditingLink && (
                    <button 
                      onClick={() => {
                        setTempLink(selectedProject.link || '');
                        setIsEditingLink(true);
                      }}
                      className="text-slate-300 hover:text-amber-400 p-1.5 rounded-lg glass-panel-hover transition-colors"
                      title="编辑链接"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-slate-300 mb-2.5">项目文档链接</div>
                    {isEditingLink ? (
                      <div className="space-y-3">
                        <input 
                          type="text" 
                          value={tempLink}
                          onChange={e => setTempLink(e.target.value)}
                          className="w-full px-3 py-2.5 glass-input rounded-xl text-sm text-slate-200 placeholder:text-slate-400"
                          placeholder="输入飞书/Wiki链接..."
                        />
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={handleSaveLink}
                            className="bg-gradient-accent text-black px-4 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90"
                          >
                            保存
                          </button>
                          <button 
                            onClick={() => setIsEditingLink(false)}
                            className="glass-panel glass-panel-hover text-slate-300 px-4 py-2 rounded-xl text-xs font-medium transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : selectedProject.link ? (
                      <a href={selectedProject.link} target="_blank" rel="noreferrer" className="text-sm text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-1.5 break-all">
                        <LinkIcon size={14} className="shrink-0" /> {selectedProject.link}
                      </a>
                    ) : (
                      <span className="text-sm text-slate-300">暂无链接</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {editingStep && (
          <EditStepModal 
            step={editingStep.step}
            onClose={() => setEditingStep(null)}
            onSave={handleSaveStepEdit}
          />
        )}
      </div>
    );
  }

  // Main Dashboard List
  return (
    <div className="max-w-7xl mx-auto p-6 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative mb-12 py-16 px-8 rounded-[2rem] overflow-hidden glass-panel border-white/10">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/20 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-yellow-500/10 rounded-full blur-[100px] pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
              评测 <span className="text-gradient">工作台</span>
            </h1>
            <p className="text-slate-300 text-lg max-w-xl font-light">
              精确管理、跟踪和执行模型评测项目。
            </p>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4 bg-white/5 backdrop-blur-md border border-white/10 px-4 py-2 rounded-2xl">
                <div className="w-8 h-8 rounded-full bg-gradient-accent text-black flex items-center justify-center text-sm font-bold">
                  {user.displayName?.[0] || user.email?.[0] || 'U'}
                </div>
                <span className="text-slate-200 font-medium">{user.displayName || user.email}</span>
                <div className="w-px h-6 bg-white/10 mx-2"></div>
                <button onClick={logout} className="text-slate-300 hover:text-white transition-colors" title="退出登录">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button 
                onClick={signInWithGoogle}
                className="flex items-center gap-2 bg-white/10 glass-panel-hover border border-white/10 text-white px-6 py-3 rounded-2xl font-medium transition-all"
              >
                <LogIn size={18} /> 登录
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group hover:bg-white/[0.05] transition-colors border-white/10">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-3xl group-hover:bg-amber-500/10 transition-colors"></div>
          <div className="text-slate-300 text-sm font-medium mb-3 uppercase tracking-wider">活跃任务</div>
          <div className="text-4xl font-light text-white font-mono">{projects.filter(p => p.progress !== 100).length}</div>
        </div>
        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group hover:bg-white/[0.05] transition-colors border-white/10">
          <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl group-hover:bg-yellow-500/10 transition-colors"></div>
          <div className="text-slate-300 text-sm font-medium mb-3 uppercase tracking-wider">待执行</div>
          <div className="text-4xl font-light text-amber-400 font-mono">0</div>
        </div>
        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group hover:bg-white/[0.05] transition-colors border-white/10">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors"></div>
          <div className="text-slate-300 text-sm font-medium mb-3 uppercase tracking-wider">已完成</div>
          <div className="text-4xl font-light text-white font-mono">{projects.filter(p => p.progress === 100).length}</div>
        </div>
        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group hover:bg-white/[0.05] transition-colors border-white/10">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl group-hover:bg-purple-500/10 transition-colors"></div>
          <div className="text-slate-300 text-sm font-medium mb-3 uppercase tracking-wider">活跃数据集</div>
          <div className="text-4xl font-light text-white font-mono">0</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
        <div className="relative w-full md:w-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input 
            type="text" 
            placeholder="搜索项目..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full md:w-80 pl-12 pr-4 py-3 glass-panel rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <button className="flex items-center gap-2 glass-panel glass-panel-hover text-slate-300 px-5 py-3 rounded-2xl font-medium text-sm transition-colors">
            <Filter size={16} /> 筛选
          </button>
          {user && (
            <>
              <button 
                onClick={onGoToDatasetRepo}
                className="flex items-center gap-2 glass-panel glass-panel-hover text-slate-300 px-5 py-3 rounded-2xl font-medium text-sm transition-colors"
                title="管理数据集"
              >
                <Database size={16} className="text-amber-500" /> 数据集
              </button>
              <button 
                onClick={onGoToTemplateRepo}
                className="flex items-center gap-2 glass-panel glass-panel-hover text-slate-300 px-5 py-3 rounded-2xl font-medium text-sm transition-colors"
                title="管理模板"
              >
                <LayoutTemplate size={16} className="text-yellow-500" /> 模板
              </button>
              <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-2 bg-gradient-accent text-black px-6 py-3 rounded-2xl font-semibold text-sm shadow-[0_0_20px_rgba(217,119,6,0.3)] hover:shadow-[0_0_25px_rgba(217,119,6,0.5)] transition-all transform hover:-translate-y-0.5"
              >
                <Plus size={18} /> 新建项目
              </button>
            </>
          )}
        </div>
      </div>

      {/* Project List */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-20 text-center text-slate-300 flex flex-col items-center glass-panel rounded-3xl">
            <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4"></div>
            加载工作台中...
          </div>
        ) : !user ? (
          <div className="py-20 text-center text-slate-300 flex flex-col items-center glass-panel rounded-3xl">
            <div className="w-16 h-16 bg-white/5 text-slate-300 rounded-full flex items-center justify-center mb-6">
              <Layers size={32} />
            </div>
            <p className="text-lg font-medium text-slate-300 mb-2">登录以查看项目</p>
            <p className="text-sm font-light">您的评测工作台需要身份验证。</p>
            <button 
              onClick={signInWithGoogle}
              className="mt-6 bg-gradient-accent text-black px-6 py-3 rounded-2xl font-semibold shadow-md transition-all transform hover:scale-105"
            >
              使用 Google 登录
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="py-20 text-center text-slate-300 flex flex-col items-center glass-panel rounded-3xl">
            <div className="w-16 h-16 bg-white/5 text-slate-300 rounded-full flex items-center justify-center mb-6">
              <FolderOpen size={32} />
            </div>
            <p className="text-lg font-medium text-slate-300 mb-2">未找到项目</p>
            <p className="text-sm font-light">创建一个新项目以开始。</p>
          </div>
        ) : (
          filteredProjects.map(project => (
            <div 
              key={project.id} 
              onClick={() => setSelectedProject(project)}
              className="glass-panel p-6 rounded-2xl hover:bg-white/[0.05] transition-all cursor-pointer group border-white/10 hover:border-white/10"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-300 border border-white/10">
                      {project.type.split(' ')[0]}
                    </span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${
                      project.priority === 'P0' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                      project.priority === 'P1' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-white/10 text-slate-300 border-white/10'
                    }`}>
                      {project.priority}
                    </span>
                    <span className="text-xs text-slate-300 font-mono">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2 group-hover:text-amber-400 transition-colors">{project.name}</h3>
                  <p className="text-slate-300 text-sm line-clamp-1 font-light">{project.goal}</p>
                </div>
                
                <div className="flex items-center gap-8 md:w-1/3 justify-end">
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-slate-300 uppercase tracking-wider font-bold mb-2">进度</span>
                    <div className="flex items-center gap-3 w-32">
                      <div className="flex-1 h-1.5 bg-[#222] rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${project.progress === 100 ? 'bg-emerald-500' : 'bg-gradient-accent'}`}
                          style={{ width: `${project.progress || 0}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-slate-300">{project.progress || 0}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="删除项目"
                    >
                      <Trash2 size={18} />
                    </button>
                    <ChevronRight className="text-slate-300 group-hover:text-amber-500 transition-colors" size={20} />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <CreateProjectModal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)} 
        onSubmit={handleCreateProject} 
      />

      {editingStep && (
        <EditStepModal 
          step={editingStep.step}
          onClose={() => setEditingStep(null)}
          onSave={handleSaveStepEdit}
        />
      )}
    </div>
  );
};

interface EditStepModalProps {
  step: EvaluationStep;
  onClose: () => void;
  onSave: (step: EvaluationStep) => void;
}

const EditStepModal: React.FC<EditStepModalProps> = ({ step, onClose, onSave }) => {
  const [owner, setOwner] = useState(step.owner || '');
  const [status, setStatus] = useState(step.status);
  const [executionType, setExecutionType] = useState(step.executionType || 'internal');
  const [resultNote, setResultNote] = useState(step.resultNote || '');
  const [materialFile, setMaterialFile] = useState<{name: string, url: string} | undefined>(step.materialFile);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedStep: EvaluationStep = {
      ...step,
      owner,
      status,
      executionType: executionType as 'internal' | 'external',
      resultNote: resultNote || '',
    };
    
    if (materialFile) {
      updatedStep.materialFile = materialFile;
    } else {
      delete updatedStep.materialFile;
    }
    
    onSave(updatedStep);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // In a real app, upload to Firebase Storage here.
      // For now, just save the name and a fake URL.
      setMaterialFile({ name: file.name, url: URL.createObjectURL(file) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="glass-panel rounded-2xl w-full max-w-md overflow-hidden flex flex-col border border-white/10 shadow-2xl">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
          <h2 className="text-lg font-bold text-slate-200" title="更新环节状态与负责人">更新环节状态与负责人</h2>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-300 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          <form id="edit-step-form" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">状态</label>
              <select 
                value={status}
                onChange={e => setStatus(e.target.value as any)}
                className="w-full px-3 py-2.5 glass-panel rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all"
              >
                <option value="pending" className="bg-black/40">待开始</option>
                <option value="in-progress" className="bg-black/40">进行中</option>
                <option value="completed" className="bg-black/40">已完成</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">负责人</label>
              <input 
                type="text" 
                value={owner}
                onChange={e => setOwner(e.target.value)}
                className="w-full px-3 py-2.5 glass-panel rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all placeholder:text-slate-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">执行方式</label>
              <select 
                value={executionType}
                onChange={e => setExecutionType(e.target.value as any)}
                className="w-full px-3 py-2.5 glass-panel rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all"
              >
                <option value="internal" className="bg-black/40">平台内执行</option>
                <option value="external" className="bg-black/40">外部执行</option>
              </select>
            </div>

            {executionType === 'internal' && (step.id === 1 || step.id === 2) ? (
              <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 p-4 rounded-xl text-sm flex items-start gap-3 mt-5">
                <Activity size={18} className="mt-0.5 shrink-0 text-indigo-400" />
                <div>
                  <p className="font-medium text-indigo-200">平台内闭环环节</p>
                  <p className="text-indigo-300/80 mt-1.5 leading-relaxed">此环节的产出物（如评测物料、评测结果）由平台自动管理，无需手动上传外部链接或文件。</p>
                </div>
              </div>
            ) : (
              <>
                {step.id === 1 && (
                  <div className="mt-5">
                    <label className="block text-sm font-medium text-slate-300 mb-2">上传评测物料 (CSV)</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="file" 
                        accept=".csv"
                        onChange={handleFileChange}
                        className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-slate-200 hover:file:bg-white/20 transition-colors cursor-pointer"
                      />
                    </div>
                    {materialFile && (
                      <div className="mt-3 text-xs text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg">
                        ✓ 已选择: {materialFile.name}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="pt-2">
              <label className="block text-sm font-medium text-slate-300 mb-1.5">执行备注/结果 (选填)</label>
              <textarea 
                value={resultNote}
                onChange={e => setResultNote(e.target.value)}
                placeholder="记录执行过程中的关键信息、结果摘要等..."
                className="w-full px-3 py-2.5 glass-panel rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all min-h-[100px] placeholder:text-slate-300"
              />
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex justify-end gap-3">
          <button 
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-300 glass-panel-hover hover:text-slate-200 rounded-xl font-medium transition-colors text-sm"
          >
            取消
          </button>
          <button 
            type="submit"
            form="edit-step-form"
            className="px-5 py-2 bg-gradient-accent text-black rounded-xl font-medium shadow-lg shadow-amber-500/20 hover:opacity-90 transition-all text-sm"
          >
            保存更新
          </button>
        </div>
      </div>
    </div>
  );
};
