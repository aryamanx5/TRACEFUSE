import { BRIDGE, EXPLOIT_ETH_TX, LAUNDER_WALLET, RONIN, TORNADO_ROUTER, expect, openHistoricalCase, selectWallet, test } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('historical Ronin investigation: wallet inspection, transaction evidence and source links', async ({ page }) => {
  await openHistoricalCase(page)
  await expect(page.getByText(/recorded real provider responses/)).toBeVisible()

  // seed wallet: sanctions evidence with the official source
  let inspector = await selectWallet(page, RONIN)
  await expect(inspector.getByTestId('selected-address')).toHaveText(RONIN)
  await expect(inspector.getByText(/Tracing status: Starting wallet/)).toBeVisible()
  await inspector.getByRole('button', { name: /OFAC SDN: LAZARUS GROUP/ }).click()
  await expect(inspector.getByText('Source-reported information', { exact: true })).toBeVisible()
  await expect(inspector.getByRole('link', { name: /open original/ })).toHaveAttribute('href', /sanctionslistservice\.ofac\.treas\.gov/)
  await expect(inspector.getByText(/does not by itself prove/)).toBeVisible()

  // laundering wallet: details belong to the selected address (not the previous selection)
  inspector = await selectWallet(page, LAUNDER_WALLET)
  await expect(inspector.getByTestId('selected-address')).toHaveText(LAUNDER_WALLET)
  await expect(inspector.getByText(/Funds entered a mixing\/privacy contract/)).toBeVisible()
  const tornadoRows = inspector.getByRole('row').filter({ hasText: '→ out' }).filter({ hasText: '100 ETH' })
  expect(await tornadoRows.count()).toBeGreaterThan(10)
  await expect(tornadoRows.first().getByRole('link')).toHaveAttribute('href', /eth\.blockscout\.com\/tx\/0x/)
  await expect(inspector.getByText(/Lead score \(heuristic, not a probability\):/)).toBeVisible()

  // the 173,600 ETH exploit transfer from the bridge is reachable as an observed edge
  inspector = await selectWallet(page, BRIDGE)
  await expect(inspector.getByRole('button', { name: /Explorer label: Ronin Bridge V1/ })).toBeVisible()
  const exploitRow = inspector.getByRole('row').filter({ hasText: '173,600 ETH' })
  await expect(exploitRow.getByRole('link')).toHaveAttribute('href', new RegExp(EXPLOIT_ETH_TX))
})

test('ChronoReplay playback, stepping and time-window filtering drive the graph', async ({ page }) => {
  await openHistoricalCase(page)
  const replay = page.getByRole('region', { name: 'ChronoReplay timeline' })
  const graphTab = page.getByRole('tab', { name: /Money flow/ })
  const count = async () => Number((await graphTab.textContent())!.replace(/\D/g, '') || 0)
  await expect.poll(count).toBeGreaterThan(50) // graph loaded
  const fullCount = await count()

  await replay.getByRole('button', { name: /Play/ }).click()
  await expect(replay.getByRole('button', { name: /Pause/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(replay.getByText(/Replaying to 2022-03-23/)).toBeVisible()
  await expect(replay.getByText(/transfer [2-9]\d*\/\d+/)).toBeVisible({ timeout: 10_000 })
  await replay.getByRole('button', { name: /Pause/ }).click()
  const before = await replay.getByText(/transfer \d+\/\d+/).textContent()
  await replay.getByRole('button', { name: 'Next transfer' }).click()
  await expect(replay.getByText(/transfer \d+\/\d+/)).not.toHaveText(before!)
  // server-computed figures for the cursor instant
  await expect(replay.getByText(/At this moment \(calculated by the server\): \d+ transfers/)).toBeVisible()
  // snapshot the 173,600 ETH exploit transfer is part of the very first minutes
  await expect(replay.getByText(/173,60\d/)).toBeVisible()

  // apply cursor as the analysis window end → every view is refiltered server-side
  await replay.locator('summary', { hasText: 'Time window' }).click() // the window controls live in a popover
  await replay.getByRole('button', { name: 'Analyse up to this moment' }).click()
  await expect(replay.getByLabel('To')).not.toHaveValue('')
  await expect.poll(count).toBeLessThan(fullCount)

  // explicit window with no recorded activity → honest empty states
  await replay.getByLabel('From').fill('2022-03-20T00:00')
  await replay.getByLabel('To').fill('2022-03-21T00:00')
  await expect(page.getByText('ChronoReplay: no timestamped transfers in the current filter.')).toBeVisible()
  await expect(page.getByText('No transfers match the current filter.')).toBeVisible()
  await page.getByRole('tab', { name: 'Matrix' }).click()
  await expect(page.getByText('No transfers in this window')).toBeVisible()
  await page.getByRole('button', { name: 'Clear window' }).click()
  await expect.poll(count).toBe(fullCount)
})

test('Matrix Mode: value measure, cell selection and underlying transaction drill-down', async ({ page }) => {
  await openHistoricalCase(page)
  await page.getByRole('tab', { name: 'Matrix' }).click()
  const panel = page.getByRole('tabpanel')
  await panel.getByLabel('Measure').selectOption('value')
  await panel.getByLabel('Asset').selectOption({ label: 'ETH' })
  await expect(panel.getByText(/Values are exact per-asset sums/)).toBeVisible()
  const cell = panel.getByRole('grid').getByRole('button', { name: /transfer\(s\)/ }).first()
  const label = (await cell.getAttribute('aria-label'))!
  const n = Number(label.match(/(\d+) transfer/)![1])
  await cell.hover()
  await expect(panel.getByText('Click to open the underlying transactions.')).toBeVisible()
  await cell.click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByText(`${n} underlying transfer(s)`)).toBeVisible()
  await expect(inspector.getByRole('row').filter({ hasText: 'ETH' })).toHaveCount(n)
  // keyboard: cells are focusable buttons
  await cell.focus()
  await expect(cell).toBeFocused()
})

test('Evidence Fusion graph: statuses, conflicts and relationship details', async ({ page }) => {
  await openHistoricalCase(page)
  await page.getByRole('tab', { name: 'Connected evidence' }).click()
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText(/Competing \/ changing evidence/)).toBeVisible()
  await expect(panel.getByText(/designation and removal actions over time/)).toBeVisible()
  await panel.getByText(/Relationship list \(\d+\)/).click()
  const list = panel.getByRole('list', { name: 'Fusion relationships' })
  await list.getByRole('button', { name: /sanctions listing/ }).first().click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByText('sanctions listing', { exact: true })).toBeVisible()
  await expect(inspector.getByText('Source-reported information', { exact: true })).toBeVisible()
  await expect(inspector.getByText('confidence: confirmed')).toBeVisible()
  // filtering by assertion status changes what is shown
  const countText = panel.getByText(/\d+ entities · \d+ relationships/)
  const before = await countText.textContent()
  await panel.getByLabel('Source-reported information').uncheck()
  await expect(countText).not.toHaveText(before!)
  // the mixer is reported as an unresolved blind spot, not traced through
  await page.getByRole('tab', { name: 'Across blockchains' }).click()
  await expect(page.getByRole('tabpanel').getByText(TORNADO_ROUTER)).toBeVisible()
  await expect(page.getByRole('tabpanel').getByText('unresolved').first()).toBeVisible()
})

