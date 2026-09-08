import { test, expect } from '@playwright/test';
import { frameScene, mixedScene, pixelFile } from './fixtures.mjs';

const syncButton = page => page.getByRole('button', { name: 'Sync to Backend', exact: true });
const warning = page => page.getByRole('alert').filter({ hasText: 'Sync is paused' });

async function serverScene(request) {
  const response = await request.get('/api/elements');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).elements;
}

async function seed(request, elements) {
  const response = await request.post('/api/elements/sync', { data: { elements } });
  expect(response.ok()).toBeTruthy();
}

async function sync(page, request) {
  await expect(syncButton(page)).toBeEnabled();
  const completed = page.waitForResponse(r => r.url().endsWith('/api/elements/sync') && r.request().method() === 'POST');
  await syncButton(page).click();
  expect((await completed).ok()).toBeTruthy();
  return serverScene(request);
}

function expectFrame(elements) {
  expect(elements.find(e => e.id === 'frame-repro-1')).toMatchObject({
    type: 'frame', name: 'repro-frame', x: 0, y: 0, width: 400, height: 300,
  });
  for (const id of ['text-repro-1', 'text-repro-2']) {
    expect(elements.find(e => e.id === id)).toMatchObject({ type: 'text', frameId: 'frame-repro-1' });
  }
}

// Use the real backend except where a specific corrupt/delayed wire message is
// injected. No Excalidraw mocks or production-only test API are involved.
async function interceptSocket(page, { forwardInitial = true } = {}) {
  let client;
  let upstream;
  await page.routeWebSocket('**', socket => {
    client = socket;
    upstream = socket.connectToServer();
    upstream.onMessage(message => {
      if (!forwardInitial && JSON.parse(String(message)).type === 'initial_elements') return;
      socket.send(message);
    });
  });
  return {
    send: message => client.send(JSON.stringify(message)),
    reconnect: () => {
      upstream.close();
      client.close({ code: 1012, reason: 'test reconnect' });
    },
  };
}

test.beforeEach(async ({ request }) => {
  await seed(request, []);
});

test('native frame survives real WebSocket load, repeated reload and sync', async ({ page, request }) => {
  await seed(request, frameScene());
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    await expect(page.getByText('repro-frame', { exact: true })).toBeVisible();
    const scene = await sync(page, request);
    expect(scene).toHaveLength(3);
    expectFrame(scene);
    if (i < 2) await page.reload();
  }
});

test('HTTP fallback restores frames when the initial WebSocket scene is missed', async ({ page, request }) => {
  await seed(request, frameScene());
  await interceptSocket(page, { forwardInitial: false });
  await page.goto('/');
  expectFrame(await sync(page, request));
});

test('a frame drawn with the UI survives sync, reload and another edit', async ({ page, request }) => {
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  await page.mouse.click(850, 650); // keyboard shortcuts are scoped to the editor
  await page.keyboard.press('f');
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(750, 550, { steps: 8 });
  await page.mouse.up();
  const original = await sync(page, request);
  const frame = original.find(e => e.type === 'frame');
  expect(frame).toBeDefined();
  await page.reload();
  await expect(syncButton(page)).toBeEnabled();
  await page.mouse.click(850, 650);
  await page.keyboard.press('r');
  await expect(page.getByRole('radio', { name: 'Rectangle', exact: true })).toBeChecked();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(550, 450, { steps: 5 });
  await page.mouse.up();
  const result = await sync(page, request);
  expect(result.find(e => e.id === frame.id)).toMatchObject({
    type: 'frame', x: frame.x, y: frame.y, width: frame.width, height: frame.height,
  });
  expect(result.some(e => e.type === 'rectangle' && e.frameId === frame.id)).toBeTruthy();
});

