/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SimpleAudioEvaluation from './components/SimpleAudioEvaluation';
import ModelComparison from './components/ModelComparison';
import datasetSource from './data/evaluation.json';
import comparisonSource from './data/model-comparison.json';
import { validateSimpleDataset } from './simpleEvaluation';
import { validateComparisonDataset } from './modelComparison';

export default function App() {
  try {
    if (new URL(window.location.href).searchParams.get('view') === 'blind') {
      const dataset = validateSimpleDataset(datasetSource);
      return <><nav aria-label="返回已确认结果" className="border-b border-white/10 px-4 py-2 text-center text-xs text-slate-400">此入口为独立盲评。<a href={import.meta.env.BASE_URL} className="ml-2 text-amber-300 underline underline-offset-4">查看已确认的 30 题结果</a></nav><SimpleAudioEvaluation key={dataset.id} dataset={dataset} /></>;
    }
    const dataset = validateComparisonDataset(comparisonSource);
    return <ModelComparison key={dataset.id} dataset={dataset} />;
  } catch (error) {
    return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-bold">音频评审暂不可用</h1><p role="alert" className="mt-4 text-amber-200">{error instanceof Error ? error.message : '请检查内置数据。'}</p></main>;
  }
}
