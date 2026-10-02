import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { schemas } from '../lib/server/validation.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const origin = 'http://127.0.0.1:4173';
const node = (id, title, x = 40, y = 40) => ({ id, title, type: 'experiment', status: 'pending', x, y, inputs: '', output: '', summary: '', rationale: '', method: '', conclusion: '', nextAction: '', startedAt: '', duration: '' });
const hypothesis = (id, title) => ({ id, projectId: 'p1', title, description: 'Isolated canvas fixture', baseline: '', status: 'pending', revision: 1, nodes: [node('a', 'Node A'), node('b', 'Node B', 280, 40), node('c', 'Node C', 40, 210)], edges: [{ source: 'a', target: 'b' }] });
const errors = [];
let activePage;
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage(); activePage = page;
    page.on('pageerror', error => errors.push(error.message));
    const data = { projects: [{ id: 'p1', name: 'Fixture project', description: '', revision: 1 }], hypotheses: [hypothesis('h1', 'Hypothesis one'), hypothesis('h2', 'Hypothesis two')], experiments: [], resources: [] };
    const writes = [];
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { data: value } : { error: { message: value } }) });
      if (path === '/api/v1/workspace' && request.method() === 'GET') return reply(data);
      if (path.startsWith('/api/v1/hypotheses/') && request.method() === 'PUT') {
        const payload = request.postDataJSON(), index = data.hypotheses.findIndex(h => h.id === payload.id);
        writes.push(payload);
        const parsed = schemas.hypotheses.safeParse(payload);
        if (!parsed.success) return reply(parsed.error.issues.map(issue => issue.message).join('；'), 422);
        if (payload.revision !== data.hypotheses[index].revision) return reply('Fixture revision conflict', 409);
        data.hypotheses[index] = { ...parsed.data, id: payload.id, revision: payload.revision + 1 };
        return reply(data.hypotheses[index]);
      }
      throw new Error('Unexpected isolated canvas request: ' + request.method() + ' ' + path);
    });
    const choose = async id => { await page.locator('.node').filter({ hasText: `Node ${id}` }).click(); };
    const waitIdle = async () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存节点' && !b.disabled));
    const save = async () => { await page.getByRole('button', { name: '保存节点', exact: true }).click(); await waitIdle(); };
    const login = async () => {
      await page.getByRole('button', { name: '管理员登录', exact: true }).click();
      await page.getByRole('dialog').getByLabel('访问 Token', { exact: true }).fill('canvas-fixture-only');
      await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('heading', { name: 'Hypothesis one', exact: true }).waitFor();
    };
    await page.goto(origin); await login();
    await choose('A');
    await page.getByLabel('结果摘要', { exact: true }).fill('Unsaved A');
    await choose('B'); await page.getByLabel('研究思路', { exact: true }).fill('Unsaved B');
    for (let i = 0; i < 3; i++) {
      await page.locator('.list .item').filter({ hasText: 'Hypothesis two' }).click();
      await choose('A'); assert.equal(await page.getByLabel('结果摘要', { exact: true }).inputValue(), '');
      await page.locator('.list .item').filter({ hasText: 'Hypothesis one' }).click();
      await choose('A'); assert.equal(await page.getByLabel('结果摘要', { exact: true }).inputValue(), 'Unsaved A');
      await choose('B'); assert.equal(await page.getByLabel('研究思路', { exact: true }).inputValue(), 'Unsaved B');
    }
    assert.equal(writes.length, 0, 'switching drafts must never save them');
    await choose('A');
    const a = page.locator('.node').filter({ hasText: 'Node A' });
    await a.scrollIntoViewIfNeeded();
    const box = await a.boundingBox(); assert.ok(box);
    const start = { x: box.x + box.width / 2, y: box.y + 30 };
    if (mobile) {
      // Actual Chromium touch input covers dragging on touch-action:none nodes.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 50, y: start.y + 35 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + 50, start.y + 35, { steps: 5 }); await page.mouse.up();
    }
    await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].x, 90); assert.equal(data.hypotheses[0].nodes[0].y, 75);
    assert.equal(data.hypotheses[0].nodes[0].summary, '', 'drag only saves coordinates');
    assert.equal(await page.getByLabel('结果摘要', { exact: true }).inputValue(), 'Unsaved A');
    await a.focus(); await a.press('ArrowRight'); await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].x, 100);
    assert.equal(await page.getByLabel('结果摘要', { exact: true }).inputValue(), 'Unsaved A');
    await save();
    assert.equal(data.hypotheses[0].nodes[0].x, 100, 'saving inspector must not roll back a drag');
    assert.equal(data.hypotheses[0].nodes[0].summary, 'Unsaved A');
    assert.equal(await page.locator('.inspector .unsaved').count(), 0);

    // Add a second parent, then try a genuine cycle through the real validator.
    await choose('B'); await page.getByLabel(/^上游节点/).selectOption(['a', 'c']); await save();
    assert.deepEqual(data.hypotheses[0].edges, [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }]);
    assert.equal(await page.locator('.canvas svg > path').count(), 2);
    await choose('C'); await page.getByLabel('节点标题', { exact: true }).fill('Rejected cycle draft');
    await page.getByLabel(/^上游节点/).selectOption(['b']); await save();
    await page.locator('#notice').filter({ hasText: '循环依赖' }).waitFor();
    assert.equal(await page.getByLabel('节点标题', { exact: true }).inputValue(), 'Rejected cycle draft');
    assert.equal(data.hypotheses[0].nodes[2].title, 'Node C');
    assert.equal(data.hypotheses[0].edges.length, 2);
    await page.getByLabel(/^上游节点/).selectOption([]); await save();
    assert.equal(data.hypotheses[0].nodes[2].title, 'Rejected cycle draft');

    // A stale revision is visible, and a refreshed same-field conflict needs confirmation.
    await choose('A'); await page.getByLabel('节点标题', { exact: true }).fill('Local conflict title');
    data.hypotheses[0].nodes[0].title = 'Remote title'; data.hypotheses[0].revision++;
    await save(); await page.locator('#notice').filter({ hasText: 'Fixture revision conflict' }).waitFor();
    assert.equal(await page.getByLabel('节点标题', { exact: true }).inputValue(), 'Local conflict title');
    await page.getByRole('button', { name: '刷新', exact: true }).click(); await waitIdle();
    await page.locator('.inspector .form-error').waitFor();
    const beforeConflictSave = writes.length;
    await save(); await page.getByRole('dialog').getByRole('heading', { name: '确认覆盖冲突字段', exact: true }).waitFor();
    assert.equal(writes.length, beforeConflictSave);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.getByLabel('节点标题', { exact: true }).inputValue(), 'Local conflict title');
    await save(); await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].title, 'Local conflict title');

    // Layout also refreshes the workspace; it must leave other unsaved fields alone.
    await page.getByLabel('结果摘要', { exact: true }).fill('Keep through layout');
    await page.getByRole('button', { name: '自动布局', exact: true }).click(); await waitIdle();
    assert.equal(await page.getByLabel('结果摘要', { exact: true }).inputValue(), 'Keep through layout');
    assert.equal(data.hypotheses[0].nodes[0].summary, 'Unsaved A');
    await page.getByRole('button', { name: '适配', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/canvas-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.getByRole('heading', { name: '工作区为空', exact: true }).waitFor();
    await login();
    await page.locator('.node').filter({ hasText: 'Local conflict title' }).click();
    assert.equal(await page.getByLabel('结果摘要', { exact: true }).inputValue(), 'Unsaved A', 'logout clears unsaved drafts');
    assert.equal(await page.locator('.inspector .unsaved').count(), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/touch canvas drag, keyboard movement, draft switching, layout, edges/DAG errors, revision conflicts and logout');
} catch (error) {
  mkdirSync('test-results', { recursive: true });
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: 'test-results/canvas-failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
