import { test as base, expect, type Page } from '@playwright/test'

export const RONIN = '0x098b716b8aaf21512996dc57eb0615e2383e2f96'
export const BRIDGE = '0x1a2a1c938ce3ec39b6d47113c7955baa9dd454f2'
export const EXPLOIT_ETH_TX = '0xc28fad5e8d5e0ce6a2eaf67b6687be5d58113e16be590824d6cfa1a94467d0b7'
export const TORNADO_ROUTER = '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b'
export const LAUNDER_WALLET = '0x5967524ce3bc2bc422e584e33bd50921a22e3c0a'

/** Every test fails on uncaught page errors or console errors (no silent breakage). */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() !== 'error') return
        const t = m.text()
        // Expected, asserted-on failures (offline backend simulation, 4xx/5xx under test) are not app bugs.
        if (/Failed to load resource|net::ERR_FAILED|ERR_CONNECTION_REFUSED|EventSource/i.test(t)) return
        problems.push(`console: ${t}`)
      })
      await use()
      expect(problems, problems.join('\n')).toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

/** Open the genuine historical Ronin case through the UI and wait for the replayed investigation to finish. */
export async function openHistoricalCase(page: Page): Promise<string> {
  await page.goto('/app/historical')
  await page.getByRole('button', { name: 'Open case in workspace' }).click()
  await page.waitForURL(/\/app\/investigations\/inv_/)
  // loading state: real backend progress events stream while the replay runs (or it finishes immediately)
  await expect(page.getByRole('tab', { name: /Wallet graph/ })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Historical case (recorded)', { exact: true })).toBeVisible()
  return page.url().split('/').pop()!
}

/** Select a wallet through the accessible graph search (the graph itself is a canvas). */
export async function selectWallet(page: Page, address: string) {
  await page.getByRole('tab', { name: /Wallet graph/ }).click()
  await page.getByLabel('Search graph').fill(address)
  await page.getByRole('button', { name: 'Find' }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByTestId('selected-address')).toHaveText(address)
  return inspector
}
