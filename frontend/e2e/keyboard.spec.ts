import AxeBuilder from '@axe-core/playwright'
import { RONIN, expect, openHistoricalCase, test } from './fixtures'

test('skip link moves focus past navigation', async ({ page }) => {
  await page.goto('/app/cases')
  await expect(page.getByRole('heading', { name: 'Casebook' })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skip).toBeFocused()
  // visible focus indicator
  expect(await skip.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
  await page.keyboard.press('Tab')
  const inMain = await page.evaluate(() => !!document.activeElement?.closest('main'))
  expect(inMain).toBe(true)
})

test('workspace tabs follow the WAI-ARIA pattern; wallets and cells are keyboard operable', async ({ page }) => {
  await openHistoricalCase(page)
  const tablist = page.getByRole('tablist', { name: 'Analysis views' })
  await expect(tablist.locator('[role=tab][tabindex="0"]')).toHaveCount(1) // single tab stop
  await page.locator('#tab-graph').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#tab-matrix')).toBeFocused()
  await expect(page.locator('#tab-matrix')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.locator('#tab-metrics')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.locator('#tab-graph')).toHaveAttribute('aria-selected', 'true')

  // wallet list: keyboard path into the graph (canvas alternative)
  const summary = page.locator('summary', { hasText: 'Wallet list' })
  await summary.focus()
  await page.keyboard.press('Enter')
  const seedButton = page.getByRole('list', { name: 'Wallets in graph' }).getByRole('button').first()
  await seedButton.focus()
  await page.keyboard.press('Enter')
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByTestId('selected-address')).toHaveText(RONIN)
  await expect(page.getByText(`Inspector shows wallet ${RONIN}`)).toBeAttached() // polite live region

  // matrix cell via keyboard
  await page.locator('#tab-graph').focus()
  await page.keyboard.press('ArrowRight')
  const cell = page.getByRole('grid').getByRole('button', { name: /transfer\(s\)/ }).first()
  await cell.focus()
  await page.keyboard.press('Enter')
  await expect(inspector.getByText(/underlying transfer\(s\)/)).toBeVisible()

  // inspector state with open panels has no violations
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).include('aside[aria-label="Inspector"]').analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
})

test('evidence records and score explanations are reachable and distinctly named for keyboard/screen-reader users', async ({ page }) => {
  await openHistoricalCase(page)
  await page.locator('#tab-evidence').click()
  const inspect = page.getByRole('tabpanel').getByRole('button', { name: /^Inspect sanctions listing: OFAC SDN/ }).first()
  await inspect.focus()
  await page.keyboard.press('Enter')
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByText(/OFAC SDN: LAZARUS GROUP/).first()).toBeVisible()
  await expect(page.getByText(/^Inspector shows evidence: OFAC SDN/)).toBeAttached()
  await page.locator('#tab-scores').click()
  await expect(page.getByRole('tabpanel').getByRole('button', { name: /^Explain score for/ }).first()).toBeVisible()
  const names = await page.getByRole('tabpanel').getByRole('button', { name: /^Explain score for/ }).evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names.length).toBeGreaterThan(5)
  expect(new Set(names).size).toBe(names.length)
})

test('modal dialog traps focus, closes on Escape and returns focus', async ({ page }) => {
  await page.goto('/app/cases')
  await page.getByLabel('New case').fill('Keyboard dialog case')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/app\/cases\/case_/)
  const trigger = page.getByRole('button', { name: 'Delete case…' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Delete case?' })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog') || document.activeElement === document.body)).toBe(true)
  }
  const r = await new AxeBuilder({ page }).include('dialog').analyze()
  expect(r.violations.map((v) => v.id)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Keyboard dialog case' })).toBeVisible() // not deleted
})

test('reduced motion is honoured in a real browser', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('header .origin-left')).toHaveCount(0)
  await page.locator('section[data-stage="4"]').scrollIntoViewIfNeeded()
  // with reduced motion the final-stage graphic appears immediately (duration 0, no animation)
  await expect(page.locator('.sticky svg').getByText('CHRONOREPLAY')).toBeVisible({ timeout: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('header .origin-left')).toHaveCount(1)
})
