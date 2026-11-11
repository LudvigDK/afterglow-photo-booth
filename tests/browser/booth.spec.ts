import { expect, test, webkit, type Page } from '@playwright/test';

async function expectResultToFit(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const qr = page.getByRole('img', { name: 'Download your photo' });
  const preview = page.getByAltText('Your captured photo');
  const another = page.getByRole('button', { name: 'Take another photo' });
  await expect.poll(async () => {
    const [code, photo, button] = await Promise.all([qr.boundingBox(), preview.boundingBox(), another.boundingBox()]);
    if (!code || !photo || !button) return false;
    const fits = (box: typeof code) => box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
    const panelFollowsPhoto = width > height ? code.x >= photo.x + photo.width : code.y >= photo.y + photo.height;
    return {
      withinViewport: [code, photo, button].every(fits),
      panelFollowsPhoto,
      qrSize: Math.round(code.width),
      squareQr: Math.abs(code.width - code.height) < 1,
      buttonBelowQr: button.y >= code.y + code.height,
    };
  }, { message: `Photo, QR code, and return button fit at ${width} × ${height}` }).toMatchObject({
    withinViewport: true,
    panelFollowsPhoto: true,
    qrSize: expect.any(Number),
    squareQr: true,
    buttonBelowQr: true,
  });
  expect((await qr.boundingBox())!.width).toBeGreaterThanOrEqual(96);
}