test('explainable ranking re-evaluates with toggled signals', async ({ page }) => {
  await openHistoricalCase(page)
  await page.getByRole('tab', { name: 'Priority leads' }).click()
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText(/Not a probability/)).toBeVisible()
  const firstScore = panel.locator('tbody tr').first().locator('td').nth(2)
  const before = await firstScore.textContent()
  await panel.getByRole('button', { name: /^Explain score for 0x/ }).first().click()
  await expect(panel.getByText('Supporting facts / missing inputs')).toBeVisible()
  await panel.getByRole('checkbox', { name: 'Official sanctions listing (OFAC SDN exact match)' }).uncheck()
  const resp = page.waitForResponse((r) => r.url().includes('/scores') && r.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Re-evaluate' }).click()
  expect((await resp).status()).toBe(200)
  await expect(firstScore).not.toHaveText(before!)
})

test('HTML, JSON and CSV exports are downloadable and populated', async ({ page }) => {
  const invId = await openHistoricalCase(page)
  const html = await page.request.get(`/api/investigations/${invId}/report.html`)
  expect(html.status()).toBe(200)
  const body = await html.text()
  expect(body).toContain('Historical case')
  expect(body).toContain('makes no claim that any particular person is the attacker')
  expect(body).not.toContain('<script')
  const json = await (await page.request.get(`/api/investigations/${invId}/report.json`)).json()
  expect(json.investigation.data_origin).toBe('historical_case')
  expect(json.observed_facts.transfers.length).toBeGreaterThan(100)
  for (const kind of ['transfers', 'scores', 'evidence']) {
    const r = await page.request.get(`/api/investigations/${invId}/export/${kind}.csv`)
    expect(r.status()).toBe(200)
    expect(r.headers()['content-disposition']).toContain(`${kind}.csv`)
    const lines = (await r.text()).trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
  }
  // the UI buttons trigger real downloads (grouped in the Export menu)
  await page.locator('summary', { hasText: 'Export' }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Transfers CSV' }).click()
  expect((await dl).suggestedFilename()).toBe(`tracefuse-${invId}-transfers.csv`)
  const dl2 = page.waitForEvent('download') // the menu stays open after a download
  await page.getByRole('link', { name: 'HTML', exact: true }).click()
  expect((await dl2).suggestedFilename()).toBe(`tracefuse-${invId}.html`)
})

test('filters: asset selection and hidden wallets refilter the graph server-side', async ({ page }) => {
  await openHistoricalCase(page)
  const graphTab = page.getByRole('tab', { name: /Money flow/ })
  const count = async () => Number((await graphTab.textContent())!.replace(/\D/g, '') || 0)
  await expect.poll(count).toBeGreaterThan(50)
  const full = await count()
  await page.locator('summary', { hasText: 'Filters' }).click()
  await page.getByRole('checkbox', { name: /^USDC/ }).check()
  await expect(page.getByText('1 asset(s)')).toBeVisible()
  await expect.poll(count).toBeLessThan(full)
  await page.getByRole('checkbox', { name: /^USDC/ }).uncheck()
  await expect.poll(count).toBe(full)
  await page.locator('summary', { hasText: 'Filters' }).click() // close the filter popover

  const inspector = await selectWallet(page, LAUNDER_WALLET)
  await inspector.getByRole('button', { name: 'Hide from graph' }).click()
  await expect(page.getByText(/Hidden 0x5967/)).toBeVisible()
  await expect.poll(count).toBeLessThan(full)
  await expect(page.getByText('1 hidden')).toBeVisible()
  await page.locator('summary', { hasText: 'Filters' }).click()
  await page.getByRole('button', { name: /^Show 0x[0-9a-f]+ in views again$/ }).click()
  await expect.poll(count).toBe(full)
})
