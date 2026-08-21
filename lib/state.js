// 入口健康状态机（纯逻辑，零依赖）：healthy → cooling(300s→1h 退避) → half-open → healthy

export const COOLDOWN_BASE_MS = 300_000
export const COOLDOWN_MAX_MS = 3_600_000

export function entryKey(entry) {
  return `${entry.provider}|${entry.model}`
}

export class EntryState {
  constructor() {
    this.status = 'healthy'
    this.failures = 0
    this.coolUntil = 0
    this.probeStreak = 0
    this.lastError = null
  }

  statusAt(now) {
    if (this.status === 'cooling' && now >= this.coolUntil) return 'half-open'
    return this.status
  }

  markFailure(now, error) {
    this.failures += 1
    const backoff = Math.min(COOLDOWN_BASE_MS * 2 ** (this.failures - 1), COOLDOWN_MAX_MS)
    this.coolUntil = now + backoff
    this.status = 'cooling'
    this.probeStreak = 0
    this.lastError = error
    return backoff
  }

  markSuccess(now) {
    if (this.statusAt(now) === 'half-open') this.release(now)
  }

  release(now) {
    this.status = 'healthy'
    this.failures = 0
    this.coolUntil = 0
    this.probeStreak = 0
    this.lastError = null
  }

  markProbe(now, ok, threshold) {
    const st = this.statusAt(now)
    if (ok) {
      this.probeStreak += 1
      if (this.probeStreak >= threshold) {
        this.release(now)
        return 'healthy'
      }
      return st
    }
    this.probeStreak = 0
    this.lastError = 'probe-failed'
    if (st === 'healthy') {
      this.markFailure(now, 'probe-failed')
      return 'cooling'
    }
    if (st === 'half-open') {
      // 半开探测失败 → 回到冷却（退避升级）
      this.markFailure(now, 'probe-failed')
      return 'cooling'
    }
    return 'cooling' // cooling 中探测失败：保持原定到期时间，不延长
  }
}

export class StateRegistry {
  constructor() {
    this.map = new Map()
  }

  entry(entry) {
    const k = entryKey(entry)
    let s = this.map.get(k)
    if (!s) {
      s = new EntryState()
      this.map.set(k, s)
    }
    return s
  }

  statusAt(now, entry) {
    return this.entry(entry).statusAt(now)
  }

  isCooling(now, entry) {
    return this.statusAt(now, entry) === 'cooling'
  }

  markFailure(now, entry, error) {
    return this.entry(entry).markFailure(now, error)
  }

  markSuccess(now, entry) {
    this.entry(entry).markSuccess(now)
  }

  markProbe(now, entry, ok, threshold) {
    return this.entry(entry).markProbe(now, ok, threshold)
  }

  // 选出冷却最久（coolUntil 最早）的条目，置为 half-open 并返回（全冷却兜底）
  releaseLongestCooling(now, entries) {
    let best = null
    let bestUntil = Infinity
    for (const entry of entries) {
      const s = this.entry(entry)
      if (s.statusAt(now) === 'cooling' && s.coolUntil < bestUntil) {
        best = entry
        bestUntil = s.coolUntil
      }
    }
    if (best) {
      // 视为 half-open：由下一次真实请求/探测确认
      this.entry(best).coolUntil = now
      this.entry(best).probeStreak = 0
    }
    return best
  }

  snapshot(now) {
    const out = {}
    for (const [k, s] of this.map) {
      out[k] = { status: s.statusAt(now), failures: s.failures, coolUntil: s.coolUntil, lastError: s.lastError }
    }
    return out
  }
}
