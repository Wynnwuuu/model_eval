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
import { ensureProjectRole } from '../auth/projectPermissions.ts';
import { deleteProjectMember, listProjectMembers, upsertProjectMember } from '../auth/projectMembers.ts';

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

projectRoutes.get('/:projectId/members', async (req, res) => {
  try {
    await ensureProjectRole(req.user, req.params.projectId, ['owner', 'editor', 'viewer']);
    res.json({ members: await listProjectMembers(req.params.projectId) });
  } catch (error) {
    sendError(res, error, 'Failed to list project members');
  }
});

projectRoutes.put('/:projectId/members/:userId', async (req, res) => {
  try {
    await ensureProjectRole(req.user, req.params.projectId, ['owner']);
    const member = requireBodyObject(req.body, 'member');
    const saved = await upsertProjectMember(req.params.projectId, {
      ...member,
      userId: req.params.userId,
    });
    res.json({ member: saved });
  } catch (error) {
    sendError(res, error, 'Failed to save project member');
  }
});

projectRoutes.delete('/:projectId/members/:userId', async (req, res) => {
  try {
    await ensureProjectRole(req.user, req.params.projectId, ['owner']);
    const deleted = await deleteProjectMember(req.params.projectId, req.params.userId);
    if (!deleted) {
      throw notFound('Project member');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete project member');
  }
});

projectRoutes.post('/', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'project');
    validateProjectPayload(payload);
    const project = await createProject(payload, req.user);
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, error, 'Failed to create project');
  }
});

projectRoutes.patch('/:projectId', async (req, res) => {
  try {
    const patch = requireBodyObject(req.body, 'patch');
    await ensureProjectRole(req.user, req.params.projectId, ['owner', 'editor']);
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
    await ensureProjectRole(req.user, req.params.projectId, ['owner']);
    const deleted = await deleteProject(req.params.projectId);
    if (!deleted) {
      throw notFound('Project');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete project');
  }
});
