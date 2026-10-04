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

// Excalidraw's fonts come from a CDN. Delay them, as a slow network would, so
// text reaches the tab before its font does.
async function slowFonts(page) {
  await page.route(/\.(woff2|ttf)(\?.*)?$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });
}

const fontCases = [
  { id: 'hand', type: 'text', x: 100, y: 100, text: 'Hello fonts', fontSize: 28 },
  { id: 'centre', type: 'text', x: 100, y: 160, text: 'Centred text', textAlign: 'center', fontSize: 28 },
  { id: 'code', type: 'text', x: 100, y: 220, text: 'code()', fontFamily: '3', fontSize: 28 },
  { id: 'auto-box', type: 'rectangle', x: 400, y: 100, label: { text: 'Agent label' } },
];

async function expectMeasuredWithRealFonts(page, request) {
  // Width each text needs with whatever font the browser ended up with
  const expected = await page.evaluate(async () => {
    await document.fonts.ready;
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (family, text) => { ctx.font = `28px ${family}, Segoe UI Emoji`; return ctx.measureText(text).width; };
    return { hand: width('Excalifont', 'Hello fonts'), centre: width('Excalifont', 'Centred text'), code: width('Cascadia', 'code()') };
  });
  await expect(async () => {
    const scene = await sync(page, request);
    for (const [id, width] of Object.entries(expected)) {
      const element = scene.find(e => e.id === id);
      expect(Math.abs(element.width - width), `${id} width`).toBeLessThan(1);
      expect(element.x, `${id} keeps its x`).toBe(100);
    }
    // A shape sized from its label fits the label on one line
    const box = scene.find(e => e.id === 'auto-box');
    const label = scene.find(e => e.type === 'text' && e.containerId === 'auto-box');
    expect(label.text).toBe('Agent label');
    expect(box.width).toBeGreaterThan(label.width);
  }).toPass();
}

test('text in the first scene is measured with its real font', async ({ page, request }) => {
  await seed(request, []);
  expect((await request.post('/api/elements/batch', { data: { elements: fontCases } })).ok()).toBeTruthy();
  await slowFonts(page);
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  await expectMeasuredWithRealFonts(page, request);
});

test('text an agent adds to an open tab is measured with its real font', async ({ page, request }) => {
  await seed(request, []);
  await slowFonts(page);
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  expect((await request.post('/api/elements/batch', { data: { elements: fontCases } })).ok()).toBeTruthy();
  await expect.poll(async () => page.evaluate(() => document.querySelectorAll('canvas').length)).toBeGreaterThan(0);
  await expectMeasuredWithRealFonts(page, request);
});

test('a dropped image uploads its file once and survives reload', async ({ page, request }) => {
  const uploads = [];
  page.on('request', r => {
    if (r.url().endsWith('/api/files') && r.method() === 'POST') uploads.push(r.postDataJSON());
  });
  await page.goto('/');
  await expect(syncButton(page)).toBeEnabled();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 40;
    const ctx = canvas.getContext('2d');
    // A new colour per run gives a new file id: the server keeps files, and a
    // file it already holds is (correctly) not uploaded again
    ctx.fillStyle = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 40, 40);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'square.png', { type: 'image/png' }));
    const target = document.querySelector('canvas.interactive') || document.querySelector('.excalidraw canvas');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: 500, clientY: 400, dataTransfer: transfer }));
    }
  });
  let image;
  await expect(async () => {
    image = (await sync(page, request)).find(e => e.type === 'image');
    expect(image?.fileId).toBeTruthy();
  }).toPass();
  const stored = (await (await request.get('/api/files')).json()).files;
  expect(stored[image.fileId]?.dataURL).toMatch(/^data:image\/png;base64,/);
  expect(uploads.flatMap(u => u.files.map(f => f.id))).toEqual([image.fileId]);

  // A later sync does not upload it again; after a reload the tab loads it back
  await sync(page, request);
  expect(uploads).toHaveLength(1);
  await page.reload();
  const reloaded = await sync(page, request);
  expect(reloaded.find(e => e.id === image.id)).toMatchObject({ type: 'image', fileId: image.fileId });
  expect(uploads).toHaveLength(1);
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
  // Default renderer is headless even with a tab open; the tab path stays
  // available on request and renders the same scene.
  expect(result.renderer).toBe('node');
  const viaTab = await request.post('/api/export/image', { data: { format: 'svg', renderer: 'browser' } });
  expect(viaTab.ok()).toBeTruthy();
  const tabResult = await viaTab.json();
  expect(tabResult.renderer).toBe('browser');
  expect(tabResult.data).toContain('Hello inside frame');
  expectFrame(await serverScene(request));
});

test('image export renders headless with no browser tab', async ({ request }) => {
  await seed(request, mixedScene());
  expect((await request.post('/api/files', { data: [pixelFile] })).ok()).toBeTruthy();

  const png = await request.post('/api/export/image', { data: { format: 'png', scale: 2 } });
  expect(png.ok()).toBeTruthy();
  const pngResult = await png.json();
  expect(pngResult.renderer).toBe('node');
  expect(Buffer.from(pngResult.data, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(pngResult.width).toBeGreaterThan(0);

  const svg = await request.post('/api/export/image', { data: { format: 'svg', frameId: 'frame-repro-1' } });
  expect(svg.ok()).toBeTruthy();
  const svgResult = await svg.json();
  expect(svgResult.renderer).toBe('node');
  expect(svgResult.data).toContain('Hello inside frame');
  expect(svgResult.data).not.toContain('Bound label');
  expect(svgResult.data).toContain('@font-face');

  // Only the explicit browser renderer still needs a tab
  expect((await request.post('/api/export/image', { data: { format: 'svg', renderer: 'browser' } })).status()).toBe(503);
  expect((await request.post('/api/export/image', { data: { format: 'png', scale: 9 } })).status()).toBe(400);
  expect((await request.post('/api/export/image', { data: { format: 'svg', elementIds: ['nope'] } })).status()).toBe(404);
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