test('admin, kiosk, independent live display and mobile guest flow', async ({ page, browser, baseURL }) => {
  const name = 'Afterglow browser test ' + Date.now();
  await page.goto('/#/admin');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Admin access key').fill('local-development-only-change-this-key-123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  expect(page.url()).not.toContain('session=');
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.getByRole('dialog').getByLabel('Event name').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  const kioskUrl = await page.getByLabel('Photo booth URL').inputValue();
  const liveUrl = await page.getByLabel('Live display URL').inputValue();
  const galleryUrl = await page.getByLabel('Event gallery URL').inputValue();
  const kioskContext = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera'] });
  const liveContext = await browser.newContext();
  const kiosk = await kioskContext.newPage();
  const tv = await liveContext.newPage();
  const galleryContext = await browser.newContext();
  const gallery = await galleryContext.newPage();
  await gallery.goto(galleryUrl);
  await expect(gallery.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
  await tv.goto(liveUrl);
  await expect(tv.getByRole('heading', { name: 'The photos are on their way.' })).toBeVisible();

  await kiosk.goto(kioskUrl);
  expect(kiosk.url()).not.toContain('key=');
  await kiosk.getByRole('button', { name: 'Enable camera' }).click();
  const take = kiosk.getByRole('button', { name: 'Press to capture', exact: true });
  await expect(take).toBeEnabled();
  const gear = kiosk.getByRole('button', { name: 'Camera settings' });
  const cameraSettings = kiosk.getByRole('dialog', { name: 'Camera settings' });
  await expect(kiosk.getByRole('combobox', { name: 'Camera' })).toBeHidden();
  await expect(kiosk.getByRole('button', { name: 'Switch camera' })).toBeHidden();
  await gear.click();
  await expect(cameraSettings.getByRole('combobox', { name: 'Camera' })).toBeVisible();
  await expect(cameraSettings.getByRole('button', { name: 'Switch camera' })).toBeVisible();
  const mirror = cameraSettings.getByRole('checkbox', { name: 'Mirror preview' });
  await mirror.uncheck();
  await expect(kiosk.locator('video')).not.toHaveClass('mirror');
  await mirror.check();
  await expect(kiosk.locator('video')).toHaveClass('mirror');
  await cameraSettings.getByRole('button', { name: 'Close dialog' }).click();
  await expect(cameraSettings).toBeHidden();
  await kiosk.route('**/api/events/*/photos', (route) => route.fulfill({
    status: 507,
    headers: { 'Access-Control-Allow-Origin': baseURL! },
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Storage is temporarily unavailable for this test.' }),
  }));
  await take.click({ position: { x: 16, y: 16 } });
  await expect(kiosk.getByText('3', { exact: true })).toBeVisible();
  await expect(kiosk.getByRole('button', { name: 'Retry upload' })).toBeVisible();
  await expect(kiosk.getByAltText('Your captured photo')).toBeVisible();
  await expect(kiosk.getByText('Scan to save')).toHaveCount(0);

  await kiosk.unroute('**/api/events/*/photos');
  await kiosk.reload();
  await expect(kiosk.getByText('Your previous capture is ready to upload.')).toBeVisible();
  await kiosk.getByRole('button', { name: 'Retry upload' }).click();
  await expect(kiosk.getByRole('heading', { name: 'Scan to save' })).toBeVisible();
  await expect(kiosk.getByRole('img', { name: 'Download your photo' })).toBeVisible();
  await expectResultToFit(kiosk, 1180, 820);
  await expectResultToFit(kiosk, 568, 320);
  await expectResultToFit(kiosk, 320, 480);
  await expectResultToFit(kiosk, 390, 844);
  const firstLink = await kiosk.getByRole('link', { name: 'Open photo link' }).getAttribute('href');
  const firstId = firstLink!.split('/').at(-1)!;
  const tvPhoto = tv.locator('.live-images');
  await expect(tvPhoto).toHaveAttribute('data-photo-id', firstId);
  await expect(gallery.getByRole('button', { name: /View photo at/ })).toHaveCount(1);
  await galleryContext.close();

  await kiosk.clock.install();
  await kiosk.getByRole('button', { name: 'Take another photo' }).click();
  await expect(take).toBeEnabled();
  await kiosk.clock.fastForward(4000);
  await expect(take).toBeEnabled();
  await expect(kiosk.getByRole('img', { name: 'Download your photo' })).toBeHidden();
  await take.click();
  const secondLink = kiosk.getByRole('link', { name: 'Open photo link' });
  await expect(secondLink).toBeVisible();
  const secondId = (await secondLink.getAttribute('href'))!.split('/').at(-1)!;
  expect(secondId).not.toBe(firstId);
  await expect(tvPhoto).toHaveAttribute('data-photo-id', secondId);
  await liveContext.setOffline(true);
  await expect(tv.getByRole('status').filter({ hasText: 'Reconnecting' })).toBeVisible();
  await expect(tvPhoto).toHaveAttribute('data-photo-id', secondId);
  await liveContext.setOffline(false);
  await expect(tv.getByRole('status').filter({ hasText: 'Reconnecting' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Display mode').selectOption('all');
  await page.getByLabel('Slide duration (seconds)').fill('2');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(tvPhoto).toHaveAttribute('data-photo-id', firstId);
  await page.getByLabel('Display mode').selectOption('recent');
  await page.getByLabel('Number of recent photos').fill('1');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect.poll(async () => {
    const response = await tv.request.get('http://127.0.0.1:18787/api/events/' + galleryUrl.split('/').at(-1) + '/live');
    const { photos } = await response.json();
    return photos.map(([id]: [string]) => id);
  }).toEqual([secondId]);
  await expect(tvPhoto).toHaveAttribute('data-photo-id', secondId);
  await page.getByLabel('Display mode').selectOption('latest');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  const mobile = await webkit.launch();
  try {
    const guest = await mobile.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
    await guest.goto(galleryUrl);
    await expect(guest.getByRole('heading', { name })).toBeVisible();
    await expect(guest.getByRole('button', { name: /View photo at/ })).toHaveCount(2);
    await guest.getByRole('button', { name: /View photo at/ }).first().click();
    await expect(guest.getByRole('dialog')).toBeVisible();
    await guest.goto(firstLink!);
    await expect(guest.getByRole('heading', { name: 'Your photo.' })).toBeVisible();
    await expect(guest.getByAltText('Photo from ' + name)).toBeVisible();
    const download = guest.waitForEvent('download');
    await guest.getByRole('link', { name: 'Download photo' }).click();
    expect((await download).suggestedFilename()).toBe('afterglow-' + firstId + '.jpg');

    await page.getByRole('button', { name: 'Photos', exact: true }).click();
    await page.getByRole('button', { name: 'Delete all photos' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'This photo is no longer available' })).toBeVisible();
  } finally {
    await mobile.close();
  }

  await page.getByRole('button', { name: 'Device links' }).click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  await kioskContext.close();
  await liveContext.close();
});
