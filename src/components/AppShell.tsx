import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileClock,
  Home,
  Layers,
  LayoutTemplate,
  LogIn,
  LogOut,
  Menu,
  PlayCircle,
  Trash2,
  Wand2,
  X
} from 'lucide-react';
import { AppRoute, NavItem } from '../types';

interface AppShellProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  children: React.ReactNode;
  user?: any;
  usesCloudAuth?: boolean;
  onSignIn?: () => void;
  onLogout?: () => void;
  onClearLocalSession?: () => void;
  hasSavedSession?: boolean;
  focusMode?: boolean;
  contextTitle?: string;
}

const iconMap = {
  overview: Home,
  projects: Layers,
  datasets: Database,
  generation: Wand2,
  templates: LayoutTemplate,
  tasks: ClipboardCheck,
  evaluation: PlayCircle,
  insights: BarChart3,
  history: FileClock
};

const navItems: NavItem[] = [
  { id: 'overview', label: '运营总览', icon: 'overview', route: 'overview' },
  { id: 'projects', label: '项目', icon: 'projects', route: 'projects' },
  { id: 'datasets', label: '评测集', icon: 'datasets', route: 'datasets' },
  { id: 'generation', label: '生产', icon: 'generation', route: 'generation' },
  { id: 'templates', label: 'Rubric 库', icon: 'templates', route: 'templates' },
  { id: 'tasks', label: '评测物料', icon: 'tasks', route: 'tasks' },
  { id: 'evaluation', label: '参与评测', icon: 'evaluation', route: 'evaluation' },
  { id: 'insights', label: '结果洞察', icon: 'insights', route: 'insights' },
  { id: 'history', label: '历史', icon: 'history', route: 'history' }
];

const routeTitles: Record<AppRoute, string> = {
  overview: '运营总览',
  projects: '项目',
  datasets: '评测集',
  generation: '生产',
  templates: 'Rubric 库',
  tasks: '评测物料',
  evaluation: '参与评测',
  insights: '结果洞察',
  history: '历史',
  voting: '评测执行',
  results: '单次结果'
};

const ToastIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    className={className}
    role="img"
    aria-label="吐司"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M21 58h29c3.9 0 7-3.1 7-7V32.3c4.3-1 7-4.4 7-8.6C64 5.9 20 5.9 20 23.7c0 4.2 2.7 7.6 7 8.6V51c0 3.9-2.1 7-6 7Z"
      fill="#D99538"
      stroke="#050607"
      strokeWidth="5.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M8 58h31c3.9 0 7-3.1 7-7V32.3c4.3-1 7-4.4 7-8.6C53 5.9 2 5.9 2 23.7c0 4.2 2.7 7.6 7 8.6V51c0 3.9 3.1 7 7 7Z"
      fill="#F3C56B"
      stroke="#050607"
      strokeWidth="5.9"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M12 53.2c8.4 1.1 20.2 1.2 29.4.1"
      stroke="#E5A746"
      strokeWidth="2.8"
      strokeLinecap="round"
      opacity="0.6"
    />
    <path
      d="M14.5 47.5 31.5 30M25 50.5 40 35M10.5 39.4 24.2 25.6"
      stroke="#050607"
      strokeWidth="5.4"
      strokeLinecap="round"
    />
    <path
      d="M49 32.5v18"
      stroke="#050607"
      strokeWidth="5.1"
      strokeLinecap="round"
      opacity="0.92"
    />
  </svg>
);

const SidebarContent: React.FC<{
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onClose?: () => void;
}> = ({ currentRoute, onNavigate, onClose }) => {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ main: true });
  const mainOpen = openSections.main;

  return (
    <div className="relative flex h-full flex-col">
      <div className="ark-rail-header flex items-center gap-3">
        <div className="ark-brand-mark">
          <ToastIcon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-black uppercase tracking-tight text-[#050607]">Eval Studio</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-black/55">Evaluation OS</div>
        </div>
      </div>

      <nav className="relative z-10 flex-1 overflow-y-auto px-3 pb-5" aria-label="主导航">
        <button
          type="button"
          aria-expanded={mainOpen}
          aria-controls="primary-navigation"
          onClick={() => setOpenSections(prev => ({ ...prev, main: !prev.main }))}
          className="mb-2 flex w-full items-center justify-between border-b border-black/25 px-1 py-2 font-mono text-[11px] font-black uppercase tracking-[0.18em] text-black/65 hover:text-black"
        >
          平台模块
          <span aria-hidden="true">{mainOpen ? '-' : '+'}</span>
        </button>

        {mainOpen && (
          <div id="primary-navigation" className="space-y-2">
            {navItems.map((item, index) => {
              const Icon = iconMap[item.icon as keyof typeof iconMap] || Home;
              const active = currentRoute === item.route || (currentRoute === 'results' && item.route === 'insights');

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    onNavigate(item.route);
                    onClose?.();
                  }}
                  className={`ark-rail-button ${active ? 'is-active' : ''}`}
                >
                  <Icon size={18} />
                  <span className="ark-rail-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="ark-rail-label min-w-0">
                    <strong className="truncate">{item.label}</strong>
                    <small>{item.route}</small>
                  </span>
                  {item.badge && <span className="sr-only">，{item.badge}</span>}
                </button>
              );
            })}
          </div>
        )}
      </nav>
    </div>
  );
};

