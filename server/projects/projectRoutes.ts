import { Router } from 'express';

import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from './projectRepository.ts';

export const projectRoutes = Router();

projectRoutes.get('/', async (_req, res) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list projects';
    res.status(500).json({ error: message });
  }
});

projectRoutes.get('/:projectId', async (req, res) => {
  try {
    const project = await getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load project';
    res.status(500).json({ error: message });
  }
});

projectRoutes.post('/', async (req, res) => {
  try {
    const project = await createProject(req.body.project || {}, req.body.user || {});
    res.status(201).json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create project';
    res.status(500).json({ error: message });
  }
});

projectRoutes.patch('/:projectId', async (req, res) => {
  try {
    const project = await updateProject(req.params.projectId, req.body.patch || {});
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update project';
    res.status(500).json({ error: message });
  }
});

projectRoutes.delete('/:projectId', async (req, res) => {
  try {
    const deleted = await deleteProject(req.params.projectId);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete project';
    res.status(500).json({ error: message });
  }
});