test('reconnect and server incremental updates preserve an existing frame', async ({ page, request }) => {
  await seed(request, frameScene());
  const socket = await interceptSocket(page);
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  socket.reconnect();
  await expect(page.getByText('Disconnected', { exact: true })).toBeVisible();
  await expect(syncButton(page)).toBeDisabled();
  await expect(syncButton(page)).toBeEnabled({ timeout: 15000 });
  const created = await request.post('/api/elements', {
    data: { id: 'server-added', type: 'rectangle', x: 500, y: 350, width: 120, height: 80 },
  });
  expect(created.ok()).toBeTruthy();
  // Allow the WebSocket event to run before sending a full-scene writeback.
  await page.waitForTimeout(150);
  expect((await sync(page, request)).map(e => e.id)).toContain('server-added');
  expectFrame(await serverScene(request));
});

test('successful Mermaid import and SVG export retain the frame scene', async ({ page, request }) => {
  await seed(request, frameScene());
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  const completion = page.waitForResponse(r => r.url().endsWith('/api/elements/sync') && r.request().method() === 'POST');
  const imported = await request.post('/api/elements/from-mermaid', { data: { mermaidDiagram: 'flowchart LR; A[One]-->B[Two]' } });
  expect(imported.ok()).toBeTruthy();
  expect((await completion).ok()).toBeTruthy();
  const scene = await serverScene(request);
  expectFrame(scene);
  expect(scene.length).toBeGreaterThan(3);
  const exported = await request.post('/api/export/image', { data: { format: 'svg' } });
  expect(exported.ok()).toBeTruthy();
  const result = await exported.json();
  expect(result.data).toContain('<svg');
  expect(result.data).toContain('Hello inside frame');
  expectFrame(await serverScene(request));
});

test('HTTP failure pauses sync and a successful retry recovers the scene', async ({ page, request }) => {
  await seed(request, frameScene());
  await interceptSocket(page, { forwardInitial: false });
  await page.route('**/api/elements', route => route.fulfill({ status: 503, json: { success: false } }));
  await page.goto('/');
  await expect(warning(page)).toBeVisible();
  await expect(syncButton(page)).toBeDisabled();
  await page.unroute('**/api/elements');
  await page.getByRole('button', { name: 'Retry loading' }).click();
  expectFrame(await sync(page, request));
});

test('mixed native elements retain stacking order, bindings and shorthand labels', async ({ page, request }) => {
  await request.post('/api/files', { data: { files: [pixelFile] } });
  const original = mixedScene();
  await seed(request, original);
  await page.goto('/');
  const result = await sync(page, request);
  expectFrame(result);
  expect(result.filter(e => original.some(source => source.id === e.id)).map(e => e.id))
    .toEqual(original.map(e => e.id));
  expect(result.find(e => e.id === 'label').containerId).toBe('shape');
  expect(result.find(e => e.id === 'arrow').startBinding.elementId).toBe('shape');
  expect(result.find(e => e.id === 'image').fileId).toBe('pixel');
  expect(result.find(e => e.id === 'freehand').points).toEqual([[0, 0], [20, 20], [40, 0]]);
  expect(result.some(e => e.type === 'text' && e.text === 'Agent label' && e.containerId === 'shorthand')).toBeTruthy();
});

