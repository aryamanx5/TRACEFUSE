import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, openHistoricalCase, test } from './fixtures'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const lines = r.violations.map((v) => `${label} [${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  return lines
}

for (const scheme of ['dark', 'light'] as const) {
  test(`axe: no WCAG 2.1 AA violations (${scheme} theme)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    const found: string[] = []
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible() // lazy route rendered
    found.push(...(await audit(page, 'landing')))
    for (const path of ['/app', '/app/new', '/app/cases', '/app/historical', '/app/challenge', '/app/status']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      found.push(...(await audit(page, path)))
    }
    await openHistoricalCase(page)
    await page.waitForLoadState('networkidle')
    for (const tab of ['graph', 'matrix', 'fusion', 'scores', 'evidence', 'crosschain', 'metrics']) {
      await page.locator(`#tab-${tab}`).click()
      await page.waitForLoadState('networkidle')
      found.push(...(await audit(page, `workspace:${tab}`)))
    }
    expect(found, found.join('\n')).toEqual([])
  })
}
