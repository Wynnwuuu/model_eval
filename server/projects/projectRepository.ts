import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { EvaluationProject, EvaluationStep } from '../../src/types.ts';
import type { RequestUser } from '../auth/context.ts';
import { dbPool } from '../db/client.ts';

type ProjectRow = {
  id: string;
  name: string;
  category: EvaluationProject['category'];
  priority: EvaluationProject['priority'];
  type: EvaluationProject['type'];
  goal: string;
  cycle: string;
  progress: number;
  result_summary: string | null;
  analysis: string | null;
  link: string | null;
  dataset_ids_json: string[] | null;
  support_json: string[] | null;
  dimensions_json: EvaluationProject['dimensions'] | null;
  generated_data_status: string | null;
  source_json: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
};

type StepRow = {
  id: string;
  project_id: string;
  step_order: number;
  name: string;
  owner_label: string | null;
  status: EvaluationStep['status'];
  execution_type: EvaluationStep['executionType'] | null;
  result_note: string | null;
  material_file_json: EvaluationStep['materialFile'] | null;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return Date.now();
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const mapProject = (row: ProjectRow, steps: StepRow[]): EvaluationProject => {
  const source = row.source_json || {};
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    priority: row.priority,
    type: row.type,
    initiatorUid: source.initiatorUid,
    initiatorName: source.initiatorName,
    goal: row.goal,
    cycle: row.cycle,
    support: row.support_json || [],
    progress: row.progress,
    steps: steps
      .filter(step => step.project_id === row.id)
      .sort((a, b) => a.step_order - b.step_order)
      .map(step => ({
        id: step.step_order,
        name: step.name,
        owner: step.owner_label || '待分配',
        status: step.status,
        executionType: step.execution_type || undefined,
        resultNote: step.result_note || undefined,
        materialFile: step.material_file_json || undefined,
      })),
    resultSummary: row.result_summary || '待产出',
    link: row.link || '',
    datasetIds: row.dataset_ids_json || [],
    dimensions: row.dimensions_json || [],
    generatedDataStatus: row.generated_data_status || '未开始',
    analysis: row.analysis || '暂无',
    createdAt: toTimestamp(row.created_at),
    lastUpdated: toTimestamp(row.updated_at),
  };
};

const insertSteps = async (
  client: Pool | PoolClient,
  projectId: string,
  steps: EvaluationStep[] = []
) => {
  for (const step of steps) {
    await client.query(
      `
        INSERT INTO project_steps (
          id,
          project_id,
          step_order,
          name,
          owner_label,
          status,
          execution_type,
          result_note,
          material_file_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [
        `${projectId}:${step.id}`,
        projectId,
        step.id,
        step.name,
        step.owner,
        step.status,
        step.executionType || null,
        step.resultNote || null,
        JSON.stringify(step.materialFile || {}),
      ]
    );
  }
};

export const listProjects = async (): Promise<EvaluationProject[]> => {
  const [projectResult, stepResult] = await Promise.all([
    dbPool.query<ProjectRow>(`
      SELECT *
      FROM projects
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `),
    dbPool.query<StepRow>(`
      SELECT *
      FROM project_steps
      ORDER BY project_id, step_order
    `),
  ]);

  return projectResult.rows.map(project => mapProject(project, stepResult.rows));
};

export const getProject = async (projectId: string): Promise<EvaluationProject | null> => {
  const [projectResult, stepResult] = await Promise.all([
    dbPool.query<ProjectRow>(
      `
        SELECT *
        FROM projects
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [projectId]
    ),
    dbPool.query<StepRow>(
      `
        SELECT *
        FROM project_steps
        WHERE project_id = $1
        ORDER BY step_order
      `,
      [projectId]
    ),
  ]);

  const project = projectResult.rows[0];
  return project ? mapProject(project, stepResult.rows) : null;
};

