import { LAUNDER_WALLET, RONIN, expect, openHistoricalCase, selectWallet, test } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('2D fund flow: layered view, simplified/full graph, trace path and stable replay', async ({ page }) => {
  await openHistoricalCase(page)
  const flow = page.getByTestId('flow-2d')
  await expect(flow).toHaveAttribute('data-layout-version', /\d+/)
  const count = page.getByTestId('flow-count')
  await expect(count).toHaveText(/^\d+ of \d+ wallets drawn$/)
  const [shown, total] = (await count.textContent())!.match(/\d+/g)!.map(Number)
  expect(shown).toBeLessThan(total) // simplified view, and it says so
  await expect(page.getByText(/smaller wallets are grouped into “\+ more”/)).toBeVisible()

  // trace the route from the starting wallet to a laundering wallet
  const inspector = await selectWallet(page, LAUNDER_WALLET)
  await page.getByRole('button', { name: 'Trace path' }).click()
  await expect(page.getByText(/Route to .+: 2 transfers from the starting wallet/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Isolate' })).toHaveAttribute('aria-pressed', 'true')
  await expect(inspector.getByText(/Why this wallet was flagged/)).toBeVisible()

  // replay: the graph never re-lays out and the page never moves while playing
  const version = await flow.getAttribute('data-layout-version')
  const box = await flow.boundingBox()
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const replay = page.getByRole('region', { name: 'ChronoReplay timeline' })
  await replay.getByRole('button', { name: /Play/ }).click()
  await expect(replay.getByText(/transfer [3-9]\d*\/\d+/)).toBeVisible({ timeout: 10_000 })
  await expect(replay.getByText(/At this moment \(calculated by the server\)/)).toBeVisible()
  expect(await flow.getAttribute('data-layout-version')).toBe(version)
  expect(await flow.boundingBox()).toEqual(box)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height)
  await replay.getByRole('button', { name: /Pause/ }).click()
  await replay.getByRole('button', { name: 'Show all' }).click()

  await page.getByRole('button', { name: 'Show full graph' }).click()
  await expect(count).toHaveText(`${total} of ${total} wallets drawn`)
  await expect(page.getByText(/Full graph/)).toBeVisible()
  await page.getByRole('button', { name: 'Simplified view' }).click()
  await page.getByRole('button', { name: 'Reset layout' }).click()
  await expect(count).toHaveText(`${shown} of ${total} wallets drawn`)
})

test('3D network: same data, selection carried across, path tools, back to 2D', async ({ page }) => {
  await openHistoricalCase(page)
  await selectWallet(page, LAUNDER_WALLET)
  const drawn2d = Number((await page.getByTestId('flow-count').textContent())!.match(/\d+/)![0])
  await page.getByRole('button', { name: '3D Network' }).click()
  const scene = page.getByTestId('flow-3d')
  await expect(scene).toBeVisible()
  await expect(scene.locator('canvas')).toHaveCount(1)
  await expect.poll(async () => Number(await scene.getAttribute('data-nodes'))).toBeGreaterThanOrEqual(drawn2d) // same wallets (+ “more” markers)
  // the HUD describes the wallet that was selected in 2D
  const hud = page.getByTestId('hud-selected')
  await expect(hud).toContainText('0x5967524c')
  await page.getByRole('button', { name: 'Trace path' }).click()
  await expect(hud).toContainText('Route: 2 transfers from the starting wallet')
  await page.getByRole('button', { name: 'Isolate' }).click()
  await expect(page.getByRole('button', { name: 'Isolate' })).toHaveAttribute('aria-pressed', 'false')
  await hud.getByRole('button', { name: 'Focus wallet' }).click()
  await page.getByRole('button', { name: 'Reset camera' }).click()
  // keyboard path: choosing a wallet from the list updates the 3D selection
  await page.locator('summary', { hasText: 'Wallet list' }).click()
  await page.getByRole('list', { name: 'Wallets in graph' }).getByRole('button').first().click()
  await expect(hud).toContainText('Starting wallet')
  // expand downstream reveals more of the real recipients
  const before = Number(await scene.getAttribute('data-nodes'))
  await hud.getByRole('button', { name: 'Expand downstream' }).click()
  await expect.poll(async () => Number(await scene.getAttribute('data-nodes'))).toBeGreaterThan(before)
  // back to 2D with the same selection
  await page.getByRole('button', { name: '2D Fund flow' }).click()
  await expect(page.getByTestId('flow-2d')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByTestId('selected-address')).toHaveText(RONIN)
})
