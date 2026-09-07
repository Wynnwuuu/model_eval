import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

for (const [index, method] of ['A-B','Arena-rank','MOS','Rubric','Pairwise'].entries()) {
  test(`real ${method} screen downloads the visual report through its export button`, async ({page}, info) => {
    await page.goto(`/e2e/fixtures/insight-report-entry.html?method=${index}`);
    const button = page.getByRole('button',{name:'可视化报告 HTML'});
    await expect(button).toBeVisible();
    const pending = page.waitForEvent('download');
    await button.click();
    const download = await pending;
    expect(download.suggestedFilename()).toContain(`视觉生成对照_${method}_全员汇总_可视化报告_`);
    const file = info.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const html = await readFile(file,'utf8');
    expect(html).toContain('id="report-summary"');
    expect(html).toContain('class="case-report"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('private-key-');
    await expect(button).toBeEnabled();
    await expect(page.getByRole('button',{name:'分析报表 Excel'})).toBeVisible();
    await expect(page.getByRole('button',{name:/^(投票|排名|评审)明细 CSV$/})).toBeVisible();
  });
}

test('AND dimension scope limits the report while a winner browsing filter does not', async ({page},info) => {
  await page.goto('/e2e/fixtures/insight-report-entry.html?method=0');
  const dimensionPanel = page.locator('section').filter({has:page.getByRole('heading',{name:'按维度选项筛选'})});
  await dimensionPanel.getByRole('button',{name:/^visual_edit/}).click();
  await dimensionPanel.getByRole('button',{name:/^identity_consistency/}).click();
  await page.getByRole('button',{name:'看 Model Aurora 胜',exact:true}).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button',{name:'可视化报告 HTML'}).click();
  const download = await pending;
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const html = await readFile(file,'utf8');
  expect(html.match(/class="case-report"/g)).toHaveLength(17);
  expect(html).toContain('signal_tags：visual_edit AND signal_tags：identity_consistency');
  expect(html).toContain('筛选前 33 case，纳入 17 case');
  expect(html).toContain('data-case-id="case-033"');
  expect(html).not.toContain('data-case-id="case-002"');
});
