import { Router } from 'express';

import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from './templateRepository.ts';

export const templateRoutes = Router();

templateRoutes.get('/', async (_req, res) => {
  try {
    res.json({ templates: await listTemplates() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list templates';
    res.status(500).json({ error: message });
  }
});

templateRoutes.get('/:templateId', async (req, res) => {
  try {
    const template = await getTemplate(req.params.templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ template });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load template';
    res.status(500).json({ error: message });
  }
});

templateRoutes.put('/:templateId', async (req, res) => {
  try {
    const template = await saveTemplate({ ...req.body.template, id: req.params.templateId });
    res.json({ template });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save template';
    res.status(500).json({ error: message });
  }
});

templateRoutes.delete('/:templateId', async (req, res) => {
  try {
    const deleted = await deleteTemplate(req.params.templateId);
    if (!deleted) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete template';
    res.status(500).json({ error: message });
  }
});
