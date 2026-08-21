// dsh-time-router-plugin 入口：注册「智能路由」provider + 时段路由 + 记账/余额/探测
import { join } from 'node:path'
import { homedir } from 'node:os'
import { appendFileSync } from 'node:fs'
import { settingsNamespace, installSettingsSection } from '@deepseek-ai/dsh-settings'
import { Config } from './schema.js'
import { TimeRouterAdapter } from './adapter.js'
import { StateRegistry } from './state.js'
import { resolveRoute } from './routing.js'
import { UsageLog, tapUsage } from './usage.js'
import { BalanceService } from './balance.js'
import { isPeakAt, costFor, pricingRates } from './accounting.js'

export const name = 'time-router'
export const inject = ['llm', 'timer']

const NS = settingsNamespace('time-router')
const PROVIDER = 'time-router'

export function apply(ctx, config) {
  const DEBUG_MARK = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'time-router', 'debug.log')
  const debug = process.env.DSH_TIME_ROUTER_DEBUG === '1'
  const mark = (line) => {
    if (!debug) return
    try { appendFileSync(DEBUG_MARK, `${new Date().toISOString()} ${line}\n`) } catch { /* 忽略 */ }
  }
  mark('apply() start')
  let current = () => config
  const state = new StateRegistry()
  const usageDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'time-router')
  const usage = new UsageLog(usageDir)
  const balance = new BalanceService(ctx)
  let directory = { providers: new Set(), models: new Map(), usable: () => true }
  let lastRoute = null

  const refreshDirectory = async () => {
    directory = await buildDirectory(ctx)
    mark(`directory providers: ${[...directory.providers].join(',') || '(空)'}`)
  }

  const recordUsage = (entry, usageData, kind, at) => {
    const cfg = current() ?? {}
    const peak = isPeakAt(new Date(at))
    const record = {
      t: new Date(at).toISOString(),
      kind: kind,
      provider: entry.provider,
      model: entry.model,
      ...(entry.sessionId ? { sessionId: String(entry.sessionId) } : {}),
      usage: usageData,
      peak,
    }
    if (kind === 'request') {
      const isDeepseek = entry.provider.includes('deepseek') || !entry.provider.includes('scnet')
      if (isDeepseek) {
        const rates = pricingRates(cfg.pricing, 'deepseekOfficial', entry.model, 'deepseek')
        record.costCny = costFor(usageData, rates, peak) ?? 0
      } else {
        const rates = pricingRates(cfg.pricing, 'scnet', entry.model, 'scnet')
        if (rates) {
          record.credits = Math.round(((usageData.inputTokens ?? 0) * rates.input + (usageData.outputTokens ?? 0) * rates.output) / 1e6 * 100) / 100
        }
      }
    }
    usage.append(record)
  }

  // 预算门控：scnet credits 余额低于阈值时自动跳过（软偏好，opt-in）
  const budgetGate = (entry) => {
    const cfg = current() ?? {}
    const budget = cfg.budget ?? {}
    if (budget.autoDegrade !== true) return false
    if (!String(entry.provider).includes('scnet')) return false
    const manual = Number(cfg.scnetBalance?.manualCny ?? 0)
    if (!(manual > 0)) return false
    const used = usage.today().credits
    const remaining = manual - used
    if (remaining <= 0) {
      mark(`gate: ${entry.provider}/${entry.model} auto=${budget.autoDegrade} manual=${manual} used=${used} → 跳过（余额耗尽）`)
      return true
    }
    const threshold = Number(budget.scnetCreditPercent ?? 20)
    const gated = (remaining / manual) * 100 < threshold
    mark(`gate: ${entry.provider}/${entry.model} auto=${budget.autoDegrade} manual=${manual} used=${used} threshold=${threshold} → ${gated ? '跳过' : '放行'}`)
    return gated
  }
  const computeGated = () => {
    const cfg = current() ?? {}
    const entries = (cfg.routing?.slots ?? []).flatMap((s) => s.priority ?? [])
    const fb = cfg.routing?.defaultFallback
    if (fb) entries.push(fb)
    return entries.filter(budgetGate).map((e) => `${e.provider}/${e.model}`)
  }

  // 全局 usage 采集：所有 llm.stream 调用（含直连 scnet/官方、路由内部调用、探针）
  // 都经过 llm/stream waterfall，在此统一记账（路由适配器不再自行记账，避免双计）。
  ctx.on('llm/stream', (options, next) => {
    const stream = next()
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return stream
    if (options && options.provider === 'time-router') return stream // 外层路由调用是透传壳，usage 由内层真实调用记账
    return tapUsage(stream, options, recordUsage)
  })

  const adapter = new TimeRouterAdapter({
    llm: ctx.llm,
    getConfig: () => current(),
    directory: () => directory,
    state,
    onUsage: undefined,
    budgetGate,
    onFailure: (entry, failure, at) => {
      ctx.logger.warn(`time-router: ${entry.provider}/${entry.model} 失败进入冷却 (${failure.code})`)
      mark(`fail: ${entry.provider}/${entry.model} → ${failure?.code} ${String(failure?.message ?? '').slice(0, 160)}`)
    },
    onRouteChange: (route, at) => {
      lastRoute = { at, ...route }
      mark(`route: ${route.entries.join(' > ')}`)
    },
  })

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: '智能路由（时段×优先级）', settingsNs: NS, settingsPath: [] },
  ])
  ctx.llm.registerAdapter([PROVIDER], adapter)
  mark('adapter registered')

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => { void refreshDirectory() },
  })

  ctx.on('llm/adapters-updated', () => { void refreshDirectory() })
  void refreshDirectory()

  // 周期健康探测：当前时段优先级前 2 名（含 cooling/half-open），1-token
  const probeInterval = Math.max(10, (current()?.probe?.intervalSec ?? 60)) * 1000
  mark(`probe interval ${probeInterval}ms scheduled`)
  ctx.setInterval(() => { mark('probe tick'); void runProbe(ctx, current(), state, directory, adapter, mark) }, probeInterval)

  // deepseek 官方余额：启动 + 每 5 分钟刷新
  void balance.refresh()
  ctx.setInterval(() => { void balance.refresh() }, 5 * 60 * 1000)
  mark('apply() end')

  // 状态服务（供客户端经 apiProxy 只读访问；M1 先暴露内存对象）
  const statusProvider = () => ({
    route: lastRoute,
    state: state.snapshot(Date.now()),
    balances: balance.deepseek,
    balanceError: balance.lastError,
    today: usage.today(),
    trend: usage.trend(7),
    scnetManualCny: current()?.scnetBalance?.manualCny ?? null,
    scnetUnit: current()?.scnetBalance?.unit ?? 'cny',
    budget: {
      ...(current()?.budget ?? {}),
      gated: computeGated(),
    },
    override: current()?.override ?? {},
    routing: {
      slotCount: (current()?.routing?.slots ?? []).length,
      defaultFallback: current()?.routing?.defaultFallback ?? null,
    },
    peak: isPeakAt(new Date()),
    activeProvider: lastRoute?.entries?.[0]?.split('/')[0] ?? null,
    directory: {
      providers: [...directory.providers],
      models: Object.fromEntries([...directory.models.entries()].map(([p, m]) => [p, [...m.keys()]])),
    },
  })
  ctx.provide('timeRouterStatus', statusProvider)
  // webServer 仅存在于 web profile；headless 无此服务时该回调不执行（installSettingsSection 同款模式）
  ctx.inject(['webServer'], (sctx) => {
    sctx.webServer.register({
      kind: 'exact',
      path: '/time-router/status',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(statusProvider()))
      },
    })
    sctx.webServer.register({
      kind: 'exact',
      path: '/time-router/test',
      handler: async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        try {
          const result = await runTest(ctx, current(), state, directory, adapter, mark)
          res.end(JSON.stringify(result))
        } catch (e) {
          res.end(JSON.stringify({ error: (e && e.message) || String(e) }))
        }
      },
    })
  })
}

