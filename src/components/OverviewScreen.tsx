import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, ClipboardCheck, Database, FileText, PlayCircle, Wand2 } from 'lucide-react';
import { DatasetGenerationJob, EvalDataset, EvalTask } from '../types';
import { collection, onSnapshot, orderBy, query } from '../datastore';
import { db, handleFirestoreError } from '../firebase';
import { DataTableShell, EmptyState, PageFrame, PageHeader, SectionPanel, StatTile, StatusBadge, Toolbar } from './ui';

interface OverviewScreenProps {
  onGoToProjects: () => void;
  onGoToDatasets: () => void;
  onGoToTasks: (statusFilter?: EvalTask['status']) => void;
  onGoToEvaluation: () => void;
  onGoToInsights: (statusFilter?: EvalTask['status']) => void;
  onGoToGeneration: () => void;
}

const taskStatusTone = (status?: string) => {
  if (status === 'active') return 'green';
  if (status === 'completed') return 'blue';
  if (status === 'draft') return 'amber';
  return 'neutral';
};

const taskStatusLabel = (status?: string) => {
  if (status === 'active') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'draft') return '草稿';
  return status || '未知';
};

const jobStatusTone = (status?: string) => {
  if (status === 'completed') return 'green';
  if (status === 'running' || status === 'queued') return 'blue';
  if (status === 'partial') return 'amber';
  if (status === 'failed' || status === 'cancelled') return 'red';
  return 'neutral';
};

const jobStatusLabel = (status?: string) => {
  if (status === 'completed') return '已完成';
  if (status === 'running') return '运行中';
  if (status === 'queued') return '排队中';
  if (status === 'partial') return '部分成功';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return status || '未知';
};

const formatDate = (value?: number) => value ? new Date(value).toLocaleString('zh-CN') : '-';

