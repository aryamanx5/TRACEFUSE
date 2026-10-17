import { expect, test } from '@playwright/test'

// Genuine live-provider check (network + public Blockscout/GoPlus). Opt-in: npm run e2e:live
test('live Ethereum investigation from a transaction hash returns real, live-labelled data', async ({ page }) => {
  await page.goto('/app/new')
  await page.getByLabel(/^Seed/).fill('0xed2c72ef1a552ddaec6dd1f5cddf0b59a8f37f82bdda5257d9c7c37db7bb9b08')
  await expect(page.getByText('✓ Valid transaction hash')).toBeVisible()
  await page.getByLabel('Hop depth: 2').fill('1')
  await page.getByLabel('From', { exact: true }).fill('2022-03-23T13:00')
  await page.getByLabel('To', { exact: true }).fill('2022-03-24T00:00')
  await page.getByLabel('GitHub public mentions (rate-limited)').uncheck()
  await page.getByRole('button', { name: 'Start investigation' }).click()
  await page.waitForURL(/\/app\/investigations\/inv_/)
  await expect(page.getByRole('tab', { name: /Wallet graph/ })).toBeVisible({ timeout: 240_000 })
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  const id = page.url().split('/').pop()
  const r = await (await page.request.get(`/api/investigations/${id}/transfers?limit=5`)).json()
  expect(r.total).toBeGreaterThan(0)
  expect(r.items[0].provenance.data_origin).toMatch(/live|cached/)
})
