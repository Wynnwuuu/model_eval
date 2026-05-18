import { Router } from 'express';

import {
  createTask,
  deleteTask,
  getTask,
  getTaskUserVotes,
  listTaskItems,
  listTaskVotes,
  listTasks,
  saveTaskUserVotes,
  updateTask,
  updateTaskItem,
} from './taskRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { optionalArray, optionalNumber, requireArray, requireBodyObject, validateTaskPayload } from '../http/validation.ts';

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

taskRoutes.get('/:taskId/votes/:userName', async (req, res) => {
  try {
    res.json({ votes: await getTaskUserVotes(req.params.taskId, decodeURIComponent(req.params.userName)) });
  } catch (error) {
    sendError(res, error, 'Failed to load user votes');
  }
});

taskRoutes.put('/:taskId/votes/:userName', async (req, res) => {
  try {
    const votePayload = requireArray(req.body?.votes, 'votes');
    const progress = optionalNumber(req.body?.progress, 'progress', votePayload.length);
    const savedVotes = await saveTaskUserVotes(
      req.params.taskId,
      decodeURIComponent(req.params.userName),
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
    const item = await updateTaskItem(req.params.taskId, req.params.itemId, patch);
    if (!item) {
      throw notFound('Task item');
    }
    res.json({ item });
  } catch (error) {
    sendError(res, error, 'Failed to update task item');
  }
});

taskRoutes.delete('/:taskId', async (req, res) => {
  try {
    const deleted = await deleteTask(req.params.taskId);
    if (!deleted) {
      throw notFound('Task');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete task');
  }
});
