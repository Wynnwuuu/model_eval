/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SimpleAudioEvaluation from './components/SimpleAudioEvaluation';
import datasetSource from './data/evaluation.json';
import { validateSimpleDataset } from './simpleEvaluation';

export default function App() {
  try {
    const dataset = validateSimpleDataset(datasetSource);
    return <SimpleAudioEvaluation key={dataset.id} dataset={dataset} />;
  } catch (error) {
    return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-bold">音频评审暂不可用</h1><p role="alert" className="mt-4 text-amber-200">{error instanceof Error ? error.message : '请检查内置数据。'}</p></main>;
  }
}