for (const [name, badElement] of [
  ['unknown element type', { id: 'bad', type: 'future-element', x: 0, y: 0, width: 100, height: 100 }],
  ['silently filtered tiny frame', { id: 'bad', type: 'frame', x: 0, y: 0, width: 0, height: 0 }],
]) {
  test(`${name} blocks manual, automatic and Mermaid sync without changing server data`, async ({ page, request }) => {
    await seed(request, [...frameScene(), badElement]);
    const before = await serverScene(request);
    const writes = [];
    page.on('request', r => {
      if (r.method() === 'POST' && r.url().endsWith('/api/elements/sync')) writes.push(r);
    });
    await page.goto('/');
    await expect(warning(page)).toBeVisible();
    await expect(syncButton(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Clear Canvas', exact: true })).toBeDisabled();
    await page.mouse.click(500, 400);
    await page.keyboard.press('Delete');
    await request.post('/api/elements/from-mermaid', { data: { mermaidDiagram: 'flowchart LR; A-->B' } });
    await page.waitForTimeout(1600); // cover the actual 1200 ms autosync debounce
    expect(writes).toHaveLength(0);
    expect(await serverScene(request)).toEqual(before);
    await seed(request, frameScene());
    await page.getByRole('button', { name: 'Retry loading' }).click();
    expectFrame(await sync(page, request));
  });
}

test('failed remote restore preserves visible scene and cancels a pending autosync', async ({ page, request }) => {
  await seed(request, frameScene());
  const socket = await interceptSocket(page);
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  const before = await serverScene(request);
  const writes = [];
  page.on('request', r => {
    if (r.method() === 'POST' && r.url().endsWith('/api/elements/sync')) writes.push(r);
  });
  await page.mouse.click(850, 650);
  await page.keyboard.press('r');
  await expect(page.getByRole('radio', { name: 'Rectangle', exact: true })).toBeChecked();
  await page.mouse.move(750, 450);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 5 });
  await page.mouse.up();
  socket.send({ type: 'initial_elements', elements: [...frameScene(), { id: 'broken', type: 'frame', x: null, y: 0 }] });
  await expect(warning(page)).toBeVisible();
  await expect(page.getByText('repro-frame', { exact: true })).toBeVisible();
  await page.waitForTimeout(1600);
  expect(writes).toHaveLength(0);
  expect(await serverScene(request)).toEqual(before);
});

test('an older HTTP success cannot unlock sync after a newer WebSocket failure', async ({ page, request }) => {
  await seed(request, frameScene());
  const socket = await interceptSocket(page, { forwardInitial: false });
  const pending = [];
  await page.route('**/api/elements', route => pending.push(route));
  await page.goto('/');
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  socket.send({ type: 'initial_elements', elements: [{ id: 'bad', type: 'frame', x: 0, y: 0, width: 0, height: 0 }] });
  await expect(warning(page)).toBeVisible();
  for (const route of pending) await route.fulfill({ json: { success: true, elements: frameScene() } });
  await page.waitForTimeout(300);
  await expect(warning(page)).toBeVisible();
  await expect(syncButton(page)).toBeDisabled();
  expectFrame(await serverScene(request));
});

test('a newer empty WebSocket scene wins over an older HTTP scene', async ({ page, request }) => {
  await seed(request, frameScene());
  const socket = await interceptSocket(page, { forwardInitial: false });
  const pending = [];
  await page.route('**/api/elements', route => pending.push(route));
  await page.goto('/');
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await seed(request, []);
  socket.send({ type: 'initial_elements', elements: [] });
  await expect(syncButton(page)).toBeEnabled();
  for (const route of pending) await route.fulfill({ json: { success: true, elements: frameScene() } });
  await page.waitForTimeout(300);
  expect(await sync(page, request)).toEqual([]);
});

test('explicit clear succeeds after loading and remains empty on reload', async ({ page, request }) => {
  await seed(request, frameScene());
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Clear Canvas', exact: true }).click();
  await expect.poll(() => serverScene(request)).toEqual([]);
  await page.reload();
  expect(await sync(page, request)).toEqual([]);
});

test('normal select-all deletion can still autosync an empty scene', async ({ page, request }) => {
  await seed(request, frameScene());
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  await page.mouse.click(850, 650);
  await page.keyboard.press('v');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  // Excalidraw deletes the selected frame first and selects its remaining
  // children. A second Delete removes those children as well.
  await page.keyboard.press('Delete');
  await expect.poll(() => serverScene(request)).toEqual([]);
  await page.reload();
  expect(await sync(page, request)).toEqual([]);
});

test('failed clear keeps the visible and saved scene protected', async ({ page, request }) => {
  await seed(request, frameScene());
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  const before = await serverScene(request);
  await page.route('**/api/elements/clear', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.getByRole('button', { name: 'Clear Canvas', exact: true }).click();
  await expect(warning(page)).toBeVisible();
  await expect(page.getByText('repro-frame', { exact: true })).toBeVisible();
  expect(await serverScene(request)).toEqual(before);
});