const AppShell: React.FC<AppShellProps> = ({
  currentRoute,
  onNavigate,
  children,
  user,
  usesCloudAuth,
  onSignIn,
  onLogout,
  onClearLocalSession,
  hasSavedSession,
  focusMode,
  contextTitle
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const title = useMemo(() => contextTitle || routeTitles[currentRoute] || 'Eval Studio', [contextTitle, currentRoute]);
  const userLabel = user?.displayName || user?.email || 'Local Tester';
  const initial = String(userLabel || 'L').slice(0, 1).toUpperCase();
  const workspaceLabel = usesCloudAuth ? '在线账号' : '本地测试用户';

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  if (focusMode) {
    return (
      <div className="ark-operation-shell min-h-screen text-[var(--text-primary)]">
        <div className="ark-operation-topbar px-4 py-3">
          <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-3">
            <button onClick={() => onNavigate('overview')} className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white">
              <ToastIcon size={18} className="text-[var(--accent)]" /> Eval Studio
            </button>
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent-cold)]">{title}</div>
          </div>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="ark-shell min-h-screen text-[var(--text-primary)]">
      <aside className="ark-side-terminal fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <SidebarContent currentRoute={currentRoute} onNavigate={onNavigate} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/78" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />
          <div className="ark-side-terminal relative h-full w-72 shadow-2xl">
            <button
              type="button"
              aria-label="关闭导航"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 z-20 border border-black/20 bg-white/40 p-2 text-black/70 hover:bg-[var(--accent)] hover:text-black"
            >
              <X size={18} />
            </button>
            <SidebarContent currentRoute={currentRoute} onNavigate={onNavigate} onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="ark-topbar">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="打开导航"
                onClick={() => setMobileOpen(true)}
                className="border border-white/15 bg-white/5 p-2 text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-white lg:hidden"
              >
                <Menu size={20} />
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-black uppercase tracking-wide text-white">{title}</div>
                <div className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  评测集 / 生产 / 参与评测 / 结果洞察一体化工作台
                </div>
              </div>
            </div>

            <div className="relative flex items-center gap-3" ref={accountRef}>
              <button
                type="button"
                onClick={() => setAccountOpen(open => !open)}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                className="flex items-center gap-3 border border-white/15 bg-white/5 px-2.5 py-2 text-left transition hover:border-[var(--accent)] hover:bg-white/10"
              >
                <div className="hidden text-right sm:block">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {workspaceLabel}
                  </div>
                  <div className="max-w-48 truncate text-sm text-[var(--text-secondary)]">{userLabel}</div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center border border-[var(--border-subtle)] bg-white/5 font-mono text-sm font-black text-white">
                  {initial}
                </div>
                <ChevronDown size={15} className={`text-[var(--text-muted)] transition ${accountOpen ? 'rotate-180' : ''}`} />
              </button>

              {accountOpen && (
                <div
                  role="menu"
                  className="ark-panel absolute right-0 top-[calc(100%+10px)] z-50 w-72 p-3 text-sm shadow-2xl"
                >
                  <div className="border-b border-white/10 pb-3">
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">{workspaceLabel}</div>
                    <div className="mt-1 truncate font-semibold text-white">{userLabel}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {usesCloudAuth ? '当前使用在线账号，业务数据通过 API 保存。' : '当前使用本地测试用户。'}
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {usesCloudAuth ? (
                      user ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAccountOpen(false);
                            onLogout?.();
                          }}
                          className="flex w-full items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-left text-slate-200 hover:border-[var(--accent)] hover:text-white"
                        >
                          <LogOut size={16} /> 退出登录
                        </button>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAccountOpen(false);
                            onSignIn?.();
                          }}
                          className="btn-primary w-full"
                        >
                          <LogIn size={16} /> 登录账号
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountOpen(false);
                          onClearLocalSession?.();
                        }}
                        disabled={!hasSavedSession}
                        className="flex w-full items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-left text-slate-200 hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Trash2 size={16} /> 清除当前评测会话
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="ark-content-terminal">{children}</main>
      </div>
    </div>
  );
};

export default AppShell;
