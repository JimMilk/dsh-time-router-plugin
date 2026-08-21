// 时段路由表求值与校验（纯逻辑，零依赖，可直接 node --test）

export function timeToMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t))
  if (!m) throw new Error(`非法时间格式 "${t}"（需 HH:MM）`)
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h > 23 || mm > 59) throw new Error(`时间越界 "${t}"`)
  return h * 60 + mm
}

export function isAllDay(slot) {
  return slot.start === slot.end
}

export function slotActiveAt(slot, now) {
  const start = timeToMinutes(slot.start)
  const end = timeToMinutes(slot.end)
  const cur = now.getHours() * 60 + now.getMinutes()
  if (Array.isArray(slot.days) && slot.days.length > 0 && !slot.days.includes(now.getDay())) {
    return false
  }
  if (start === end) return true // 全天 24h
  if (end < start) return cur >= start || cur < end // 跨天
  return cur >= start && cur < end
}

function intervalsOf(slot) {
  const s = timeToMinutes(slot.start)
  const e = timeToMinutes(slot.end)
  if (s === e) return [[0, 1440]] // 全天
  if (e < s) return [[s, e + 1440]] // 跨天（含次日帧）
  return [[s, e]]
}

function shift(interval, delta) {
  const ns = interval[0] + delta
  const ne = interval[1] + delta
  if (ns < 0 || ne > 2880) return null
  return [ns, ne]
}

function intervalsOverlap(a, b) {
  for (const cand of [b, shift(b, 1440), shift(b, -1440)]) {
    if (cand && a[0] < cand[1] && cand[0] < a[1]) return true
  }
  return false
}

export function slotsOverlap(a, b) {
  const ad = Array.isArray(a.days) && a.days.length > 0 ? new Set(a.days) : null
  const bd = Array.isArray(b.days) && b.days.length > 0 ? new Set(b.days) : null
  const daysIntersect = ad === null || bd === null || [...ad].some((d) => bd.has(d))
  if (!daysIntersect) return false
  for (const ai of intervalsOf(a)) {
    for (const bi of intervalsOf(b)) {
      if (intervalsOverlap(ai, bi)) return true
    }
  }
  return false
}

export function validateRouting(cfg, directory) {
  const errors = []
  const slots = cfg?.routing?.slots ?? []
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    try { timeToMinutes(s.start); timeToMinutes(s.end) } catch (e) { errors.push(`slots[${i}]: ${e.message}`) }
    if (!Array.isArray(s.priority) || s.priority.length === 0) {
      errors.push(`slots[${i}].priority 不能为空`)
    }
    for (const [j, entry] of (s.priority ?? []).entries()) {
      if (!entry || typeof entry.provider !== 'string' || typeof entry.model !== 'string') {
        errors.push(`slots[${i}].priority[${j}]: 条目必须含 provider/model`)
      } else if (directory && !directory.usable(entry)) {
        errors.push(`slots[${i}].priority[${j}]: "${entry.provider}/${entry.model}" 不在当前模型目录`)
      }
    }
    for (let k = 0; k < i; k++) {
      if (slotsOverlap(s, slots[k])) errors.push(`slots[${i}] 与 slots[${k}] 时段重叠`)
    }
  }
  const fb = cfg?.routing?.defaultFallback
  if (fb && directory && !directory.usable(fb)) {
    errors.push(`defaultFallback "${fb.provider}/${fb.model}" 不在当前模型目录`)
  }
  return errors
}

// 返回 { slot, entries, released }；entries 为按优先级过滤冷却/失效后的候选列表
export function resolveRoute(cfg, now, state, directory) {
  const routing = cfg?.routing ?? {}
  const slots = Array.isArray(routing.slots) ? routing.slots : []
  const active = slots.filter((s) => slotActiveAt(s, now))
  const slot = active.length > 0 ? active[0] : null
  const base = slot && Array.isArray(slot.priority) && slot.priority.length > 0
    ? slot.priority
    : [routing.defaultFallback ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }]
  const usable = []
  for (const entry of base) {
    if (directory && !directory.usable(entry)) continue
    if (state && state.isCooling(now, entry)) continue
    usable.push(entry)
  }
  let released = null
  if (usable.length === 0 && state) {
    released = state.releaseLongestCooling(now, base)
    if (released) usable.push(released)
  }
  if (usable.length === 0) usable.push(base[0]) // 极端兜底：总能用得了
  return { slot, entries: usable, released }
}
