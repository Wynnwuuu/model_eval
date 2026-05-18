import { Router } from 'express';

import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from './templateRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { requireBodyObject, validateTemplatePayload } from '../http/validation.ts';

export const templateRoutes = Router();

templateRoutes.get('/', async (_req, res) => {
  try {
    res.json({ templates: await listTemplates() });
  } catch (error) {
    sendError(res, error, 'Failed to list templates');
  }
});

templateRoutes.get('/:templateId', async (req, res) => {
  try {
    const template = await getTemplate(req.params.templateId);
    if (!template) {
      throw notFound('Template');
    }
    res.json({ template });
  } catch (error) {
    sendError(res, error, 'Failed to load template');
  }
});

templateRoutes.put('/:templateId', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'template');
    validateTemplatePayload(payload);
    const template = await saveTemplate({ ...payload, id: req.params.templateId } as any);
    res.json({ template });
  } catch (error) {
    sendError(res, error, 'Failed to save template');
  }
});

templateRoutes.delete('/:templateId', async (req, res) => {
  try {
    const deleted = await deleteTemplate(req.params.templateId);
    if (!deleted) {
      throw notFound('Template');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete template');
  }
});
