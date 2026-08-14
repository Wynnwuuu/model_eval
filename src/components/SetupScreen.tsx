import React, { useState, useEffect } from 'react';
import { safeGetStorageItem, safeSetStorageItem } from '../safeBrowserStorage';
import { Play, Info, AlertTriangle, Download, FileSpreadsheet, Command, PieChart, User, RotateCcw, ArrowRight, History } from 'lucide-react';
import Papa from 'papaparse';
import { EvaluationItem, EvaluationProject } from '../types';
import { SAMPLE_CSV } from '../constants';

interface SetupScreenProps {
  project: EvaluationProject | null;
  onStart: (items: EvaluationItem[], userName: string, modelNames?: { a: string, b: string }) => void;
  onGoToAnalysis: () => void;
  onGoToHistory: () => void;
  onBack: () => void;
  savedSession?: boolean;
  onResume?: () => void;
  onDiscardSession?: () => void;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ 
  project,
  onStart, 
  onGoToAnalysis, 
  onGoToHistory,
  onBack,
  savedSession, 
  onResume,
  onDiscardSession 
}) => {
  const [inputText, setInputText] = useState('');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Try to pre-fill name from local storage
    const savedName = safeGetStorageItem(localStorage, 'eval_username', { report: false }).value;
    if (savedName) setUserName(savedName);
  }, []);

  const isUrl = (str: string) => {
    if (!str) return false;
    const s = str.trim().toLowerCase();
    
    // Basic protocol checks
    if (/^(https?|data|blob|gs|s3|file):/i.test(s)) return true;
    if (s.startsWith('www.')) return true;
    if (s.startsWith('//')) return true;
    if (s.startsWith('./') || s.startsWith('../') || s.startsWith('/')) return true;
    
    // Extension check (ignoring query params)
    const urlWithoutQuery = s.split('?')[0];
    if (/\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|avi|mkv)$/i.test(urlWithoutQuery)) return true;

    // General domain check (e.g., example.com/image)
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(urlWithoutQuery)) return true;

    return false;
  };

  const parseInput = (text: string) => {
    const items: EvaluationItem[] = [];
    let modelNames = { a: 'Model A', b: 'Model B' };

    // Use PapaParse to parse the CSV text
    let parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
    });

    let rows = parsed.data.map(row => row.map(cell => cell.trim()));

    // If every row has only 1 column, but the text contains tabs, PapaParse might have failed to detect tab.
    if (rows.length > 0 && rows.every(row => row.length === 1) && text.includes('\t')) {
      parsed = Papa.parse<string[]>(text, {
        delimiter: '\t',
        skipEmptyLines: true,
      });
      rows = parsed.data.map(row => row.map(cell => cell.trim()));
    }

    const joinChar = parsed.meta.delimiter === ',' ? ',' : ' ';

    rows.forEach((parts, index) => {
      // Remove trailing empty cells (common when copying from Excel)
      while (parts.length > 0 && parts[parts.length - 1] === '') {
        parts.pop();
      }

      if (parts.length < 2) return; 

      // --- Header Parsing Logic ---
      if (index === 0) {
        const hasUrl = parts.some(p => isUrl(p));
        if (!hasUrl) {
          // If first row has no URLs, it's likely a header.
          // Grab the last two non-empty columns as model names
          const headerParts = [...parts];
          while (headerParts.length > 0 && headerParts[headerParts.length - 1] === '') {
            headerParts.pop();
          }
          if (headerParts.length >= 2) {
             modelNames = { a: headerParts[headerParts.length - 2], b: headerParts[headerParts.length - 1] };
          }
          return; // Skip header row
        }
      }

      // --- Data Parsing Logic (Right-to-Left Strategy) ---
      // [Prompt...] [Ref...] [Ref...] [Model A] [Model B] [Optional Notes...]
      
      let modelB_Url: string | undefined;
      let modelA_Url: string | undefined;
      let modelA_Index = -1;

      // Scan from right to left to find the last two URLs
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i].replace(/^["']+|["']+$/g, '').trim();
        if (isUrl(part)) {
          if (!modelB_Url) {
            modelB_Url = part;
          } else if (!modelA_Url) {
            modelA_Url = part;
            modelA_Index = i;
            break;
          }
        }
      }
      
      // Fallback: If we couldn't find two URLs, just take the last two non-empty columns
      if (!modelA_Url || !modelB_Url) {
        let nonEmpties = [];
        let nonEmptyIndices = [];
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i].replace(/^["']+|["']+$/g, '').trim();
          if (p !== '') {
            nonEmpties.push(p);
            nonEmptyIndices.push(i);
          }
        }
        
        if (nonEmpties.length >= 2) {
          modelB_Url = nonEmpties[nonEmpties.length - 1];
          modelA_Url = nonEmpties[nonEmpties.length - 2];
          modelA_Index = nonEmptyIndices[nonEmptyIndices.length - 2];
        }
      }

      // If we STILL couldn't find two columns, this row is invalid
      if (!modelA_Url || !modelB_Url) {
        return;
      }

      // 2. Scan remaining columns for Reference URLs vs Prompt parts
      let promptParts: string[] = [];
      let referenceUrls: string[] = [];
      let startImageUrl: string | undefined = undefined;

      // Iterate all parts before Model A
      for (let i = 0; i < modelA_Index; i++) {
        let part = parts[i].replace(/^["']+|["']+$/g, '').trim();
        if (part === '') continue; // Skip empty columns
        
        // Clean up zero-width spaces that might break URL detection
        part = part.replace(/[\u200B-\u200D\uFEFF]/g, '');

        if (isUrl(part)) {
          if (!startImageUrl) {
            startImageUrl = part;
          } else {
            referenceUrls.push(part);
          }
        } else if (/^\d+(\.\d+)?$/.test(part)) {
          // It's just a number (like Duration = 10). Skip it so it doesn't pollute the prompt.
          continue;
        } else {
          // Extract any URLs that might be merged with the prompt text
          const urlsInPart = part.match(/https?:\/\/[^\s"']+/g);
          if (urlsInPart) {
            urlsInPart.forEach(u => {
              if (isUrl(u)) {
                if (!startImageUrl) {
                  startImageUrl = u;
                } else {
                  referenceUrls.push(u);
                }
                part = part.replace(u, '').trim();
              }
            });
          }
          if (part !== '') {
            promptParts.push(part); // Keep remaining text for prompt
          }
        }
      }

      // Join prompt parts
      let prompt = promptParts.join(joinChar);
      
      // Cleanup: Excel sometimes adds extra quotes around the whole block even after parsing if not careful, 
      // though our parser handles standard CSV quotes.
      // Just a final sanity trim.
      prompt = prompt.replace(/^"+|"+$/g, '').trim(); 

      const item: EvaluationItem = {
        id: `row-${index}`,
        modelA_Url,
        modelB_Url,
        prompt: prompt || undefined,
        startImageUrl,
        referenceUrls: referenceUrls.length > 0 ? referenceUrls : undefined,
        type: 'unknown',
        // BLIND TESTING: Randomly swap A and B for display 50% of the time
        isSwapped: Math.random() > 0.5
      };

      items.push(item);
    });

    return { items, modelNames };
  };

  const handleStart = () => {
    setError(null);
    if (!inputText.trim()) {
      setError("请先在上方文本框中粘贴您的评测数据。");
      return;
    }

    const { items, modelNames } = parseInput(inputText);

    if (items.length === 0) {
      setError("无法识别有效的数据行。请确保您的数据包含有效的 URL。");
      return;
    }

    // Default to 'Anonymous' if empty
    const finalName = userName.trim() || "Anonymous";

    // Save name for next time
    safeSetStorageItem(localStorage, 'eval_username', finalName);
    onStart(items, finalName, modelNames);
  };

  const downloadConfig = () => {
    if (!inputText.trim()) {
      setError("没有可备份的数据，请先粘贴数据。");
      return;
    }
    const blob = new Blob([inputText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `eval_data_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadSample = () => {
    setInputText(SAMPLE_CSV);
    setError(null);
  };

  if (savedSession) {
    return (
      <div className="max-w-2xl mx-auto p-6 animate-in zoom-in-95 duration-300 flex flex-col items-center justify-center h-full">
        <div className="glass-panel rounded-3xl shadow-xl border border-white/10 p-8 w-full text-center">
          <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={40} />
          </div>
          
          <h2 className="text-2xl font-bold text-slate-100 mb-2">发现未完成的评测</h2>
          <p className="text-slate-400 mb-8">
            看起来您的浏览器意外刷新或关闭了。<br/>
            我们已保存您的进度。您想继续上次的评测吗？
          </p>

          <div className="flex flex-col gap-3">
            <button 
              onClick={onResume}
              className="w-full py-4 bg-blue-500/20 hover:bg-blue-500/30 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-2"
            >
              <Play size={24} fill="currentColor" />
              继续评测
            </button>
            
            <button 
              onClick={onDiscardSession}
              className="w-full py-3 glass-panel glass-panel-hover text-slate-400 hover:text-red-600 border border-white/10 hover:border-red-200 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} />
              放弃并重新开始
            </button>
          </div>
        </div>
        <p className="mt-8 text-slate-400 text-sm">您的进度安全地保存在本地浏览器中。</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col py-12">
      
      {/* Header Section */}
      <div className="text-center mb-8 relative">
        <button 
          onClick={onBack}
          className="absolute left-0 top-0 glass-panel glass-panel-hover text-slate-300 px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors border border-white/10"
        >
          <ArrowRight className="rotate-180" size={16} /> 返回大盘
        </button>
        <h1 className="text-3xl font-bold text-slate-100 mb-2 tracking-tight">参与评测</h1>
        <p className="text-slate-400 max-w-2xl mx-auto">
          单人模式：粘贴数据并开始投票。<br/> 团队模式：收集所有人的 CSV 结果并使用分析大盘。
        </p>
        
        <div className="flex justify-center gap-4 mt-6">
          <button 
            onClick={onGoToHistory}
            className="glass-panel glass-panel-hover text-slate-200 px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors border border-white/10"
          >
            <History size={16} /> 历史记录
          </button>
          <button 
            onClick={onGoToAnalysis}
            className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors border border-indigo-500/30"
          >
            <PieChart size={16} /> 打开分析大盘
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Input Area */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="glass-panel rounded-2xl shadow-xl shadow-black/20 border border-white/10 overflow-hidden flex flex-col h-full transition-all">
            
            <div className="px-6 py-4 border-b border-white/10 bg-white/5 flex items-center gap-4">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                <User size={18} />
                <span>您的姓名 <span className="text-slate-400 font-normal text-xs">(可选)</span>:</span>
              </div>
              <input 
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="例如：张三 (默认: 匿名)"
                className="flex-1 px-3 py-1.5 border border-white/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex-1 relative min-h-[300px]">
              <textarea
                className="w-full h-full p-6 glass-panel font-mono text-sm leading-relaxed resize-none focus:outline-none text-slate-200 placeholder:text-slate-300"
                placeholder={`在此处粘贴您的数据（推荐从 Excel 复制粘贴）。\n\n解析规则：\n1. 支持多行 Prompt（如果在 Excel 中换行，会自动处理）。\n2. 最后两列 = 模型 URL。\n3. 中间的列 = 参考图 URL。\n4. 第一列 = Prompt。\n\n*注意：在投票期间，"模型 A" 和 "模型 B" 的位置会随机交换以进行盲测。`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                spellCheck={false}
              />
              {inputText.length === 0 && (
                <button 
                  onClick={loadSample}
                  className="absolute bottom-6 right-6 text-slate-400 hover:text-blue-600 text-xs font-medium flex items-center gap-1 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 hover:border-blue-200 transition-all"
                >
                  <Info size={14} /> 填入示例数据
                </button>
              )}
            </div>

            {error && (
              <div className="px-6 py-3 bg-red-50 border-t border-red-100 text-red-600 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="bg-white/5 px-6 py-4 border-t border-white/10 flex justify-between items-center">
              <button
                onClick={downloadConfig}
                className="text-slate-400 hover:text-slate-100 text-sm font-medium flex items-center gap-2 px-2 py-1 rounded transition-colors"
              >
                <Download size={16} />
                <span>备份输入数据</span>
              </button>

              <button
                onClick={handleStart}
                className="flex items-center gap-2 bg-black/40 hover:glass-panel/5 text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-slate-900/10 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <span>开始评测</span>
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Guide / Visual Helper */}
        <div className="lg:col-span-4 flex flex-col justify-start">
          <div className="glass-panel rounded-2xl border border-white/10 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <FileSpreadsheet className="text-green-600" size={20} />
              数据输入格式示例
            </h3>
            
            <p className="text-sm text-slate-300 mb-4">
              您可以直接从 Excel 或 CSV 中复制数据并粘贴到左侧的输入框中。系统会自动解析。
            </p>

            <div className="space-y-6">
              
              <div className="group">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">标准格式 (推荐)</div>
                <div className="border border-white/10 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 border-b border-white/10">
                      <tr>
                        <th className="px-3 py-2 font-medium text-slate-400 border-r border-white/10">A (Prompt)</th>
                        <th className="px-3 py-2 font-medium text-slate-400 border-r border-white/10">B (参考图)</th>
                        <th className="px-3 py-2 font-medium text-blue-600 border-r border-white/10">C (模型A)</th>
                        <th className="px-3 py-2 font-medium text-blue-600">D (模型B)</th>
                      </tr>
                    </thead>
                    <tbody className="glass-panel">
                      <tr className="border-b border-white/10">
                        <td className="px-3 py-2 text-slate-300 border-r border-white/10 truncate max-w-[80px]">一只可爱的猫...</td>
                        <td className="px-3 py-2 text-slate-400 border-r border-white/10 truncate max-w-[80px]">http://ref...</td>
                        <td className="px-3 py-2 text-blue-500 border-r border-white/10 truncate max-w-[80px]">http://mod...</td>
                        <td className="px-3 py-2 text-blue-500 truncate max-w-[80px]">http://mod...</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 text-slate-300 border-r border-white/10 truncate max-w-[80px]">未来城市夜景...</td>
                        <td className="px-3 py-2 text-slate-400 border-r border-white/10 truncate max-w-[80px]">(留空)</td>
                        <td className="px-3 py-2 text-blue-500 border-r border-white/10 truncate max-w-[80px]">http://mod...</td>
                        <td className="px-3 py-2 text-blue-500 truncate max-w-[80px]">http://mod...</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="group">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">多参考图格式</div>
                <div className="border border-white/10 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 border-b border-white/10">
                      <tr>
                        <th className="px-2 py-2 font-medium text-slate-400 border-r border-white/10">Prompt</th>
                        <th className="px-2 py-2 font-medium text-green-600 border-r border-white/10">Ref 1</th>
                        <th className="px-2 py-2 font-medium text-green-600 border-r border-white/10">Ref 2</th>
                        <th className="px-2 py-2 font-medium text-blue-600 border-r border-white/10">Model A</th>
                        <th className="px-2 py-2 font-medium text-blue-600">Model B</th>
                      </tr>
                    </thead>
                    <tbody className="glass-panel">
                      <tr>
                        <td className="px-2 py-2 text-slate-300 border-r border-white/10 truncate max-w-[60px]">生成一段...</td>
                        <td className="px-2 py-2 text-green-500 border-r border-white/10 truncate max-w-[60px]">http://...</td>
                        <td className="px-2 py-2 text-green-500 border-r border-white/10 truncate max-w-[60px]">http://...</td>
                        <td className="px-2 py-2 text-blue-500 border-r border-white/10 truncate max-w-[60px]">http://...</td>
                        <td className="px-2 py-2 text-blue-500 truncate max-w-[60px]">http://...</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-400 mt-2">系统会自动识别 Prompt 和模型 URL 之间的所有链接作为参考图。</p>
              </div>

            </div>
            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="text-xs text-slate-400 leading-relaxed">
                <Command size={12} className="inline mr-1 text-slate-400"/>
                <strong>核心规则：</strong>最后两列始终被识别为待评测的模型 A 和 B。第一列为 Prompt。中间的 URL 会被识别为参考图。支持 Excel 中的多行文本。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupScreen;
