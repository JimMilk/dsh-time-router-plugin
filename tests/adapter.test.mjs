// 适配器行为测试：fake llm 模拟底层 provider（需在 harness 目录以 tsx 运行）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TimeRouterAdapter, isDegradable } from '../lib/adapter.js'
import { StateRegistry } from '../lib/state.js'

function fakeLlm(scenario) {
  return {
    stream(options) {
      const p = options.provider
      const s = scenario[p] ?? 'ok'
      return (async function* () {
        if (s === 'quota') {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'QUOTA', message: 'quota exceeded' } } }
          return
        }
        if (s === 'server') {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'boom' } } }
          return
        }
        if (s === 'midstream') {
          yield { type: 'block-start', block: { kind: 'text', id: 'b1' } }
          yield { type: 'text-delta', blockId: 'b1', text: 'partial' }
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'late fail' } } }
          return
        }
        yield { type: 'block-start', block: { kind: 'text', id: 'b1' } }
        yield { type: 'text-delta', blockId: 'b1', text: 'hi' }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
        yield { type: 'block-end', blockId: 'b1' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

const cfg = {
  routing: {
    slots: [{ id: 'all', start: '00:00', end: '00:00', priority: [{ provider: 'scnet', model: 'A' }, { provider: 'official', model: 'B' }] }],
    defaultFallback: { provider: 'official', model: 'B' },
  },
}
const directory = { usable: () => true, models: new Map() }
const makeAdapter = (scenario, state) => new TimeRouterAdapter({
  llm: fakeLlm(scenario),
  getConfig: () => cfg,
  directory: () => directory,
  state,
  onUsage: () => {},
  onFailure: () => {},
  onRouteChange: () => {},
})

const collect = async (iter) => {
  const chunks = []
  for await (const c of iter) chunks.push(c)
  return chunks
}

test('正常：优先走 scnet，透传 usage 与 finish', async () => {
  const st = new StateRegistry()
  const chunks = await collect(makeAdapter({ scnet: 'ok' }, st).stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.ok(chunks.some((c) => c.type === 'text-delta'))
  assert.ok(chunks.some((c) => c.type === 'usage'))
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('首包前 QUOTA：降级到下一优先级并冷却', async () => {
  const st = new StateRegistry()
  const calls = []
  const adapter = makeAdapter({ scnet: 'quota', official: 'ok' }, st)
  const orig = adapter.llm.stream.bind(adapter.llm)
  adapter.llm.stream = (o) => { calls.push(o.provider); return orig(o) }
  const chunks = await collect(adapter.stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.deepEqual(calls, ['scnet', 'official'])
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(st.statusAt(Date.now(), { provider: 'scnet', model: 'A' }), 'cooling')
})

test('全部失败：输出 error finish，两个入口均冷却', async () => {
  const st = new StateRegistry()
  const chunks = await collect(makeAdapter({ scnet: 'quota', official: 'server' }, st).stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(st.statusAt(Date.now(), { provider: 'scnet', model: 'A' }), 'cooling')
  assert.equal(st.statusAt(Date.now(), { provider: 'official', model: 'B' }), 'cooling')
})

test('流中失败：透传 error finish，不降级（交 llm-retry）', async () => {
  const st = new StateRegistry()
  const chunks = await collect(makeAdapter({ scnet: 'midstream' }, st).stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.ok(chunks.some((c) => c.type === 'text-delta'))
  assert.equal(chunks.at(-1).reason.kind, 'error')
  // 已发出内容 → 该入口不应被标记冷却
  assert.equal(st.statusAt(Date.now(), { provider: 'scnet', model: 'A' }), 'healthy')
})

test('isDegradable：稳定码/HTTP 码/配额文案', () => {
  assert.equal(isDegradable({ code: 'QUOTA' }), true)
  assert.equal(isDegradable({ code: 'RATE_LIMIT' }), true)
  assert.equal(isDegradable({ code: 'HTTP_402' }), true)
  assert.equal(isDegradable({ code: 'HTTP_422' }), true)
  assert.equal(isDegradable({ code: 'HTTP_404' }), false)
  assert.equal(isDegradable({ code: 'HTTP_503' }), true)
  assert.equal(isDegradable({ code: 'ABORTED' }), false)
  assert.equal(isDegradable({ code: 'HTTP_429', message: 'quota balance exceeded' }), true)
})

test('手动覆盖：生效时只走覆盖项；覆盖项冷却时回退路由表', async () => {
  const st = new StateRegistry()
  const calls = []
  const overridden = { ...cfg, override: { enabled: true, provider: 'official', model: 'B' } }
  const adapter = new TimeRouterAdapter({
    llm: fakeLlm({ scnet: 'ok', official: 'ok' }),
    getConfig: () => overridden,
    directory: () => directory,
    state: st,
    onUsage: () => {},
    onFailure: () => {},
    onRouteChange: () => {},
  })
  adapter.llm.stream = (o) => { calls.push(o.provider); return fakeLlm({ official: 'ok' }).stream(o) }
  await collect(adapter.stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.deepEqual(calls, ['official'])
  // 覆盖项冷却 → 回退路由表
  st.markFailure(Date.now(), { provider: 'official', model: 'B' }, 'QUOTA')
  const calls2 = []
  adapter.llm.stream = (o) => { calls2.push(o.provider); return fakeLlm({ scnet: 'ok', official: 'ok' }).stream(o) }
  await collect(adapter.stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.deepEqual(calls2, ['scnet'])
})

test('listModels：只提供单一「自动选择」项（路由由时段表决定）', async () => {
  const adapter = new TimeRouterAdapter({
    llm: fakeLlm({}),
    getConfig: () => ({ routing: { slots: [{ id: 'all', start: '00:00', end: '00:00', priority: [{ provider: 'scnet', model: 'A' }] }] } }),
    directory: () => ({ usable: () => true, models: new Map() }),
    state: new StateRegistry(),
    onUsage: () => {},
    onFailure: () => {},
    onRouteChange: () => {},
  })
  const list = await adapter.listModels('time-router')
  assert.equal(list.length, 1)
  assert.equal(list[0].provider, 'time-router')
  assert.equal(list[0].id, 'auto')
  assert.equal(list[0].name, '自动选择')
})

test('预算门控：额度不足跳过 scnet；全部被门控时放行第一优先级', async () => {
  const st = new StateRegistry()
  const gate = (e) => e.provider === 'scnet'
  const adapter = new TimeRouterAdapter({
    llm: fakeLlm({ scnet: 'ok', official: 'ok' }),
    getConfig: () => cfg,
    directory: () => directory,
    state: st,
    budgetGate: gate,
    onUsage: undefined,
    onFailure: () => {},
    onRouteChange: () => {},
  })
  const calls = []
  adapter.llm.stream = (o) => { calls.push(o.provider); return fakeLlm({ scnet: 'ok', official: 'ok' }).stream(o) }
  await collect(adapter.stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.deepEqual(calls, ['official']) // scnet 被门控跳过
  // 全部被门控 → 放行第一优先级（总能用得了）
  const allGate = () => true
  const adapter2 = new TimeRouterAdapter({
    llm: fakeLlm({ scnet: 'ok' }),
    getConfig: () => cfg,
    directory: () => directory,
    state: st,
    budgetGate: allGate,
    onUsage: undefined,
    onFailure: () => {},
    onRouteChange: () => {},
  })
  const calls2 = []
  adapter2.llm.stream = (o) => { calls2.push(o.provider); return fakeLlm({ scnet: 'ok', official: 'ok' }).stream(o) }
  await collect(adapter2.stream({ provider: 'time-router', model: 'A', messages: [] }))
  assert.deepEqual(calls2, ['scnet'])
})