const ClickableStatTile: React.FC<{
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}> = ({ onClick, ariaLabel, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className="group w-full text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
  >
    <div className="transition group-hover:-translate-y-0.5 group-hover:brightness-110">
      {children}
    </div>
  </button>
);

const OverviewScreen: React.FC<OverviewScreenProps> = ({
  onGoToProjects,
  onGoToDatasets,
  onGoToTasks,
  onGoToEvaluation,
  onGoToInsights,
  onGoToGeneration
}) => {
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [jobs, setJobs] = useState<DatasetGenerationJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribers: Array<() => void> = [];
    try {
      unsubscribers.push(onSnapshot(query(collection(db, 'evalTasks'), orderBy('createdAt', 'desc')), snapshot => {
        setTasks(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as EvalTask)));
        setLoading(false);
      }));
      unsubscribers.push(onSnapshot(query(collection(db, 'evalDatasets'), orderBy('createdAt', 'desc')), snapshot => {
        setDatasets(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as EvalDataset)));
      }));
      unsubscribers.push(onSnapshot(query(collection(db, 'evalGenerationJobs'), orderBy('createdAt', 'desc')), snapshot => {
        setJobs(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as DatasetGenerationJob)));
      }));
    } catch (err) {
      handleFirestoreError(err, 'list', 'overview');
      setLoading(false);
    }
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, []);

  const activeTasks = tasks.filter(task => task.status === 'active');
  const draftTasks = tasks.filter(task => task.status === 'draft');
  const completedTasks = tasks.filter(task => task.status === 'completed');
  const runningJobs = jobs.filter(job => job.status === 'running' || job.status === 'queued' || job.status === 'partial');
  const datasetRows = datasets.reduce((sum, dataset) => sum + (dataset.items?.length || 0), 0);

  const taskColumns = useMemo(() => [
    {
      accessorKey: 'name',
      header: '评测物料',
      cell: ({ row }: any) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{row.original.name}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">{row.original.totalItems || 0} cases</div>
        </div>
      )
    },
    {
      accessorKey: 'status',
      header: '状态',
      cell: ({ row }: any) => <StatusBadge tone={taskStatusTone(row.original.status) as any}>{taskStatusLabel(row.original.status)}</StatusBadge>
    },
    {
      accessorKey: 'createdAt',
      header: '创建时间',
      cell: ({ row }: any) => formatDate(row.original.createdAt)
    }
  ], []);

  const jobColumns = useMemo(() => [
    {
      accessorKey: 'targetColumn',
      header: '生产列',
      cell: ({ row }: any) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{row.original.targetColumn || '-'}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">{row.original.modelConfig?.displayName || row.original.modelConfig?.id || '-'}</div>
        </div>
      )
    },
    {
      accessorKey: 'status',
      header: '状态',
      cell: ({ row }: any) => <StatusBadge tone={jobStatusTone(row.original.status) as any}>{jobStatusLabel(row.original.status)}</StatusBadge>
    },
    {
      accessorKey: 'progress',
      header: '进度',
      cell: ({ row }: any) => {
        const total = row.original.total || 0;
        const succeeded = row.original.succeeded || 0;
        const failed = row.original.failed || 0;
        return `${succeeded}/${total} 成功${failed ? `，${failed} 失败` : ''}`;
      }
    }
  ], []);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Eval Studio"
        title="运营总览"
        description="查看待处理评测、生产批次与最新结果，快速进入下一步。"
        actions={
          <>
            <button onClick={() => onGoToTasks()} className="btn-primary"><ClipboardCheck size={16} /> 新建评测物料</button>
            <button onClick={onGoToDatasets} className="btn-secondary"><Database size={16} /> 管理评测集</button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ClickableStatTile onClick={onGoToEvaluation} ariaLabel="查看进行中的评测物料并参与评测">
          <StatTile label="进行中评测物料" value={activeTasks.length} hint={`${draftTasks.length} 个草稿待发布，点击参与评测`} icon={<Activity size={18} />} tone="green" />
        </ClickableStatTile>
        <ClickableStatTile onClick={onGoToDatasets} ariaLabel="打开评测集仓库">
          <StatTile label="评测集" value={datasets.length} hint={`${datasetRows} 条 case 已归档，点击管理评测集`} icon={<Database size={18} />} tone="blue" />
        </ClickableStatTile>
        <ClickableStatTile onClick={onGoToGeneration} ariaLabel="打开生产工作台">
          <StatTile label="生产任务" value={runningJobs.length} hint={`${jobs.length} 个历史批次，点击进入生产`} icon={<Wand2 size={18} />} tone="amber" />
        </ClickableStatTile>
        <ClickableStatTile onClick={() => onGoToInsights('completed')} ariaLabel="查看已完成评测物料的结果洞察">
          <StatTile label="已完成评测物料" value={completedTasks.length} hint="点击进入项目结果洞察" icon={<BarChart3 size={18} />} tone="purple" />
        </ClickableStatTile>
      </div>

      <Toolbar className="mt-6">
        <div className="flex flex-wrap gap-2">
          <button onClick={onGoToEvaluation} className="btn-secondary"><PlayCircle size={16} /> 参与评测</button>
          <button onClick={onGoToGeneration} className="btn-secondary"><Wand2 size={16} /> 批量生产</button>
          <button onClick={() => onGoToInsights()} className="btn-secondary"><BarChart3 size={16} /> 打开结果洞察</button>
        </div>
        <button onClick={onGoToProjects} className="text-sm font-medium text-[var(--accent)] hover:text-white">查看全部项目</button>
      </Toolbar>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <SectionPanel title="最近评测物料" description="关注待执行、进行中和刚完成的可执行评测配置。">
          {loading || tasks.length ? (
            <DataTableShell data={tasks.slice(0, 8)} columns={taskColumns as any} searchPlaceholder="搜索评测物料..." emptyTitle="暂无评测物料" />
          ) : (
            <EmptyState icon={<FileText size={32} />} title="暂无评测物料" description="从评测物料页面创建可执行评测配置后，这里会显示最近状态。" />
          )}
        </SectionPanel>

        <SectionPanel title="生产任务状态" description="评测集内批量生成图像、视频或音频的最近批次。">
          {jobs.length ? (
            <DataTableShell data={jobs.slice(0, 6)} columns={jobColumns as any} searchPlaceholder="搜索生产任务..." emptyTitle="暂无生产任务" />
          ) : (
            <EmptyState icon={<Wand2 size={32} />} title="暂无生产任务" description="进入评测集仓库选择数据集后，可批量生产模型输出列。" action={<button onClick={onGoToGeneration} className="btn-primary">前往生产</button>} />
          )}
        </SectionPanel>
      </div>
    </PageFrame>
  );
};

export default OverviewScreen;
