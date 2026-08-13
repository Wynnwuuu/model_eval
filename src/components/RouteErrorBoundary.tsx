import React from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
  resetKey: string;
  routeLabel?: string;
  onBack: () => void;
  backLabel: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends React.Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  declare readonly props: Readonly<RouteErrorBoundaryProps>;
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Route render failed:', error, info);
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      (this as any).setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="border border-red-500/30 bg-[var(--surface-panel)] p-8 text-center">
          <AlertTriangle size={38} className="mx-auto text-red-400" />
          <h1 className="mt-5 text-xl font-semibold text-white">
            {this.props.routeLabel ? `${this.props.routeLabel}加载失败` : '页面加载失败'}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
            页面内容发生异常，但导航和账号状态仍然可用。可以重新加载当前页面，或返回安全入口继续操作。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => window.location.reload()} className="btn-primary">
              <RefreshCw size={16} /> 重新加载页面
            </button>
            <button type="button" onClick={this.props.onBack} className="btn-secondary">
              <ArrowLeft size={16} /> {this.props.backLabel}
            </button>
          </div>
          <details className="mx-auto mt-6 max-w-2xl border-t border-white/10 pt-4 text-left">
            <summary className="cursor-pointer text-xs font-medium text-slate-400">技术信息</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-red-200/80">
              {this.state.error.message || 'Unknown render error'}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export const RouteContent: React.FC<{ render: () => React.ReactNode }> = ({ render }) => <>{render()}</>;
