import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const models = [
  { id: 'model-a', name: 'Reveal Model A' },
  { id: 'model-b', name: 'Reveal Model B' },
  { id: 'model-c', name: 'Reveal Model C' },
];

const pixel = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`)}`;

const buildItem = (index: number) => ({
  id: `feedback-reveal-${index}`,
  modelA_Url: pixel('#111827'),
  modelB_Url: pixel('#1f2937'),
  modelOutputs: models.map((model, modelIndex) => ({
    modelId: model.id,
    modelName: model.name,
    url: pixel(['#ef4444', '#22c55e', '#3b82f6'][modelIndex]),
  })),
  prompt: `Feedback reveal case ${index}`,
  type: 'image',
});

const seedSession = async (page: Page, session: Record<string, unknown>) => {
  await page.addInitScript(({ savedSession }) => {
    localStorage.setItem('modeleval_session', JSON.stringify(savedSession));
  }, { savedSession: session });
};

const baseSession = (overrides: Record<string, unknown>) => ({
  items: [buildItem(1)],
  votes: [],
  currentIndex: 0,
  userName: 'Feedback Tester',
  modelNames: { a: models[0].name, b: models[1].name },
  taskModels: models,
  activeTaskId: null,
  timestamp: 1,
  sessionId: `feedback-reveal-${Math.random()}`,
  ...overrides,
});

const openRestoredEvaluation = async (page: Page) => {
  await page.goto('/evaluation');
  await page.getByRole('button', { name: '继续评测' }).click();
};

const enableRevealAfterSubmit = async (page: Page) => {
  const toggle = page.getByRole('switch', { name: '提交后揭示模型' });
  const toggleLabel = toggle.locator('xpath=..');
  await expect(toggle).not.toBeChecked();
  await expect(toggleLabel).toContainText('揭示模型');
  await expect(toggleLabel).toContainText('关闭');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggleLabel).toContainText('开启');
};