async function runTest(ctx, cfg, state, directory, adapter, mark) {
  const now = Date.now()
  const route = resolveRoute(cfg ?? {}, new Date(now), state, directory)
  const results = []
  for (const entry of route.entries.slice(0, 5)) {
    let ok = false
    let code = ''
    let ms = 0
    const t0 = Date.now()
    const timeout = AbortSignal.timeout(10000)
    try {
      const iter = adapter.stream({
        provider: 'time-router',
        model: entry.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        maxTokens: 1,
        __probe: true,
        signal: timeout,
      })
      for await (const chunk of iter) {
        if (chunk.type === 'finish') {
          if (chunk.reason?.kind === 'error') {
            code = chunk.reason.failure?.code ?? ''
          } else {
            ok = true
          }
        }
      }
    } catch (e) {
      code = e?.message ?? String(e)
    }
    ms = Date.now() - t0
    results.push({ provider: entry.provider, model: entry.model, ok, code, ms })
    mark(`test: ${entry.provider}/${entry.model} → ${ok ? 'ok' : 'fail(' + code + ')'} ${ms}ms`)
  }
  return { at: new Date(now).toISOString(), slotId: route.slot?.id ?? null, results }
}

async function buildDirectory(ctx) {
  const providers = await ctx.llm.listProviders()
  const providerSet = new Set(providers.map((p) => p.id))
  const models = new Map()
  for (const p of providers) {
    if (p.id === PROVIDER) continue // 自身目录由 listModels 按当前设置实时计算，避免启动早期缓存旧值
    try {
      const list = await ctx.llm.listModels(p.id)
      models.set(p.id, new Map(list.map((m) => [m.id, m])))
    } catch {
      models.set(p.id, new Map())
    }
  }
  return {
    providers: providerSet,
    models,
    usable: (entry) => providerSet.has(entry.provider) && (models.get(entry.provider)?.has(entry.model) ?? false),
  }
}

async function runProbe(ctx, cfg, state, directory, adapter, mark) {
  const now = Date.now()
  const route = resolveRoute(cfg ?? {}, new Date(now), state, directory)
  const threshold = Math.max(1, cfg?.probe?.successThreshold ?? 2)
  for (const entry of route.entries.slice(0, 2)) {
    let ok = true
    let failCode = ''
    try {
      const iter = adapter.stream({
        provider: 'time-router',
        model: entry.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        maxTokens: 1,
        __probe: true,
      })
      for await (const chunk of iter) {
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
          ok = false
          const f = chunk.reason.failure ?? {}
          failCode = JSON.stringify(f).slice(0, 500)
          break
        }
      }
    } catch (e) {
      ok = false
      failCode = e?.message ?? String(e)
    }
    state.markProbe(now, entry, ok, threshold)
    mark(`probe ${entry.provider}/${entry.model} → ${ok ? 'ok' : `fail(${failCode})`} (state=${state.statusAt(now, entry)})`)
  }
}
