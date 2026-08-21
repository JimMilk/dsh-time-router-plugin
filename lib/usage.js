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

  append(record) {
    const p = join(this.dir, `usage-${dayKey(new Date(record.t))}.jsonl`)
    try {
      const fd = openSync(p, 'a', 0o600)
      writeSync(fd, JSON.stringify(record) + '\n')
      closeSync(fd)
    } catch (e) {
      console.error('time-router: usage write failed:', e.message)
    }
  }

  today() {
    const p = join(this.dir, `usage-${dayKey(new Date())}.jsonl`)
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
