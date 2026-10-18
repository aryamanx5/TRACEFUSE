import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const CHAPTERS = [
  ['signal', 'The signal'], ['fragmentation', 'Fragmentation'], ['disconnected', 'Disconnected intelligence'],
  ['fusion', 'Evidence fusion'], ['capabilities', 'What it enables'], ['enter', 'Enter the investigation'],
] as const

/** Scroll so a chapter is fully composed: the middle of a pinned stretch, or just inside a flowing section. */
async function settle(page: Page, id: string) {
  await page.locator(`#${id}`).waitFor({ state: 'attached' }) // the story is a lazy route
  await page.evaluate((id) => {
    const s = document.getElementById(id)!
    const pinned = s.classList.contains('tfl-pin') || id === 'signal'
    window.scrollTo(0, s.offsetTop + (pinned ? Math.max(0, s.offsetHeight - window.innerHeight) * 0.55 : Math.min(320, s.offsetHeight / 3)))
  }, id)
}
const heroAt = (page: Page, k: number) => page.evaluate((k) => {
  const s = document.getElementById('signal')!
  window.scrollTo(0, s.offsetTop + (s.offsetHeight - window.innerHeight) * k)
}, k)
const videoTime = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)

test('landing story: six chapters with a live index, hero footage scrubbed both ways, enters the app', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/TRACEFUSE/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Follow the money.')
  await expect(page.locator('img.tfl-media')).toBeVisible() // poster first
  await expect(page.locator('#signal')).toHaveAttribute('data-media', 'ready', { timeout: 30_000 })

  // scroll is the clock: the end of the opening shows the end of the footage, scrolling back reverses it
  await heroAt(page, 1)
  await expect.poll(() => videoTime(page)).toBeGreaterThan(9)
  await heroAt(page, 0.2)
  await expect.poll(() => videoTime(page)).toBeLessThan(4)
  await expect.poll(() => videoTime(page)).toBeGreaterThan(1)
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)

  for (const [i, [id, label]] of CHAPTERS.entries()) {
    await settle(page, id)
    await expect(page.locator(`#${id} :is(h1, h2)`).first()).toBeVisible()
    await expect(page.getByRole('button', { name: `${String(i + 1).padStart(2, '0')} ${label}` })).toHaveAttribute('aria-current', 'step')
  }
  await expect(page.getByText('Illustrative branching path — not live transaction data.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Every colour has a job.' })).toBeAttached()
  await page.getByRole('button', { name: '01 The signal' }).click()
  await expect(page.getByRole('button', { name: '01 The signal' })).toHaveAttribute('aria-current', 'step')
  await page.getByRole('banner').getByRole('link', { name: 'Investigation Room' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { name: 'Investigation Room' })).toBeVisible()
})

test('primary CTAs, replay and unknown routes resolve', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Enter the investigation' }).first().click()
  await expect(page.getByRole('heading', { name: 'Investigation Room' })).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: 'See how it works' }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
  await settle(page, 'enter')
  await page.getByRole('button', { name: 'Replay the story' }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 15_000 }).toBeLessThan(5)
  await expect(page.locator('#signal-title')).toBeFocused()
  await settle(page, 'enter')
  await page.getByRole('link', { name: 'Enter the investigation' }).last().click()
  await expect(page.getByRole('heading', { name: 'Investigation Room' })).toBeVisible()
  await page.goto('/')
  await settle(page, 'enter')
  await page.getByRole('link', { name: 'Explore the Ronin case' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Historical case' })).toBeVisible()
  await page.goto('/definitely/not/a/route')
  await expect(page).toHaveURL(/\/$/)
})

test('a failed hero video leaves the poster in place', async ({ page }) => {
  await page.route('**/media/tracefuse-hero.mp4', (r) => r.abort())
  await page.goto('/')
  await expect(page.locator('#signal')).toHaveAttribute('data-media', 'failed')
  await expect(page.locator('img.tfl-media')).toBeVisible()
  await expect(page.locator('video')).toHaveCSS('opacity', '0')
  await settle(page, 'enter')
  await expect(page.getByRole('link', { name: 'Enter the investigation' }).last()).toBeVisible()
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
