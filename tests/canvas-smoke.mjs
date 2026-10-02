import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { nodeOperationSchemas, schemas } from '../lib/server/validation.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
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
    const writes = [];
    await page.route('**/mcp', async route => {
      const request = route.request(), rpc = request.postDataJSON();
      assert.equal(request.method(), 'POST');
      assert.equal(rpc.jsonrpc, '2.0');
      const result = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: value }) });
      const payload = value => result({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
      const reply = (value, status = 200) => {
        if (status === 200) return payload({ data: value });
        const error = { error: { code: status === 409 ? 'REVISION_CONFLICT' : 'VALIDATION_ERROR', message: value }, status };
        return result({ isError: true, content: [{ type: 'text', text: JSON.stringify(error) }], structuredContent: error });
      };
      if (rpc.method === 'initialize') return result({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'FlowMaster', version: '2.0.0' } });
      if (rpc.method === 'notifications/initialized') return route.fulfill({ status: 202, body: '' });
      assert.equal(rpc.method, 'tools/call');
      const { name, arguments: args } = rpc.params;
      if (name === 'tokens_list') return reply([]);
      const [kind, action] = name.split('_');
      if (data[kind] && action === 'list') {
        const rows = data[kind].filter(item =>
          (!args.projectId || (kind === 'experiments' ? data.hypotheses.find(h => h.id === item.hypothesisId)?.projectId : item.projectId) === args.projectId) &&
          (!args.hypothesisId || item.hypothesisId === args.hypothesisId) && (!args.nodeId || item.nodeId === args.nodeId) &&
          (!args.status || item.status === args.status) && (!args.q || [item.name, item.title, item.description, item.summary].some(value => value?.includes(args.q))));
        return payload({ data: rows.slice(args.offset || 0, (args.offset || 0) + (args.limit || 100)), total: rows.length });
      }
      if (data[kind] && action === 'get') {
        const item = data[kind].find(item => item.id === args.id); assert.ok(item);
        return reply(item);
      }
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
    const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
    const choose = async id => { await page.locator('.node').filter({ hasText: `Node ${id}` }).click(); };
    const waitIdle = async () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '保存步骤' && !button.disabled));
    const save = async () => { await page.getByRole('button', { name: '保存步骤', exact: true }).click(); await waitIdle(); };
    const login = async () => {
      await navigation.getByRole('link', { name: '连接与设置', exact: true }).click();
      await page.locator('.connection-form').getByLabel('访问 Token', { exact: true }).fill('canvas-fixture-only');
      await page.locator('.connection-form').getByRole('button', { name: '连接工作区', exact: true }).click();
      await page.locator('.project-cards .card').filter({ hasText: 'Fixture project' }).getByRole('button', { name: '进入项目', exact: true }).click();
      await page.getByRole('heading', { name: 'Hypothesis one', exact: true }).waitFor();
    };
    const dependencies = async () => {
      const summary = page.locator('.inspector summary').filter({ hasText: '依赖步骤' });
      const section = summary.locator('..');
      if (await section.getAttribute('open') === null) await summary.click();
      return section;
    };
    await page.goto(origin); await login();
    await choose('A');
    await page.getByLabel('目标 / 说明', { exact: true }).fill('Unsaved A');
    await choose('B'); await page.getByLabel('目标 / 说明', { exact: true }).fill('Unsaved B');
    for (let i = 0; i < 3; i++) {
      await page.locator('.flow-list .item').filter({ hasText: 'Hypothesis two' }).click();
      await choose('A'); assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), '');
      await page.locator('.flow-list .item').filter({ hasText: 'Hypothesis one' }).click();
      await choose('A'); assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A');
      await choose('B'); assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved B');
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
    assert.equal(data.hypotheses[0].nodes[0].rationale, '', 'drag only saves coordinates');
    assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A');
    await a.focus(); await a.press('ArrowRight'); await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].x, 100);
    assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A');
    await save();
    assert.equal(data.hypotheses[0].nodes[0].x, 100, 'saving inspector must not roll back a drag');
    assert.equal(data.hypotheses[0].nodes[0].rationale, 'Unsaved A');
    assert.equal(await page.locator('.inspector .unsaved').count(), 0);

    // Add a second parent, then try a genuine cycle through the real validator.
    await choose('B');
    const parents = await dependencies();
    await parents.getByRole('checkbox', { name: 'Node A', exact: true }).check();
    await parents.getByRole('checkbox', { name: 'Node C', exact: true }).check(); await save();
    assert.deepEqual(data.hypotheses[0].edges, [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }]);
    assert.equal(await page.locator('.canvas svg > path').count(), 2);
    await choose('C'); await page.getByLabel('步骤标题', { exact: true }).fill('Rejected cycle draft');
    await (await dependencies()).getByRole('checkbox', { name: 'Node B', exact: true }).check(); await save();
    await page.locator('#notice').filter({ hasText: '循环依赖' }).waitFor();
    assert.equal(await page.getByLabel('步骤标题', { exact: true }).inputValue(), 'Rejected cycle draft');
    assert.equal(data.hypotheses[0].nodes[2].title, 'Node C');
    assert.equal(data.hypotheses[0].edges.length, 2);
    await (await dependencies()).getByRole('checkbox', { name: 'Node B', exact: true }).uncheck(); await save();
    assert.equal(data.hypotheses[0].nodes[2].title, 'Rejected cycle draft');

    // A stale revision is visible, and a refreshed same-field conflict needs confirmation.
    await choose('A'); await page.getByLabel('步骤标题', { exact: true }).fill('Local conflict title');
    data.hypotheses[0].nodes[0].title = 'Remote title'; data.hypotheses[0].revision++;
    await save(); await page.locator('#notice').filter({ hasText: 'Fixture revision conflict' }).waitFor();
    assert.equal(await page.getByLabel('步骤标题', { exact: true }).inputValue(), 'Local conflict title');
    await page.getByRole('button', { name: '刷新项目', exact: true }).click(); await waitIdle();
    await page.locator('.inspector .form-error').waitFor();
    const beforeConflictSave = writes.length;
    await save(); await page.getByRole('dialog').getByRole('heading', { name: '确认保存冲突字段', exact: true }).waitFor();
    assert.equal(writes.length, beforeConflictSave);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.getByLabel('步骤标题', { exact: true }).inputValue(), 'Local conflict title');
    await save(); await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await waitIdle();
    assert.equal(data.hypotheses[0].nodes[0].title, 'Local conflict title');

    // Layout merges the updated flow; it must leave other unsaved fields alone.
    await page.getByLabel('目标 / 说明', { exact: true }).fill('Keep through layout');
    await page.getByRole('button', { name: '自动布局', exact: true }).click(); await waitIdle();
    assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Keep through layout');
    assert.equal(data.hypotheses[0].nodes[0].rationale, 'Unsaved A');
    await page.getByRole('button', { name: '适配', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/canvas-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await navigation.getByRole('link', { name: '连接与设置', exact: true }).click();
    await page.getByRole('button', { name: '退出并清除凭据', exact: true }).click();
    await page.locator('.connection-form').getByRole('button', { name: '连接工作区', exact: true }).waitFor();
    await login();
    await page.locator('.node').filter({ hasText: 'Local conflict title' }).click();
    assert.equal(await page.getByLabel('目标 / 说明', { exact: true }).inputValue(), 'Unsaved A', 'logout clears unsaved drafts');
    assert.equal(await page.locator('.inspector .unsaved').count(), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/touch canvas drag, keyboard movement, draft switching, layout, node tools/DAG errors, revision conflicts and logout');
} catch (error) {
  mkdirSync('test-results', { recursive: true });
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: 'test-results/canvas-failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
