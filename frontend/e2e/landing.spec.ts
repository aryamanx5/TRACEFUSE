import { expect, test } from './fixtures'

test('landing page renders all story stages, tracks scroll progress and enters the app', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/TRACEFUSE/)
  const stages = ['01 · The signal', '02 · Fragmentation', '03 · Disconnected intelligence', '04 · Evidence fusion', '05 · The investigation room']
  for (const [i, s] of stages.entries()) {
    const section = page.locator(`section[data-stage="${i}"]`)
    await section.scrollIntoViewIfNeeded()
    await expect(section.getByText(s)).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`Go to stage ${i + 1}:`) })).toHaveAttribute('aria-current', 'step')
  }
  await expect(page.getByText('Illustrative network — not a live investigation')).toBeVisible()
  // stage dots navigate
  await page.getByRole('button', { name: /Go to stage 1:/ }).click()
  await expect(page.getByRole('button', { name: /Go to stage 1:/ })).toHaveAttribute('aria-current', 'step')
  await page.getByRole('link', { name: 'Open Investigation Room' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { name: 'Investigation Room' })).toBeVisible()
})

test('primary CTAs and unknown routes resolve', async ({ page }) => {
  await page.goto('/')
  await page.locator('section[data-stage="4"]').scrollIntoViewIfNeeded()
  await page.getByRole('link', { name: 'Start an Investigation' }).click()
  await expect(page.getByRole('heading', { name: 'New investigation' })).toBeVisible()
  await page.goto('/')
  await page.locator('section[data-stage="4"]').scrollIntoViewIfNeeded()
  await page.getByRole('link', { name: 'Explore the Ronin case' }).click()
  await expect(page.getByRole('heading', { name: 'Historical case' })).toBeVisible()
  await page.goto('/definitely/not/a/route')
  await expect(page).toHaveURL(/\/$/)
})

test('every primary navigation route renders without errors', async ({ page }) => {
  const routes: [string, RegExp][] = [
    ['Overview', /Investigation Room/], ['New investigation', /New investigation/], ['Casebook', /Casebook/],
    ['Historical case', /Historical case/], ['Challenge', /Ghost Attack/], ['Sources & health', /Sources & health/],
  ]
  await page.goto('/app')
  for (const [link, heading] of routes) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading)
  }
})