export const createProject = async (
  project: Partial<EvaluationProject>,
  user: RequestUser
): Promise<EvaluationProject> => {
  const id = project.id || randomUUID();
  const now = new Date();
  const initiatorName = user.displayName || user.email || 'Anonymous';
  const sourceJson = {
    initiatorUid: user.id,
    initiatorName,
  };

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO projects (
          id,
          organization_id,
          name,
          category,
          priority,
          type,
          goal,
          cycle,
          progress,
          result_summary,
          analysis,
          link,
          dataset_ids_json,
          support_json,
          dimensions_json,
          generated_data_status,
          source_json,
          created_at,
          updated_at
        )
        VALUES (
          $1, $18, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb,
          $15, $16::jsonb, $17, $17
        )
      `,
      [
        id,
        project.name || '未命名项目',
        project.category || '产品上游模型能力评测',
        project.priority || 'P1',
        project.type || '轻度评测 (快速/专项)',
        project.goal || '',
        project.cycle || '',
        project.progress ?? 0,
        project.resultSummary || '待产出',
        project.analysis || '暂无',
        project.link || '',
        JSON.stringify(project.datasetIds || []),
        JSON.stringify(project.support || []),
        JSON.stringify(project.dimensions || []),
        project.generatedDataStatus || '未开始',
        JSON.stringify(sourceJson),
        now,
        user.organizationId,
      ]
    );
    await insertSteps(client, id, project.steps || []);
    await client.query(
      `
        INSERT INTO project_members (project_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (project_id, user_id) DO UPDATE SET
          role = EXCLUDED.role,
          updated_at = now()
      `,
      [id, user.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const created = await getProject(id);
  if (!created) throw new Error('Created project was not found');
  return created;
};

export const updateProject = async (
  projectId: string,
  patch: Partial<EvaluationProject>
): Promise<EvaluationProject | null> => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    const assignments: string[] = [];
    const values: any[] = [];
    const add = (column: string, value: any, cast?: string) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}${cast ? `::${cast}` : ''}`);
    };

    if (patch.name !== undefined) add('name', patch.name);
    if (patch.category !== undefined) add('category', patch.category);
    if (patch.priority !== undefined) add('priority', patch.priority);
    if (patch.type !== undefined) add('type', patch.type);
    if (patch.goal !== undefined) add('goal', patch.goal);
    if (patch.cycle !== undefined) add('cycle', patch.cycle);
    if (patch.progress !== undefined) add('progress', patch.progress);
    if (patch.resultSummary !== undefined) add('result_summary', patch.resultSummary);
    if (patch.analysis !== undefined) add('analysis', patch.analysis);
    if (patch.link !== undefined) add('link', patch.link);
    if (patch.datasetIds !== undefined) add('dataset_ids_json', JSON.stringify(patch.datasetIds), 'jsonb');
    if (patch.support !== undefined) add('support_json', JSON.stringify(patch.support), 'jsonb');
    if (patch.dimensions !== undefined) add('dimensions_json', JSON.stringify(patch.dimensions), 'jsonb');
    if (patch.generatedDataStatus !== undefined) add('generated_data_status', patch.generatedDataStatus);

    if (assignments.length > 0) {
      values.push(projectId);
      await client.query(
        `
          UPDATE projects
          SET ${assignments.join(', ')}, updated_at = now()
          WHERE id = $${values.length} AND deleted_at IS NULL
        `,
        values
      );
    }

    if (patch.steps !== undefined) {
      await client.query('DELETE FROM project_steps WHERE project_id = $1', [projectId]);
      await insertSteps(client, projectId, patch.steps);
      await client.query('UPDATE projects SET updated_at = now() WHERE id = $1 AND deleted_at IS NULL', [projectId]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getProject(projectId);
};

export const deleteProject = async (projectId: string): Promise<boolean> => {
  const result = await dbPool.query(
    `
      UPDATE projects
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [projectId]
  );
  return (result.rowCount || 0) > 0;
};
