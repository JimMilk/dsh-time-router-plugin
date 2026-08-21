// time-router 路由适配器：按时段优先级逐级尝试底层 provider，首包前失败降级，
// 流中失败透传（交 dsh-llm-retry 步骤级重试）；usage 记账；半开/冷却由 state 管理。
import { isQuotaExceededError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { resolveRoute } from './routing.js'

const DEGRADABLE_CODES = new Set([
  'AUTH', 'QUOTA', 'RATE_LIMIT', 'SERVER', 'TRANSPORT',
  'INVALID_REQUEST', 'STREAM_CLOSED', 'MALFORMED_RESPONSE', 'TIMEOUT',
])

export function isDegradable(failure) {
  if (!failure) return false
  const code = typeof failure.code === 'string' ? failure.code : ''
  if (DEGRADABLE_CODES.has(code)) return true
  if (/^HTTP_(\d{3})$/.test(code)) {
    const status = Number(code.slice(5))
    if (status >= 500) return true
    if (status === 402 || status === 403 || status === 429 || status === 422) return true
    return false
  }
  return typeof failure.message === 'string' && isQuotaExceededError(failure.message)
}

function errorFinish(failure) {
  return { type: 'finish', reason: { kind: 'error', failure } }
}

export class TimeRouterAdapter {
  constructor({ llm, getConfig, directory, state, onUsage, onFailure, onRouteChange, budgetGate }) {
    this.llm = llm
    this.getConfig = getConfig
    this.directory = directory
    this.state = state
    this.onUsage = onUsage
    this.onFailure = onFailure
    this.onRouteChange = onRouteChange
    this.budgetGate = budgetGate
    this.provider = 'time-router'
  }

  providerInfo(provider) {
    return { id: provider, name: '智能路由' }
  }

  providerRetryPolicy() {
    // 有界重试：首包前失败由插件内部降级消化；仅流中失败冒泡给 llm-retry 步骤级重试
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 1 }, 'time-router')
  }

  async listModels() {
    // 会话模型选择器只提供一个「自动选择」：实际路由由设置-智能路由的时段表决定，
    // 请求中的 model 字段不参与路由（stream 按路由条目改写）。
    return [{ provider: this.provider, id: 'auto', name: '自动选择' }]
  }

  async resolveModel(provider, model) {
    // dsh 运行时要求返回合法 LlmResolvedModelInfo（provider/id/name 必填）
    const dir = this.directory?.() ?? { models: new Map() }
    const meta = dir.models.get(provider)?.get(model)
    return {
      provider,
      id: model,
      name: meta?.name ?? model,
      ...(meta?.contextWindow ? { context: { contextWindow: meta.contextWindow } } : {}),
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'low', name: 'Low' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    }
  }

  async *stream(options) {
    const now = Date.now()
    const cfg = this.getConfig() ?? {}
    const probe = options.__probe === true
    const route = resolveRoute(cfg, new Date(now), this.state, this.directory?.())
    this.applyOverride(route, cfg, now)
    this.onRouteChange?.({ slotId: route.slot?.id ?? null, entries: route.entries.map((e) => `${e.provider}/${e.model}`) }, now)

    // 预算门控：额度不足的入口跳过（软偏好）；全部被门控时按「总能用得了」放行第一优先级
    let candidates = this.budgetGate
      ? route.entries.filter((e) => !this.budgetGate(e))
      : route.entries
    if (candidates.length === 0 && route.entries.length > 0) candidates = [route.entries[0]]

    let lastFailure = null
    for (const entry of candidates) {
      let emitted = false
      try {
        const sub = this.llm.stream({ ...options, provider: entry.provider, model: entry.model })
        for await (const chunk of sub) {
          if (chunk.type === 'finish') {
            if (chunk.reason?.kind === 'error' && !emitted) {
              lastFailure = chunk.reason.failure
              if (!probe && isDegradable(lastFailure)) {
                this.state.markFailure(now, entry, lastFailure)
                this.onFailure?.(entry, lastFailure, now)
              }
              break // 首包前失败：换下一优先级
            }
            if (!probe && chunk.reason?.kind !== 'error' && chunk.reason?.kind !== 'aborted') {
              this.state.markSuccess(now, entry)
            }
            yield chunk
            return
          }
          if (chunk.type === 'usage') {
            this.onUsage?.({ entry, usage: chunk.usage, kind: probe ? 'probe' : 'request', at: now })
          }
          if (chunk.type !== 'usage') emitted = true
          yield chunk
        }
        if (lastFailure) continue
        return
      } catch (err) {
        if (!emitted) {
          lastFailure = { code: 'TRANSPORT', message: err?.message ?? String(err) }
          if (!probe) {
            this.state.markFailure(now, entry, lastFailure)
            this.onFailure?.(entry, lastFailure, now)
          }
          continue
        }
        throw err
      }
    }
    yield errorFinish(lastFailure ?? { code: 'TRANSPORT', message: 'time-router: 所有上游均不可用' })
  }

  applyOverride(route, cfg, now) {
    const ov = cfg.override
    if (!ov?.enabled || !ov.provider || !ov.model) return
    if (ov.until && Number.isFinite(Date.parse(ov.until)) && Date.parse(ov.until) <= now) return
    if (this.state.isCooling(now, ov)) return // 覆盖项冷却 → 回退路由表
    route.entries = [{ provider: ov.provider, model: ov.model }]
    route.slotId = null
    route.override = true
  }
}
