import { Router } from 'express';

import {
  createTask,
  deleteTaskItem,
  deleteTask,
  getTask,
  getTaskCurrentUserVotes,
  getTaskUserVotes,
  listTaskItems,
  listTaskVotes,
  listTasks,
  saveTaskCurrentUserVotes,
  updateTask,
  updateTaskItem,
} from './taskRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { optionalArray, optionalNumber, requireArray, requireBodyObject, validateTaskPayload } from '../http/validation.ts';
import { ensureProjectRole, ensureTaskProjectRole } from '../auth/projectPermissions.ts';

export const taskRoutes = Router();

taskRoutes.get('/', async (req, res) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    res.json({ tasks: await listTasks({ projectId }) });
  } catch (error) {
    sendError(res, error, 'Failed to list tasks');
  }
});

taskRoutes.get('/:taskId', async (req, res) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      throw notFound('Task');
    }
    res.json({ task });
  } catch (error) {
    sendError(res, error, 'Failed to load task');
  }
});

taskRoutes.get('/:taskId/items', async (req, res) => {
  try {
    res.json({ items: await listTaskItems(req.params.taskId) });
  } catch (error) {
    sendError(res, error, 'Failed to list task items');
  }
});

taskRoutes.get('/:taskId/votes', async (req, res) => {
  try {
    res.json({ userVotes: await listTaskVotes(req.params.taskId) });
  } catch (error) {
    sendError(res, error, 'Failed to list task votes');
  }
});

taskRoutes.get('/:taskId/my-votes', async (req, res) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      throw notFound('Task');
    }
    res.json({ votes: await getTaskCurrentUserVotes(req.params.taskId, req.user) });
  } catch (error) {
    sendError(res, error, 'Failed to load current user votes');
  }
});

taskRoutes.get('/:taskId/votes/:userName', async (req, res) => {
  try {
    res.json({ votes: await getTaskUserVotes(req.params.taskId, decodeURIComponent(req.params.userName)) });
  } catch (error) {
    sendError(res, error, 'Failed to load user votes');
  }
});

taskRoutes.put('/:taskId/my-votes', async (req, res) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      throw notFound('Task');
    }
    const votePayload = requireArray(req.body?.votes, 'votes');
    const progress = optionalNumber(req.body?.progress, 'progress', votePayload.length);
    const savedVotes = await saveTaskCurrentUserVotes(
      req.params.taskId,
      req.user,
      votePayload as any,
      progress
    );
    res.json({ votes: savedVotes });
  } catch (error) {
    sendError(res, error, 'Failed to save current user votes');
  }
});

taskRoutes.put('/:taskId/votes/:userName', async (req, res) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      throw notFound('Task');
    }
    const votePayload = requireArray(req.body?.votes, 'votes');
    const progress = optionalNumber(req.body?.progress, 'progress', votePayload.length);
    const savedVotes = await saveTaskCurrentUserVotes(
      req.params.taskId,
      req.user,
      votePayload as any,
      progress
    );
    res.json({ votes: savedVotes });
  } catch (error) {
    sendError(res, error, 'Failed to save user votes');
  }
});

taskRoutes.post('/', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'task');
    validateTaskPayload(payload);
    if (typeof payload.projectId === 'string' && payload.projectId) {
      await ensureProjectRole(req.user, payload.projectId, ['owner', 'editor']);
    }
    const items = optionalArray(req.body.items, 'items');
    const task = await createTask(payload as any, items as any);
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, error, 'Failed to create task');
  }
});

taskRoutes.patch('/:taskId', async (req, res) => {
  try {
    const patch = requireBodyObject(req.body, 'patch');
    await ensureTaskProjectRole(req.user, req.params.taskId, ['owner', 'editor']);
    const task = await updateTask(req.params.taskId, patch);
    if (!task) {
      throw notFound('Task');
    }
    res.json({ task });
  } catch (error) {
    sendError(res, error, 'Failed to update task');
  }
});

taskRoutes.patch('/:taskId/items/:itemId', async (req, res) => {
  try {
    const patch = requireBodyObject(req.body, 'patch');
    await ensureTaskProjectRole(req.user, req.params.taskId, ['owner', 'editor']);
    const item = await updateTaskItem(req.params.taskId, req.params.itemId, patch);
    if (!item) {
      throw notFound('Task item');
    }
    res.json({ item });
  } catch (error) {
    sendError(res, error, 'Failed to update task item');
  }
});

taskRoutes.delete('/:taskId/items/:itemId', async (req, res) => {
  try {
    await ensureTaskProjectRole(req.user, req.params.taskId, ['owner', 'editor']);
    const deleted = await deleteTaskItem(req.params.taskId, req.params.itemId);
    if (!deleted) {
      throw notFound('Task item');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete task item');
  }
});

taskRoutes.delete('/:taskId', async (req, res) => {
  try {
    await ensureTaskProjectRole(req.user, req.params.taskId, ['owner']);
    const deleted = await deleteTask(req.params.taskId);
    if (!deleted) {
      throw notFound('Task');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete task');
  }
});
