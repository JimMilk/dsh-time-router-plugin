import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageLog, tapUsage } from '../lib/usage.js'

async function* fakeStream() {
  yield { type: 'block-start', block: { kind: 'text', id: 'b1' } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'text-delta', blockId: 'b1', text: 'hi' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

test('tapUsage：采集 usage、透传全部 chunk、直连与路由调用统一入账', async () => {
  const records = []
  const out = []
  for await (const c of tapUsage(fakeStream(), { provider: 'scnet', model: 'A' }, (e, u, k) => records.push({ e, u, k }))) {
    out.push(c)
  }
  assert.equal(out.length, 4)
  assert.equal(out[3].type, 'finish')
  assert.equal(records.length, 1)
  assert.equal(records[0].e.provider, 'scnet')
  assert.equal(records[0].u.inputTokens, 10)
  assert.equal(records[0].k, 'request')
})

test('tapUsage：探针标记为 probe', async () => {
  const kinds = []
  for await (const _c of tapUsage(fakeStream(), { provider: 'official', model: 'B', __probe: true }, (_e, _u, k) => kinds.push(k))) {
    // drain
  }
  assert.deepEqual(kinds, ['probe'])
})

test('tapUsage：record 抛错不影响请求流', async () => {
  const out = []
  for await (const c of tapUsage(fakeStream(), { provider: 'x', model: 'y' }, () => { throw new Error('boom') })) {
    out.push(c)
  }
  assert.equal(out.length, 4)
})

test('trend：按日聚合近 N 天（含跨天）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tr-usage-'))
  const log = new UsageLog(dir)
  log.append({ t: '2026-08-21T02:00:00Z', kind: 'request', provider: 'scnet', model: 'A', usage: { inputTokens: 100, outputTokens: 20 }, costCny: 0.1 })
  log.append({ t: '2026-08-20T02:00:00Z', kind: 'request', provider: 'deepseek-official', model: 'B', usage: { inputTokens: 50, outputTokens: 10 }, costCny: 0.05 })
  log.append({ t: '2026-08-20T03:00:00Z', kind: 'probe', provider: 'deepseek-official', model: 'B', usage: { inputTokens: 1, outputTokens: 1 } })
  const trend = log.trend(3)
  assert.equal(trend.length, 3)
  const byDate = {}
  trend.forEach((d) => { byDate[d.date] = d })
  assert.equal(byDate['2026-08-20'].requests, 1)
  assert.equal(byDate['2026-08-20'].probes, 1)
  assert.equal(byDate['2026-08-20'].costCny, 0.05)
  assert.equal(byDate['2026-08-21'].byProvider.scnet.input, 100)
  assert.equal(byDate['2026-08-19'].requests, 0)
})
