import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tapUsage } from '../lib/usage.js'

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
