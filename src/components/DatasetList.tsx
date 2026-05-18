import React, { useState, useEffect } from 'react';
import { Dataset } from '../types';
import { Badge } from './Badge';
import { Database, Search, Plus, FileText, Image, Music, Video, X, Loader2 } from 'lucide-react';
import { db, auth } from '../auth';
import { collection, addDoc, query, orderBy, onSnapshot } from '../datastore';

export function DatasetList({ datasets: initialDatasets }: { datasets: Dataset[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>(initialDatasets);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: '纯文本',
    size: ''
  });

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'datasets'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Dataset[];
      if (fetched.length > 0) {
        setDatasets(fetched);
      }
    }, (error) => {
      console.error("Error fetching datasets:", error);
    });
    return () => unsubscribe();
  }, []);

  const filtered = datasets.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const getIcon = (type: string) => {
    if (type.includes('图') || type.includes('视觉')) return <Image className="w-5 h-5 text-blue-500" />;
    if (type.includes('音')) return <Music className="w-5 h-5 text-purple-500" />;
    if (type.includes('视')) return <Video className="w-5 h-5 text-red-500" />;
    return <FileText className="w-5 h-5 text-emerald-500" />;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUser = auth.currentUser;
    setIsLoading(true);
    try {
      await addDoc(collection(db, 'datasets'), {
        ...formData,
        creatorUid: currentUser.uid,
        creatorName: currentUser.displayName || 'Unknown',
        createdAt: Date.now()
      });
      setIsModalOpen(false);
      setFormData({ name: '', description: '', type: '纯文本', size: '' });
    } catch (error) {
      console.error("Error adding dataset:", error);
      alert("创建评测集失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center">
          <Database className="w-6 h-6 mr-2 text-indigo-500" />
          评测集管理
        </h1>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center transition-colors"
        >
          <Plus className="w-4 h-4 mr-1" /> 新建/上传评测集
        </button>
      </div>

      <div className="glass-panel p-4 rounded-xl border border-white/10 shadow-sm flex items-center">
        <Search className="w-5 h-5 text-slate-400 mr-2" />
        <input
          type="text"
          placeholder="搜索评测集名称或描述..."
          className="w-full bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(ds => (
          <div key={ds.id} className="glass-panel p-6 rounded-xl border border-white/10 shadow-sm hover:shadow-lg transition-shadow cursor-pointer hover:border-indigo-400/50">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                  {getIcon(ds.type)}
                </div>
                <h3 className="font-semibold text-slate-100">{ds.name}</h3>
              </div>
              <Badge variant="outline">{ds.type}</Badge>
            </div>
            <p className="text-sm text-slate-400 mb-4 h-10 line-clamp-2">{ds.description}</p>
            <div className="flex justify-between items-center text-sm border-t border-white/10 pt-4">
              <span className="text-slate-400">数据量: <span className="font-medium text-slate-200">{ds.size}</span></span>
              <button onClick={() => alert('详情功能开发中...')} className="text-indigo-400 hover:text-indigo-300 font-medium focus:outline-none">查看详情</button>
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          没有找到匹配的评测集
        </div>
      )}

      {/* Create Dataset Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-panel rounded-2xl w-full max-w-md overflow-hidden shadow-xl animate-in zoom-in-95 duration-200 border border-white/10">
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-100">新建/上传评测集</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">评测集名称</label>
                <input
                  required
                  type="text"
                  className="w-full px-3 py-2 glass-input rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm text-slate-200 placeholder-slate-500"
                  placeholder="例如：通用多模态理解测试集 v2.0"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">描述</label>
                <textarea
                  required
                  className="w-full px-3 py-2 glass-input rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm h-20 resize-none text-slate-200 placeholder-slate-500"
                  placeholder="简要描述该评测集的用途、来源等"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">类型</label>
                  <select
                    className="w-full px-3 py-2 glass-input rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm text-slate-200"
                    value={formData.type}
                    onChange={e => setFormData({...formData, type: e.target.value})}
                  >
                    <option value="纯文本" className="bg-black/40">纯文本</option>
                    <option value="图文QA" className="bg-black/40">图文QA</option>
                    <option value="图像" className="bg-black/40">图像</option>
                    <option value="视频" className="bg-black/40">视频</option>
                    <option value="音频" className="bg-black/40">音频</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">数据量</label>
                  <input
                    required
                    type="text"
                    className="w-full px-3 py-2 glass-input rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm text-slate-200 placeholder-slate-500"
                    placeholder="例如：1000"
                    value={formData.size}
                    onChange={e => setFormData({...formData, size: e.target.value})}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 rounded-lg transition-colors border border-white/10"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  确认创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
