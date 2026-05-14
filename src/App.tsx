/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ModelEvalApp } from './components/ModelEvalApp';
import { LayoutDashboard } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen font-sans text-slate-200">
      {/* Navigation Bar */}
      <nav className="glass-panel border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center gap-2 cursor-pointer">
                <div className="w-8 h-8 bg-gradient-accent rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <LayoutDashboard className="w-5 h-5 text-black" />
                </div>
                <span className="font-bold text-xl tracking-tight text-white">EvalTrack</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-slate-200 font-bold text-sm">
                我
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <ModelEvalApp initialRoute="dashboard" />
    </div>
  );
}
