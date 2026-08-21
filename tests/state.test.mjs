import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StateRegistry, COOLDOWN_BASE_MS, COOLDOWN_MAX_MS } from '../lib/state.js'

const E = { provider: 'scnet', model: 'A' }

test('冷却退避：300s 起、指数 2×、上限 1h', () => {
  const st = new StateRegistry()
  const t0 = 1_000_000
  assert.equal(st.markFailure(t0, E, 'QUOTA'), COOLDOWN_BASE_MS)
  assert.equal(st.statusAt(t0 + 1, E), 'cooling')
  assert.equal(st.isCooling(t0 + 1, E), true)
  assert.equal(st.markFailure(t0 + 10, E, 'QUOTA'), COOLDOWN_BASE_MS * 2)
  // 连续失败到上限
  let backoff = 0
  let now = t0
  for (let i = 0; i < 20; i++) { now += 1; backoff = st.markFailure(now, E, 'x') }
  assert.equal(backoff, COOLDOWN_MAX_MS)
})

test('half-open：到期后可候选，真实请求成功恢复', () => {
  const st = new StateRegistry()
  const t0 = 1_000_000
  st.markFailure(t0, E, 'QUOTA')
  const expire = t0 + COOLDOWN_BASE_MS
  assert.equal(st.statusAt(expire, E), 'half-open')
  assert.equal(st.isCooling(expire, E), false)
  st.markSuccess(expire, E)
  assert.equal(st.statusAt(expire, E), 'healthy')
})

test('探测：healthy 失败→冷却；half-open 2 连成功→恢复；cooling 失败不延长', () => {
  const st = new StateRegistry()
  const t0 = 1_000_000
  // healthy 探测失败 → cooling
  st.markProbe(t0, E, false, 2)
  assert.equal(st.statusAt(t0, E), 'cooling')
  // cooling 探测失败 → 到期时间不变
  st.markProbe(t0 + 10, E, false, 2)
  assert.equal(st.entry(E).coolUntil, t0 + COOLDOWN_BASE_MS)
  // 到期后 half-open：1 次成功不足，2 次成功恢复
  const expire = t0 + COOLDOWN_BASE_MS
  st.markProbe(expire, E, true, 2)
  assert.equal(st.statusAt(expire, E), 'half-open')
  st.markProbe(expire + 1, E, true, 2)
  assert.equal(st.statusAt(expire + 1, E), 'healthy')
  assert.equal(st.entry(E).failures, 0)
})

test('半开探测失败 → 回到冷却且退避升级', () => {
  const st = new StateRegistry()
  const t0 = 1_000_000
  st.markFailure(t0, E, 'x')
  const expire = t0 + COOLDOWN_BASE_MS
  assert.equal(st.statusAt(expire, E), 'half-open')
  st.markProbe(expire, E, false, 2)
  assert.equal(st.statusAt(expire + 1, E), 'cooling')
  assert.equal(st.entry(E).coolUntil, expire + COOLDOWN_BASE_MS * 2)
})

test('releaseLongestCooling：选最久冷却', () => {
  const st = new StateRegistry()
  const t0 = 1_000_000
  st.markFailure(t0, { provider: 'a', model: '1' }, 'x')
  st.markFailure(t0 + 5, { provider: 'b', model: '2' }, 'x')
  const released = st.releaseLongestCooling(t0 + 10, [{ provider: 'a', model: '1' }, { provider: 'b', model: '2' }])
  assert.deepEqual(released, { provider: 'a', model: '1' })
  assert.equal(st.statusAt(t0 + 10, released), 'half-open')
})
