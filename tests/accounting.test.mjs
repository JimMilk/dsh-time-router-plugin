import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPeakAt, shanghaiHM, costFor, DEFAULT_PRICING } from '../lib/accounting.js'

// 构造 Asia/Shanghai 时刻的 Date（用 UTC 反推：上海 = UTC+8）
const atShanghai = (h, m = 0) => {
  const d = new Date(Date.UTC(2026, 7, 19, h - 8, m))
  return d
}

test('shanghaiHM 时区换算', () => {
  assert.deepEqual(shanghaiHM(atShanghai(9, 30)), { hour: 9, minute: 30 })
})

test('峰谷判定边界', () => {
  assert.equal(isPeakAt(atShanghai(9, 0)), true)
  assert.equal(isPeakAt(atShanghai(11, 59)), true)
  assert.equal(isPeakAt(atShanghai(12, 0)), false)
  assert.equal(isPeakAt(atShanghai(14, 0)), true)
  assert.equal(isPeakAt(atShanghai(17, 59)), true)
  assert.equal(isPeakAt(atShanghai(18, 0)), false)
  assert.equal(isPeakAt(atShanghai(8, 59)), false)
})

test('costFor：cache 拆分与高峰加倍', () => {
  const rates = { hit: 0.05, miss: 1.5, output: 4.5 }
  const usage = { inputTokens: 1_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 100_000, outputTokens: 200_000 }
  // 空闲：1M×1.5 + 0.5M×0.05 + 0.1M×1.5 + 0.2M×4.5 = 1.5+0.025+0.15+0.9 = 2.575
  assert.equal(costFor(usage, rates, false), 2.575)
  assert.equal(costFor(usage, rates, true), 5.15)
  assert.equal(costFor({ inputTokens: 1000 }, null, false), null)
})

test('默认价目表含 v4-flash，不含未核对项', () => {
  assert.ok(DEFAULT_PRICING.deepseekOfficial['deepseek-v4-flash'])
  assert.equal(DEFAULT_PRICING.deepseekOfficial['deepseek-v4-pro'], undefined)
  assert.deepEqual(DEFAULT_PRICING.scnet, {})
})
