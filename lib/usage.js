// 用量持久化（JSONL 0600，按日文件）与当日聚合（纯 Node，零依赖）
import { mkdirSync, openSync, closeSync, writeSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export class UsageLog {
  constructor(dir) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
  }

  pathFor(d) {
    return join(this.dir, `usage-${dayKey(d)}.jsonl`)
  }

  append(record) {
    const p = this.pathFor(new Date(record.t))
    try {
      const fd = openSync(p, 'a', 0o600)
      writeSync(fd, JSON.stringify(record) + '\n')
      closeSync(fd)
    } catch (e) {
      console.error('time-router: usage write failed:', e.message)
    }
  }

  today() {
    return this.aggregateFile(this.pathFor(new Date()))
  }

  // 近 N 天按日聚合（含今天），按日期升序
  trend(days = 7) {
    const out = []
    const now = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const day = this.aggregateFile(this.pathFor(d))
      day.date = dayKey(d)
      out.push(day)
    }
    return out
  }

  aggregateFile(p) {
    const out = {
      requests: 0,
      probes: 0,
      costCny: 0,
      credits: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      byProvider: {},
    }
    if (!existsSync(p)) return out
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        const kind = r.kind === 'probe' ? 'probes' : 'requests'
        out[kind] += 1
        if (kind === 'requests') {
          out.costCny += r.costCny ?? 0
          out.credits += r.credits ?? 0
        }
        const u = r.usage ?? {}
        out.tokens.input += u.inputTokens ?? 0
        out.tokens.output += u.outputTokens ?? 0
        out.tokens.cacheRead += u.cacheReadTokens ?? 0
        out.tokens.cacheWrite += u.cacheWriteTokens ?? 0
        const b = (out.byProvider[r.provider] ??= { input: 0, output: 0, costCny: 0, credits: 0 })
        b.input += u.inputTokens ?? 0
        b.output += u.outputTokens ?? 0
        if (kind === 'requests') {
          b.costCny += r.costCny ?? 0
          b.credits += r.credits ?? 0
        }
      } catch {
        // 单行损坏跳过，不中断聚合
      }
    }
    return out
  }
}

/**
 * 包装任意 llm.stream 的异步迭代器，采集 usage chunk 并透传全部 chunk。
 * 挂载在 llm/stream waterfall 上，覆盖直连与路由内部的所有调用。
 */
export async function* tapUsage(stream, options, record) {
  const provider = options && typeof options.provider === 'string' ? options.provider : 'unknown'
  const model = options && typeof options.model === 'string' ? options.model : 'unknown'
  const kind = options && options.__probe === true ? 'probe' : 'request'
  const at = Date.now()
  for await (const chunk of stream) {
    if (chunk && chunk.type === 'usage') {
      try {
        record({ provider, model, sessionId: options && options.sessionId }, chunk.usage, kind, at)
      } catch {
        // 记账失败不影响请求本身
      }
    }
    yield chunk
  }
}
