import type { EvalDimension, EvalTemplate } from '../../src/types.ts';
import { dbPool } from '../db/client.ts';

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  paradigm: EvalTemplate['paradigm'];
  created_at: Date;
};

type TemplateDimensionRow = {
  id: string;
  template_id: string;
  dimension_order: number;
  name: string;
  description: string | null;
  type: EvalDimension['type'];
  weight: string | null;
  required: boolean;
  options_json: string[] | null;
  scale_json: EvalDimension['scale'] | null;
  scope: EvalDimension['scope'] | null;
  aggregation_role: EvalDimension['aggregationRole'] | null;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return Date.now();
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const mapTemplate = (row: TemplateRow, dimensions: TemplateDimensionRow[]): EvalTemplate => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  paradigm: row.paradigm,
  dimensions: dimensions
    .filter(dimension => dimension.template_id === row.id)
    .sort((a, b) => a.dimension_order - b.dimension_order)
    .map(dimension => ({
      id: dimension.id,
      name: dimension.name,
      description: dimension.description || '',
      type: dimension.type,
      options: dimension.options_json || undefined,
      weight: dimension.weight == null ? undefined : Number(dimension.weight),
      required: dimension.required,
      scale: dimension.scale_json || undefined,
      scope: dimension.scope || undefined,
      aggregationRole: dimension.aggregation_role || undefined,
    })),
  createdAt: toTimestamp(row.created_at),
});

export const listTemplates = async (): Promise<EvalTemplate[]> => {
  const [templateResult, dimensionResult] = await Promise.all([
    dbPool.query<TemplateRow>(`
      SELECT *
      FROM templates
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `),
    dbPool.query<TemplateDimensionRow>(`
      SELECT *
      FROM template_dimensions
      ORDER BY template_id, dimension_order
    `),
  ]);

  return templateResult.rows.map(template => mapTemplate(template, dimensionResult.rows));
};

export const getTemplate = async (templateId: string): Promise<EvalTemplate | null> => {
  const [templateResult, dimensionResult] = await Promise.all([
    dbPool.query<TemplateRow>(
      `
        SELECT *
        FROM templates
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [templateId]
    ),
    dbPool.query<TemplateDimensionRow>(
      `
        SELECT *
        FROM template_dimensions
        WHERE template_id = $1
        ORDER BY dimension_order
      `,
      [templateId]
    ),
  ]);

  const template = templateResult.rows[0];
  return template ? mapTemplate(template, dimensionResult.rows) : null;
};

export const saveTemplate = async (template: EvalTemplate): Promise<EvalTemplate> => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO templates (
          id,
          organization_id,
          name,
          description,
          paradigm,
          config_json,
          created_at,
          updated_at
        )
        VALUES ($1, 'default', $2, $3, $4, '{}'::jsonb, to_timestamp($5 / 1000.0), now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          paradigm = EXCLUDED.paradigm,
          updated_at = now(),
          deleted_at = NULL
      `,
      [template.id, template.name, template.description || '', template.paradigm, template.createdAt || Date.now()]
    );

    await client.query('DELETE FROM template_dimensions WHERE template_id = $1', [template.id]);

    for (const [index, dimension] of template.dimensions.entries()) {
      await client.query(
        `
          INSERT INTO template_dimensions (
            id,
            template_id,
            dimension_order,
            name,
            description,
            type,
            weight,
            required,
            options_json,
            scale_json,
            scope,
            aggregation_role
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
        `,
        [
          dimension.id,
          template.id,
          index,
          dimension.name,
          dimension.description || '',
          dimension.type,
          dimension.weight ?? null,
          dimension.required ?? false,
          JSON.stringify(dimension.options || []),
          JSON.stringify(dimension.scale || []),
          dimension.scope || null,
          dimension.aggregationRole || null,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const saved = await getTemplate(template.id);
  if (!saved) throw new Error('Saved template was not found');
  return saved;
};

export const deleteTemplate = async (templateId: string): Promise<boolean> => {
  const result = await dbPool.query(
    `
      UPDATE templates
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [templateId]
  );
  return (result.rowCount || 0) > 0;
};
