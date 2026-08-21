// 余额服务：deepseek 官方 balance API + 官方 key 解析（credentials 域优先，回退 0600 文件）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export async function resolveOfficialKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials) {
    try {
      const hit = await credentials.resolve('DEEPSEEK_API_KEY')
      if (hit?.value) return hit.value
    } catch {
      // 落入文件回退
    }
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  try {
    const text = readFileSync(join(home, '.credentials.yaml'), 'utf8')
    const m = /^DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/m.exec(text)
    if (m) return m[1].trim()
  } catch {
    // 无凭据
  }
  return null
}

export async function fetchDeepseekBalance(apiKey) {
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return { ok: false, status: res.status }
  const json = await res.json()
  return { ok: true, isAvailable: json.is_available, balances: json.balance_infos ?? [] }
}

export class BalanceService {
  constructor(ctx) {
    this.ctx = ctx
    this.deepseek = null
    this.lastError = null
    this.running = null
  }

  refresh() {
    if (this.running) return this.running
    this.running = (async () => {
      try {
        const key = await resolveOfficialKey(this.ctx)
        if (!key) {
          this.deepseek = null
          this.lastError = 'missing-official-key'
          return
        }
        const r = await fetchDeepseekBalance(key)
        if (r.ok) {
          this.deepseek = r
          this.lastError = null
        } else {
          this.lastError = `balance-http-${r.status}`
        }
      } catch (e) {
        this.lastError = e.message
      } finally {
        this.running = null
      }
    })()
    return this.running
  }
}
