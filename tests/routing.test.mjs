import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timeToMinutes, slotActiveAt, slotsOverlap, validateRouting, resolveRoute } from '../lib/routing.js'
import { StateRegistry } from '../lib/state.js'

const at = (h, m = 0, day = 3) => new Date(2026, 7, 19 + (day - 3), h, m) // 2026-08-19 为周三(3)

test('timeToMinutes 解析与越界', () => {
  assert.equal(timeToMinutes('09:30'), 570)
  assert.equal(timeToMinutes('23:59'), 1439)
  assert.throws(() => timeToMinutes('24:00'))
  assert.throws(() => timeToMinutes('9:60'))
  assert.throws(() => timeToMinutes('abc'))
})

test('slotActiveAt：普通/跨天/全天/days', () => {
  const day = { start: '09:00', end: '18:00' }
  assert.equal(slotActiveAt(day, at(9, 0)), true)
  assert.equal(slotActiveAt(day, at(18, 0)), false)
  assert.equal(slotActiveAt(day, at(8, 59)), false)
  const night = { start: '22:00', end: '08:00' }
  assert.equal(slotActiveAt(night, at(23, 30)), true)
  assert.equal(slotActiveAt(night, at(2, 0)), true)
  assert.equal(slotActiveAt(night, at(8, 0)), false)
  assert.equal(slotActiveAt(night, at(12, 0)), false)
  const all = { start: '00:00', end: '00:00' }
  assert.equal(slotActiveAt(all, at(6, 0)), true)
  assert.equal(slotActiveAt(all, at(23, 59)), true)
  const weekdays = { start: '09:00', end: '12:00', days: [1, 2, 3, 4, 5] }
  assert.equal(slotActiveAt(weekdays, at(10, 0, 3)), true) // 周三
  assert.equal(slotActiveAt(weekdays, at(10, 0, 6)), false) // 周六
})

test('slotsOverlap：重叠/跨天/全天/不同 days', () => {
  assert.equal(slotsOverlap({ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }), true)
  assert.equal(slotsOverlap({ start: '09:00', end: '12:00' }, { start: '12:00', end: '14:00' }), false)
  assert.equal(slotsOverlap({ start: '22:00', end: '08:00' }, { start: '07:00', end: '09:00' }), true)
  assert.equal(slotsOverlap({ start: '00:00', end: '00:00' }, { start: '10:00', end: '11:00' }), true)
  assert.equal(slotsOverlap({ start: '09:00', end: '12:00', days: [1] }, { start: '10:00', end: '11:00', days: [2] }), false)
})

test('validateRouting：重叠/失效条目/空优先级', () => {
  const dir = {
    providers: new Set(['deepseek-official', 'scnet']),
    modelsOf: (p) => (p === 'deepseek-official' ? new Set(['deepseek-v4-flash']) : new Set(['DeepSeek-V4-Flash-0731'])),
    usable: (e) => dir.providers.has(e.provider) && dir.modelsOf(e.provider)?.has(e.model),
  }
  const ok = { routing: { slots: [{ id: 'a', start: '09:00', end: '12:00', priority: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }] }] } }
  assert.deepEqual(validateRouting(ok, dir), [])
  const bad = {
    routing: {
      slots: [
        { id: 'a', start: '09:00', end: '12:00', priority: [{ provider: 'ghost', model: 'x' }] },
        { id: 'b', start: '11:00', end: '13:00', priority: [] },
      ],
    },
  }
  const errs = validateRouting(bad, dir)
  assert.ok(errs.some((e) => e.includes('不在当前模型目录')))
  assert.ok(errs.some((e) => e.includes('不能为空')))
  assert.ok(errs.some((e) => e.includes('重叠')))
})

test('resolveRoute：命中时段/默认回退/冷却过滤/全冷却兜底/失效过滤', () => {
  const dir = {
    usable: (e) => e.provider !== 'ghost',
  }
  const cfg = {
    routing: {
      slots: [
        { id: 'day', start: '09:00', end: '18:00', priority: [{ provider: 'scnet', model: 'A' }, { provider: 'deepseek-official', model: 'B' }] },
      ],
      defaultFallback: { provider: 'deepseek-official', model: 'B' },
    },
  }
  const st = new StateRegistry()
  // 时段内
  let r = resolveRoute(cfg, at(10, 0), st, dir)
  assert.equal(r.slot.id, 'day')
  assert.deepEqual(r.entries.map((e) => e.provider), ['scnet', 'deepseek-official'])
  // 时段外 → 默认
  r = resolveRoute(cfg, at(20, 0), st, dir)
  assert.equal(r.slot, null)
  assert.deepEqual(r.entries, [{ provider: 'deepseek-official', model: 'B' }])
  // scnet 冷却 → 跳过
  st.markFailure(at(10, 0).getTime(), { provider: 'scnet', model: 'A' }, 'QUOTA')
  r = resolveRoute(cfg, at(10, 1), st, dir)
  assert.deepEqual(r.entries.map((e) => e.provider), ['deepseek-official'])
  // 全部冷却 → 释放最久冷却
  st.markFailure(at(10, 0).getTime(), { provider: 'deepseek-official', model: 'B' }, 'SERVER')
  r = resolveRoute(cfg, at(10, 1), st, dir)
  assert.equal(r.released?.provider, 'scnet')
  assert.ok(r.entries.length >= 1)
  // 失效条目过滤
  const cfg2 = { routing: { slots: [{ id: 'x', start: '00:00', end: '00:00', priority: [{ provider: 'ghost', model: 'G' }] }] } }
  r = resolveRoute(cfg2, at(10, 0), st, dir)
  assert.deepEqual(r.entries, [{ provider: 'ghost', model: 'G' }]) // 全失效 → 极端兜底放行（目录未知时不过滤）
})
