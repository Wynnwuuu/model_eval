import { Router } from 'express';

import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from './projectRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { requireBodyObject, validateProjectPayload } from '../http/validation.ts';

export const projectRoutes = Router();

projectRoutes.get('/', async (_req, res) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (error) {
    sendError(res, error, 'Failed to list projects');
  }
});

projectRoutes.get('/:projectId', async (req, res) => {
  try {
    const project = await getProject(req.params.projectId);
    if (!project) {
      throw notFound('Project');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, error, 'Failed to load project');
  }
});

projectRoutes.post('/', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'project');
    validateProjectPayload(payload);
    const project = await createProject(payload, req.body.user || {});
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, error, 'Failed to create project');
  }
});

projectRoutes.patch('/:projectId', async (req, res) => {
  try {
    const patch = requireBodyObject(req.body, 'patch');
    const project = await updateProject(req.params.projectId, patch);
    if (!project) {
      throw notFound('Project');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, error, 'Failed to update project');
  }
});

projectRoutes.delete('/:projectId', async (req, res) => {
  try {
    const deleted = await deleteProject(req.params.projectId);
    if (!deleted) {
      throw notFound('Project');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete project');
  }
});
