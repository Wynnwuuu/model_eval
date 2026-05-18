import React, { useState } from 'react';
import { EvaluationProject } from '../types';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { Search, Filter, ChevronRight, BarChart2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface DashboardProps {
  projects: EvaluationProject[];
  onSelectProject: (id: string) => void;
}

export function Dashboard({ projects, onSelectProject }: DashboardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.initiator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || p.type.includes(filterType);
    return matchesSearch && matchesType;
  });

  const getPriorityBadge = (p: string) => {
    switch(p) {
      case 'P0': return <Badge variant="danger">P0</Badge>;
      case 'P1': return <Badge variant="warning">P1</Badge>;
      default: return <Badge variant="default">{p}</Badge>;
    }
  };

  const getStatusIcon = (progress: number) => {
    if (progress === 100) return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (progress > 0) return <Clock className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-slate-500" />;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-panel p-4 rounded-xl border border-white/10 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-indigo-50 rounded-lg text-indigo-600">
            <BarChart2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-400 font-medium">总评测物料</p>
            <p className="text-2xl font-bold text-slate-100">{projects.length}</p>
          </div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-white/10 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-amber-50 rounded-lg text-amber-600">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-400 font-medium">进行中</p>
            <p className="text-2xl font-bold text-slate-100">{projects.filter(p => p.progress > 0 && p.progress < 100).length}</p>
          </div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-white/10 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-400 font-medium">已完成</p>
            <p className="text-2xl font-bold text-slate-100">{projects.filter(p => p.progress === 100).length}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 glass-panel p-4 rounded-xl border border-white/10 shadow-sm">
        <div className="relative w-full sm:w-96">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-500" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-lg leading-5 bg-white/5 placeholder-gray-400 focus:outline-none focus:glass-panel focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
            placeholder="搜索评测物料、发起人..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            className="block w-full pl-3 pr-10 py-2 text-base border-white/10 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-lg bg-white/5"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">所有类型</option>
            <option value="重度">重度评测 (周期/版本)</option>
            <option value="轻度">轻度评测 (快速/专项)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel rounded-xl border border-white/10 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/5">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">评测物料</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">分类/类型</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">发起人/支持</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">周期</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">进度</th>
                <th scope="col" className="relative px-6 py-3"><span className="sr-only">查看</span></th>
              </tr>
            </thead>
            <tbody className="glass-panel divide-y divide-white/10">
              {filteredProjects.map((project) => (
                <tr 
                  key={project.id} 
                  className="hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => onSelectProject(project.id)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 mr-3">
                        {getStatusIcon(project.progress)}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-100 flex items-center gap-2">
                          {project.name}
                          {getPriorityBadge(project.priority)}
                        </div>
                        <div className="text-sm text-slate-400 truncate max-w-xs" title={project.goal}>{project.goal}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-100">{project.category}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      <Badge variant={project.type.includes('重度') ? 'outline' : 'info'}>{project.type}</Badge>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-100">{project.initiator}</div>
                    <div className="text-xs text-slate-400 mt-1">支持: {project.support.join(', ')}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                    {project.cycle}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-24">
                        <ProgressBar progress={project.progress} />
                      </div>
                      <span className="text-sm font-medium text-slate-200">{project.progress}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-indigo-600 hover:text-indigo-900 flex items-center justify-end w-full">
                      详情 <ChevronRight className="w-4 h-4 ml-1" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProjects.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              没有找到匹配的评测物料
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