test('reveal is off by default and submission advances directly', async ({ page }) => {
  await seedSession(page, baseSession({
    items: [buildItem(0), buildItem(1)],
    taskParadigm: 'Arena-rank',
    taskEvaluationConfig: { method: 'rank_order', blind: true, tiePolicy: 'allow' },
  }));

  await openRestoredEvaluation(page);
  await expect(page.getByRole('switch', { name: '提交后揭示模型' })).not.toBeChecked();
  await page.getByRole('button', { name: '提交排名', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('本 case 已保存，模型身份已揭示')).toHaveCount(0);
  await expect(page.getByText('Reveal Model A', { exact: true })).toHaveCount(0);
});

test('reveal preference is not persisted when the evaluation is re-entered', async ({ page }) => {
  await seedSession(page, baseSession({
    taskParadigm: 'Arena-rank',
    taskEvaluationConfig: { method: 'rank_order', blind: true, tiePolicy: 'allow' },
  }));

  await openRestoredEvaluation(page);
  await enableRevealAfterSubmit(page);
  await page.goto('/evaluation');
  await page.getByRole('button', { name: '继续评测' }).click();
  await expect(page.getByRole('switch', { name: '提交后揭示模型' })).not.toBeChecked();
});

test('Arena-rank saves before reveal, keeps feedback editable, and advances from the submit slot', async ({ page }) => {
  await page.addInitScript(({ session }) => {
    localStorage.setItem('modeleval_session', JSON.stringify(session));
  }, {
    session: {
      items: [buildItem(1), buildItem(2)],
      votes: [],
      currentIndex: 0,
      userName: 'Feedback Tester',
      modelNames: { a: models[0].name, b: models[1].name },
      taskModels: models,
      taskParadigm: 'Arena-rank',
      taskEvaluationConfig: { method: 'rank_order', blind: true, tiePolicy: 'allow' },
      activeTaskId: null,
      timestamp: 1,
      sessionId: 'feedback-reveal-session',
    },
  });

  await page.goto('/evaluation');
  await page.getByRole('button', { name: '继续评测' }).click();
  await enableRevealAfterSubmit(page);
  await expect(page.getByText('1 / 2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reveal Model A', { exact: true })).toHaveCount(0);

  const feedbackInputs = page.getByLabel(/评价与备注/);
  await expect(feedbackInputs).toHaveCount(3);
  await feedbackInputs.nth(0).fill('提交前备注');

  await page.getByRole('button', { name: '提交排名', exact: true }).click();
  await expect(page.getByText('本 case 已保存，模型身份已揭示')).toBeVisible();
  await expect(page.getByText('Reveal Model A', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: '提交后揭示模型' }).click();
  await expect(page.getByRole('switch', { name: '提交后揭示模型' })).not.toBeChecked();
  await expect(page.getByText('Reveal Model A', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: '提交后揭示模型' }).click();
  await expect(page.getByRole('button', { name: '下一题', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交排名', exact: true })).toHaveCount(0);

  await feedbackInputs.nth(0).fill('揭示后修改的备注');
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('switch', { name: '提交后揭示模型' })).toBeChecked();
  await expect(page.getByText('Reveal Model A', { exact: true })).toHaveCount(0);
  await expect(feedbackInputs.nth(0)).toHaveValue('');

  await page.getByRole('switch', { name: '提交后揭示模型' }).click();
  await page.getByRole('button', { name: '提交排名', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型评价汇总' })).toBeVisible();
  await page.locator('[data-model-feedback-summary] details').filter({ hasText: '备注 1' }).locator('summary').click();
  await expect(page.getByText('揭示后修改的备注', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '我的结果', exact: true }).click();
  await expect(page.locator('[data-model-feedback-summary]')).toContainText('1 条备注');
  await page.getByRole('button', { name: '低共识 / 高分歧', exact: true }).click();
  await expect(page.locator('[data-model-feedback-summary]')).toContainText('1 条备注');
});

test('A/B keeps swapped output feedback attached to the actual model and reveals only after save', async ({ page }) => {
  const item = { ...buildItem(10), isSwapped: true, modelOutputs: buildItem(10).modelOutputs.slice(0, 2) };
  await seedSession(page, baseSession({
    items: [item],
    taskModels: models.slice(0, 2),
    taskParadigm: 'Arena',
    taskEvaluationConfig: { method: 'ab_preference', blind: true, tiePolicy: 'allow' },
  }));

  await openRestoredEvaluation(page);
  await enableRevealAfterSubmit(page);
  await expect(page.getByText('Reveal Model A', { exact: true })).toHaveCount(0);
  await page.getByLabel('选项 1 评价与备注').fill('左侧实际是模型 B');
  await page.getByRole('button', { name: '投给选项 1（左侧）', exact: true }).click();

  await expect(page.getByText('本 case 已保存，模型身份已揭示')).toBeVisible();
  const firstCard = page.locator('[data-model-feedback-id="model-b"]').locator('xpath=..');
  await expect(firstCard).toContainText('Reveal Model B');
  await page.getByRole('button', { name: '重新评本题', exact: true }).click();
  await expect(page.getByText('Reveal Model B', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('选项 1 评价与备注')).toHaveValue('左侧实际是模型 B');
  await page.getByRole('button', { name: '投给选项 1（左侧）', exact: true }).click();
  await expect(page.getByText('本 case 已保存，模型身份已揭示')).toBeVisible();
  await page.getByRole('button', { name: '查看结果', exact: true }).click();
  const modelBFeedback = page.locator('[data-model-feedback-summary] details').filter({ hasText: 'Reveal Model B' });
  await modelBFeedback.locator('summary').click();
  await expect(modelBFeedback).toContainText('左侧实际是模型 B');
});

test('Pairwise uses assignment identities for reveal and per-model feedback', async ({ page }) => {
  const item = {
    ...buildItem(20),
    modelA_Url: buildItem(20).modelOutputs[2].url,
    modelB_Url: buildItem(20).modelOutputs[0].url,
    pairContext: {
      assignmentId: 'pair-assignment-1',
      pairId: 'model-a::model-c',
      originalItemId: 'feedback-reveal-20',
      modelAId: 'model-c',
      modelAName: 'Snapshot C',
      modelBId: 'model-a',
      modelBName: 'Snapshot A',
      leftModelId: 'model-c',
      rightModelId: 'model-a',
    },
  };
  await seedSession(page, baseSession({
    items: [item],
    taskParadigm: 'Pairwise',
    taskEvaluationConfig: { method: 'pairwise', blind: true, tiePolicy: 'allow', pairwiseMode: 'all_pairs' },
  }));

  await openRestoredEvaluation(page);
  await enableRevealAfterSubmit(page);
  await expect(page.getByText('Reveal Model C', { exact: true })).toHaveCount(0);
  await page.getByLabel('选项 1 评价与备注').fill('模型 C 的动作最好');
  await page.getByRole('button', { name: '投给选项 1（左侧）', exact: true }).click();
  await expect(page.getByText('Reveal Model C', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看结果', exact: true })).toBeVisible();
});

test('MOS locks scores after submission while feedback remains editable', async ({ page }) => {
  const scoreDimension = { id: 'quality', name: '整体质量', type: 'star_rating', weight: 1, required: true };
  await seedSession(page, baseSession({
    items: [{ ...buildItem(30), modelOutputs: buildItem(30).modelOutputs.slice(0, 2) }],
    taskModels: models.slice(0, 2),
    taskParadigm: 'MOS',
    taskEvaluationConfig: { method: 'direct_score', blind: true, dimensions: [scoreDimension], requireReason: false },
  }));

  await openRestoredEvaluation(page);
  await enableRevealAfterSubmit(page);
  await expect(page.getByText('Reveal Model A', { exact: true })).toHaveCount(0);
  const cards = page.locator('section.ark-rank-card');
  await cards.nth(0).getByRole('button', { name: '5', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: '4', exact: true }).click();
  await page.getByLabel('候选 1 评价与备注').fill('MOS 提交前备注');
  await page.getByRole('button', { name: '提交评分', exact: true }).click();

  await expect(page.getByText('Reveal Model A', { exact: true })).toBeVisible();
  await expect(cards.nth(0).getByRole('button', { name: '5', exact: true })).toBeDisabled();
  await page.getByLabel('候选 1 评价与备注').fill('MOS 揭示后备注');
  await page.getByRole('button', { name: '查看结果', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型评价汇总' })).toBeVisible();
});

test('Rubric keeps required rationale in the shared per-model feedback editor', async ({ page }) => {
  const dimension = { id: 'alignment', name: '一致性', type: 'star_rating', weight: 1, required: true };
  await seedSession(page, baseSession({
    items: [{ ...buildItem(40), modelOutputs: buildItem(40).modelOutputs.slice(0, 2) }],
    taskModels: models.slice(0, 2),
    taskParadigm: 'RubricScore',
    taskEvaluationConfig: { method: 'rubric_score', blind: false, dimensions: [dimension], requireReason: true },
  }));

  await openRestoredEvaluation(page);
  await enableRevealAfterSubmit(page);
  await expect(page.getByText('Reveal Model A', { exact: true })).toBeVisible();
  const cards = page.locator('section.ark-rank-card');
  await cards.nth(0).getByRole('button', { name: '4', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: '3', exact: true }).click();
  await expect(page.getByRole('button', { name: '请完成必填评分', exact: true })).toBeDisabled();
  await page.getByLabel('候选 1 评价与备注').fill('模型 A 细节完整');
  await page.getByLabel('候选 2 评价与备注').fill('模型 B 有轻微瑕疵');
  await page.getByRole('button', { name: '提交评分', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看结果', exact: true })).toBeVisible();
  await expect(page.getByLabel('候选 1 评价与备注')).toBeEditable();
});

test('skip advances without reveal or carrying feedback into the next case', async ({ page }) => {
  await seedSession(page, baseSession({
    items: [buildItem(50), buildItem(51)],
    taskParadigm: 'Arena-rank',
    taskEvaluationConfig: { method: 'rank_order', blind: true, tiePolicy: 'allow' },
  }));

  await openRestoredEvaluation(page);
  await page.getByLabel(/评价与备注/).first().fill('不会保存的草稿');
  await page.getByRole('button', { name: '跳过本题', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reveal Model A', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/评价与备注/).first()).toHaveValue('');
});

test('Arena-rank exposes the same reveal continuation on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSession(page, baseSession({
    items: [buildItem(60)],
    taskParadigm: 'Arena-rank',
    taskEvaluationConfig: { method: 'rank_order', blind: true, tiePolicy: 'allow' },
  }));

  await openRestoredEvaluation(page);
  await enableRevealAfterSubmit(page);
  await page.getByRole('button', { name: '调整排名梯队', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '排名梯队编辑器' })).toBeVisible();
  await page.getByRole('dialog', { name: '排名梯队编辑器' }).getByRole('button', { name: '提交排名', exact: true }).click();
  await expect(page.getByText('Reveal Model A', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看结果', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
