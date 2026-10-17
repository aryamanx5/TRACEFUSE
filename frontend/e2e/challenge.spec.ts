import { BRIDGE, EXPLOIT_ETH_TX, TORNADO_ROUTER, expect, test } from './fixtures'

const ANSWERS: Record<string, string> = {
  c1: EXPLOIT_ETH_TX, c2: BRIDGE, c3: '25,500,000', c4: 'OFAC SDN — LAZARUS GROUP',
  c5: '2022-04-14', c6: '500', c7: TORNADO_ROUTER, c8: 'Only that the public text contains the address string',
}

test('challenge: answers are verified server-side and progress persists', async ({ page }) => {
  const first = page.waitForResponse((r) => /\/api\/challenges\/[^/]+$/.test(r.url()))
  await page.goto('/app/challenge')
  const view = await (await first).json()
  // no answers or explanations are sent to the browser before solving
  expect(JSON.stringify(view)).not.toContain(EXPLOIT_ETH_TX)
  expect(view.checkpoints.every((c: { explanation: string | null }) => c.explanation === null)).toBe(true)

  const c1 = page.getByRole('region', { name: /The breach/ })
  await c1.getByLabel('Answer').fill('0x' + '1'.repeat(64))
  await c1.getByRole('button', { name: 'Check' }).click()
  await expect(c1.getByRole('alert')).toContainText('Not quite')
  await c1.getByRole('button', { name: /Hint/ }).click()
  await expect(c1.getByText(/ChronoReplay/)).toBeVisible()

  for (const [i, [id, answer]] of Object.entries(ANSWERS).entries()) {
    const section = page.getByRole('region').nth(i)
    const resp = page.waitForResponse((r) => r.url().endsWith(`/checkpoints/${id}/answer`))
    if (id === 'c4' || id === 'c8') await section.getByRole('radio', { name: answer }).check()
    else await section.getByLabel('Answer').fill(answer)
    await section.getByRole('button', { name: 'Check' }).click()
    expect((await (await resp).json()).correct, `checkpoint ${id}`).toBe(true)
    await expect(section.getByText('Correct.')).toBeVisible()
  }
  await expect(page.getByRole('progressbar', { name: 'Challenge progress' })).toHaveAttribute('aria-valuenow', '100')
  await page.reload()
  await expect(page.getByText('8/8 checkpoints')).toBeVisible()
  await page.getByRole('button', { name: 'Reset progress' }).click()
  await expect(page.getByText('0/8 checkpoints')).toBeVisible()
})
