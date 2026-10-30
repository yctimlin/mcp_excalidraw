import { test, expect } from '@playwright/test';

const darkCanvas = page => page.locator('.excalidraw.theme--dark');

// Filled so any point on it hits the element, and large enough to cover the
// viewport whether or not the canvas scrolls to fit the scene.
const backdrop = {
  id: 'backdrop', type: 'rectangle', x: -2000, y: -2000, width: 4000, height: 4000,
  strokeColor: '#1971c2', backgroundColor: '#a5d8ff', fillStyle: 'solid', strokeWidth: 2,
  strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0, groupIds: [], frameId: null,
  roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false, index: 'a0',
};

test.use({ colorScheme: 'dark' });

test.beforeEach(async ({ context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const response = await request.post('/api/elements/sync', { data: { elements: [backdrop] } });
  expect(response.ok()).toBeTruthy();
});

// Excalidraw falls back to its `theme` prop, or light, when an action result
// omits the theme. These actions return a partial appState.
const actions = {
  'Copy link to object': page => page.locator('.Toast'),
  'Copy to clipboard as SVG': page => page.locator('.Toast'),
  'Wrap selection in frame': page => page.getByText('Frame', { exact: true }),
};

for (const [action, done] of Object.entries(actions)) {
  test(`"${action}" keeps the dark theme`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sync to Backend', exact: true })).toBeEnabled();
    await expect(darkCanvas(page)).toBeVisible();

    await page.mouse.click(640, 500, { button: 'right' });
    await page.getByText(action, { exact: true }).click();

    await expect(done(page)).toBeVisible();
    await expect(darkCanvas(page)).toBeVisible();
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  });
}

test('the main menu theme toggle still switches and persists the theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sync to Backend', exact: true })).toBeEnabled();
  await expect(darkCanvas(page)).toBeVisible();

  await page.getByTestId('main-menu-trigger').click();
  await page.getByText('Light mode', { exact: true }).click();

  // Excalidraw marks only dark mode with a class.
  await expect(darkCanvas(page)).toHaveCount(0);
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.excalidraw')).toBeVisible();
  await expect(darkCanvas(page)).toHaveCount(0);
});
