import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { nodeOperationSchemas, schemas } from '../lib/server/validation.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const origin = 'http://127.0.0.1:4173';
const node = (id, title, x = 40, y = 40) => ({ id, title, type: 'experiment', status: 'pending', progress: 'pending', resourceIds: [], currentResultId: null, x, y, inputs: '', output: '', summary: '', rationale: '', method: '', conclusion: '', nextAction: '', startedAt: '', duration: '' });
const hypothesis = (id, title) => ({ id, projectId: 'p1', title, description: 'Isolated canvas fixture', baseline: '', status: 'pending', revision: 1, nodes: [node('a', 'Node A'), node('b', 'Node B', 280, 40), node('c', 'Node C', 40, 210)], edges: [{ source: 'a', target: 'b' }] });
const errors = [];
let activePage;
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage(); activePage = page;
    page.on('pageerror', error => errors.push(error.message));
    const data = { projects: [{ id: 'p1', name: 'Fixture project', description: '', revision: 1 }], hypotheses: [hypothesis('h1', 'Hypothesis one'), hypothesis('h2', 'Hypothesis two')], experiments: [], resources: [] };
    if (!mobile) data.hypotheses.push(...Array.from({ length: 199 }, (_, index) => hypothesis(`h${index + 3}`, `Hypothesis ${index + 3}`)));
    const writes = [];
    await page.route('**/mcp', async route => {
      const request = route.request(), rpc = request.postDataJSON();
      assert.equal(request.method(), 'POST');
      assert.equal(rpc.jsonrpc, '2.0');
      const result = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: value }) });
      const reply = (value, status = 200, meta = {}) => {
        const payload = status === 200 ? { data: value, ...meta } : { error: { code: status === 409 ? 'REVISION_CONFLICT' : 'VALIDATION_ERROR', message: value }, status };
        return result({ ...(status === 200 ? {} : { isError: true }), content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload });
      };
      if (rpc.method === 'initialize') return result({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'FlowMaster', version: '2.0.0' } });
      if (rpc.method === 'notifications/initialized') return route.fulfill({ status: 202, body: '' });
      assert.equal(rpc.method, 'tools/call');
      const { name, arguments: args } = rpc.params;
      if (name === 'tokens_list') return reply([]);
      const [kind, action] = name.split('_');
      if (data[kind] && action === 'list') {
        const records = data[kind].filter(item => {
          const projectId = kind === 'experiments' ? data.hypotheses.find(h => h.id === item.hypothesisId)?.projectId : kind === 'projects' ? item.id : item.projectId;
          return (!args.projectId || projectId === args.projectId) && (!args.status || item.status === args.status)
            && (!args.q || JSON.stringify(item).toLowerCase().includes(args.q.toLowerCase()))
            && (kind !== 'experiments' || (!args.hypothesisId || item.hypothesisId === args.hypothesisId) && (!args.nodeId || item.nodeId === args.nodeId));
        });
        const offset = args.offset || 0, items = records.slice(offset, offset + (args.limit || 50));
        const next = offset + items.length;
        return reply(items, 200, { total: records.length, nextOffset: next < records.length ? next : null });
      }
      if (data[kind] && action === 'get') return reply(data[kind].find(item => item.id === args.id));
      if (kind === 'nodes' && ['update', 'move', 'layout'].includes(action)) {
        writes.push({ name, ...args });
        const operation = nodeOperationSchemas[action].safeParse(args);
        if (!operation.success) return reply(operation.error.issues.map(issue => issue.message).join('；'), 422);
        const value = operation.data, index = data.hypotheses.findIndex(h => h.id === value.hypothesisId);
        assert.ok(index !== -1);
        const current = data.hypotheses[index];
        if (value.revision !== current.revision) return reply('Fixture revision conflict', 409);
        const next = structuredClone(current);
        if (action === 'layout') {
          const positions = new Map(value.positions.map(position => [position.id, position]));
          if (positions.size !== value.positions.length || positions.size !== next.nodes.length || next.nodes.some(item => !positions.has(item.id))) return reply('布局必须恰好包含当前所有节点', 422);
          next.nodes = next.nodes.map(item => ({ ...item, ...positions.get(item.id) }));
        } else {
          const target = next.nodes.find(item => item.id === value.nodeId); assert.ok(target);
          if (action === 'move') Object.assign(target, { x: value.x, y: value.y });
          else {
            Object.assign(target, value.patch);
            if (value.upstream !== undefined) next.edges = [...next.edges.filter(edge => edge.target !== value.nodeId), ...value.upstream.map(source => ({ source, target: value.nodeId }))];
          }
        }
        const parsed = schemas.hypotheses.safeParse(next);
        if (!parsed.success) return reply(parsed.error.issues.map(issue => issue.message).join('；'), 422);
        data.hypotheses[index] = { ...parsed.data, id: current.id, revision: current.revision + 1 };
        return reply(data.hypotheses[index]);
      }
      throw new Error('Unexpected isolated canvas MCP tool: ' + name);
    });
    const drawer = page.locator('.node-drawer'), modal = page.locator('.ui-modal');
    const closeDrawer = async () => {
      if (await drawer.isVisible()) await drawer.getByRole('button', { name: '关闭节点详情', exact: true }).click();
      await drawer.waitFor({ state: 'hidden' });
    };
    const dependencies = async () => {
      const section = drawer.locator('details').filter({ has: page.locator('summary').filter({ hasText: '依赖步骤' }) });
      if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
      return section;
    };
    const choose = async id => {
      await closeDrawer();
      await page.locator(`.node[data-node-id="${id.toLowerCase()}"]`).click();
      await drawer.getByLabel('步骤标题', { exact: true }).waitFor();
    };
    const switchHypothesis = async title => {
      await closeDrawer();
      if (!await page.locator('#hypothesis-list').isVisible()) await page.locator('.sidebar-toggle').click();
      await page.locator('#hypothesis-list .hypothesis-item').filter({ hasText: title }).click();
      await page.locator('.flow-heading').getByRole('heading', { name: title, exact: true }).waitFor();
    };
    const waitIdle = async () => page.waitForFunction(() => document.querySelector('.canvas-add')?.disabled === false);
    const save = async () => { await drawer.getByRole('button', { name: '保存步骤', exact: true }).click(); await waitIdle(); };
    const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
    const login = async () => {
      await navigation.getByRole('link', { name: '连接与设置', exact: true }).click();
      await page.locator('.connection-form').getByLabel('访问 Token', { exact: true }).fill('canvas-fixture-only');
      await page.locator('.connection-form').getByRole('button', { name: '连接工作区', exact: true }).click();
      await page.locator('.project-cards .card').filter({ hasText: 'Fixture project' }).getByRole('button', { name: '进入项目', exact: true }).click();
      await page.getByRole('heading', { name: 'Hypothesis one', exact: true }).waitFor();
    };
    await page.goto(origin); await login();
    if (!mobile) {
      const sidebar = page.locator('#hypothesis-list');
      const lastHypothesis = sidebar.getByRole('button', { name: /Hypothesis 201/ });
      assert.equal(await lastHypothesis.count(), 0);
      const pagination = sidebar.locator('[aria-label="流程分页"]');
      const turnPage = async name => {
        const first = await sidebar.locator('.hypothesis-item').first().textContent();
        await pagination.getByRole('button', { name, exact: true }).click();
        await page.waitForFunction(previous => document.querySelector('#hypothesis-list .hypothesis-item')?.textContent !== previous, first);
      };
      while (!await lastHypothesis.count()) await turnPage('下一页');
      await lastHypothesis.waitFor({ state: 'visible' });
      await lastHypothesis.click();
      await page.locator('.flow-heading').getByRole('heading', { name: 'Hypothesis 201', exact: true }).waitFor();
      while (!await sidebar.getByRole('button', { name: /Hypothesis one/ }).count()) await turnPage('上一页');
      await switchHypothesis('Hypothesis one');
    }
    await choose('A');
    await drawer.getByLabel('目标 / 说明', { exact: true }).fill('Unsaved A');
    if (!mobile) {
      await choose('B'); await drawer.getByLabel('目标 / 说明', { exact: true }).fill('Unsaved B');
      await switchHypothesis('Hypothesis two');
      await choose('A'); assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), '');
      await switchHypothesis('Hypothesis one');
      await choose('A'); assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A');
      await choose('B'); assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved B');
    }
    assert.equal(writes.length, 0, 'switching drafts must never save them');
    await choose('A');
    await closeDrawer();
    const a = page.locator('.node[data-node-id="a"]');
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
    assert.equal(data.hypotheses[0].nodes[0].rationale, '', 'drag only saves coordinates');
    await choose('A');
    assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A');
    if (mobile) {
      assert.equal(await drawer.evaluate(element => element.matches(':modal')), true);
      await save();
      assert.equal(data.hypotheses[0].nodes[0].rationale, 'Unsaved A');
      await closeDrawer();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await context.close();
      continue;
    }
    await closeDrawer();
    await a.focus(); await a.press('ArrowRight'); await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].x, 100);
    await choose('A');
    assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A');
    await save();
    assert.equal(data.hypotheses[0].nodes[0].x, 100, 'saving inspector must not roll back a drag');
    assert.equal(data.hypotheses[0].nodes[0].rationale, 'Unsaved A');
    assert.equal(await drawer.locator('.unsaved').count(), 0);

    // Add a second parent, then try a genuine cycle through the real validator.
    await choose('B'); await (await dependencies()).getByRole('checkbox', { name: 'Node C', exact: true }).check(); await save();
    assert.deepEqual(data.hypotheses[0].edges, [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }]);
    assert.equal(await page.locator('.canvas-connections > path').count(), 2);
    await choose('C'); await drawer.getByLabel('步骤标题', { exact: true }).fill('Rejected cycle draft');
    await (await dependencies()).getByRole('checkbox', { name: 'Node B', exact: true }).check(); await save();
    await page.locator('#notice').filter({ hasText: '循环依赖' }).waitFor();
    assert.equal(await drawer.getByLabel('步骤标题', { exact: true }).inputValue(), 'Rejected cycle draft');
    assert.equal(data.hypotheses[0].nodes[2].title, 'Node C');
    assert.equal(data.hypotheses[0].edges.length, 2);
    await (await dependencies()).getByRole('checkbox', { name: 'Node B', exact: true }).uncheck(); await save();
    assert.equal(data.hypotheses[0].nodes[2].title, 'Rejected cycle draft');

    // A stale revision is visible, and a refreshed same-field conflict needs confirmation.
    await choose('A'); await drawer.getByLabel('步骤标题', { exact: true }).fill('Local conflict title');
    data.hypotheses[0].nodes[0].title = 'Remote title'; data.hypotheses[0].revision++;
    await save(); await page.locator('#notice').filter({ hasText: 'Fixture revision conflict' }).waitFor();
    assert.equal(await drawer.getByLabel('步骤标题', { exact: true }).inputValue(), 'Local conflict title');
    await closeDrawer();
    await page.getByRole('button', { name: '刷新项目', exact: true }).click(); await waitIdle();
    await choose('A');
    await drawer.locator('.form-error').waitFor();
    const beforeConflictSave = writes.length;
    await save(); await modal.getByRole('heading', { name: '确认保存冲突字段', exact: true }).waitFor();
    assert.equal(writes.length, beforeConflictSave);
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await drawer.getByLabel('步骤标题', { exact: true }).inputValue(), 'Local conflict title');
    await save(); await modal.getByRole('button', { name: '确认', exact: true }).click();
    await modal.waitFor({ state: 'hidden' }); await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].title, 'Local conflict title');

    // Layout also refreshes the workspace; it must leave other unsaved fields alone.
    await drawer.getByLabel('目标 / 说明', { exact: true }).fill('Keep through layout');
    await closeDrawer();
    await page.getByRole('button', { name: '自动布局', exact: true }).click(); await waitIdle();
    await choose('A');
    assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Keep through layout');
    assert.equal(data.hypotheses[0].nodes[0].rationale, 'Unsaved A');
    await closeDrawer();
    await page.getByRole('button', { name: '适配', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await navigation.getByRole('link', { name: '连接与设置', exact: true }).click();
    await page.getByRole('button', { name: '退出并清除凭据', exact: true }).click();
    await login();
    await choose('A');
    assert.equal(await drawer.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A', 'logout clears unsaved drafts');
    assert.equal(await drawer.locator('.unsaved').count(), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/touch canvas drag, keyboard movement, draft switching, layout, edges/DAG errors, revision conflicts and logout');
} catch (error) {
  mkdirSync('test-results', { recursive: true });
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: 'test-results/canvas-failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
