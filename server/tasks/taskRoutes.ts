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

export const taskRoutes = Router();

taskRoutes.get('/', async (req, res) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    res.json({ tasks: await listTasks({ projectId }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list tasks';
    res.status(500).json({ error: message });
  }
});

taskRoutes.get('/:taskId', async (req, res) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load task';
    res.status(500).json({ error: message });
  }
});

taskRoutes.get('/:taskId/items', async (req, res) => {
  try {
    res.json({ items: await listTaskItems(req.params.taskId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list task items';
    res.status(500).json({ error: message });
  }
});

taskRoutes.get('/:taskId/votes', async (req, res) => {
  try {
    res.json({ userVotes: await listTaskVotes(req.params.taskId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list task votes';
    res.status(500).json({ error: message });
  }
});

taskRoutes.get('/:taskId/votes/:userName', async (req, res) => {
  try {
    res.json({ votes: await getTaskUserVotes(req.params.taskId, decodeURIComponent(req.params.userName)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load user votes';
    res.status(500).json({ error: message });
  }
});

taskRoutes.put('/:taskId/votes/:userName', async (req, res) => {
  try {
    const votes = await saveTaskUserVotes(
      req.params.taskId,
      decodeURIComponent(req.params.userName),
      req.body.votes || [],
      Number(req.body.progress || 0)
    );
    res.json({ votes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save user votes';
    res.status(500).json({ error: message });
  }
});

taskRoutes.post('/', async (req, res) => {
  try {
    const task = await createTask(req.body.task, req.body.items || []);
    res.status(201).json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create task';
    res.status(500).json({ error: message });
  }
});

taskRoutes.patch('/:taskId', async (req, res) => {
  try {
    const task = await updateTask(req.params.taskId, req.body.patch || {});
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update task';
    res.status(500).json({ error: message });
  }
});

taskRoutes.patch('/:taskId/items/:itemId', async (req, res) => {
  try {
    const item = await updateTaskItem(req.params.taskId, req.params.itemId, req.body.patch || {});
    if (!item) {
      res.status(404).json({ error: 'Task item not found' });
      return;
    }
    res.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update task item';
    res.status(500).json({ error: message });
  }
});

taskRoutes.delete('/:taskId', async (req, res) => {
  try {
    const deleted = await deleteTask(req.params.taskId);
    if (!deleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete task';
    res.status(500).json({ error: message });
  }
});
