import { expect, openHistoricalCase, test } from './fixtures'

async function noHorizontalOverflow(page: import('@playwright/test').Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(sw, `page scrollWidth ${sw} > viewport ${iw}`).toBeLessThanOrEqual(iw + 1)
}

test('landing, app shell and workspace fit the viewport', async ({ page }) => {
  await page.goto('/')
  await noHorizontalOverflow(page)
  for (let i = 0; i < 5; i++) {
    await page.locator(`section[data-stage="${i}"]`).scrollIntoViewIfNeeded()
    await expect(page.locator(`section[data-stage="${i}"] :is(h1, h2)`)).toBeVisible()
  }
  await noHorizontalOverflow(page)
  for (const path of ['/app', '/app/new', '/app/cases', '/app/historical', '/app/challenge', '/app/status']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await noHorizontalOverflow(page)
  }
  await openHistoricalCase(page)
  await noHorizontalOverflow(page)
  // phones get the 2D fund flow; the 3D network needs a wider screen
  const narrow = (page.viewportSize()?.width ?? 1280) < 768
  await expect(page.getByTestId('flow-2d')).toBeVisible()
  expect(await page.getByRole('button', { name: '3D Network' }).isDisabled()).toBe(narrow)
  await page.getByRole('tab', { name: 'Matrix' }).click()
  await expect(page.getByRole('grid')).toBeVisible()
  await noHorizontalOverflow(page) // the matrix scrolls inside its own container
})
