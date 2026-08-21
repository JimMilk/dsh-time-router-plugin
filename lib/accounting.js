// 用量→费用（纯逻辑，零依赖）：峰谷判定 + 价目表 + 费用计算

const SHANGHAI = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function shanghaiHM(date) {
  const [h, m] = SHANGHAI.format(date).split(':').map(Number)
  return { hour: h === 24 ? 0 : h, minute: m }
}

// 高峰：09:00-12:00、14:00-18:00（Asia/Shanghai，2026-08-17 生效规则；闭开区间）
export function isPeakAt(date) {
  const { hour, minute } = shanghaiHM(date)
  const cur = hour * 60 + minute
  return (cur >= 9 * 60 && cur < 12 * 60) || (cur >= 14 * 60 && cur < 18 * 60)
}

// rates: { hit, miss, output }（¥/1M tokens，空闲价；高峰 ×2）
// 返回 ¥ 金额；缺价目表返回 null（未知）
export function costFor(usage, rates, peak) {
  if (!rates || typeof rates.miss !== 'number' || typeof rates.output !== 'number') return null
  const hit = typeof rates.hit === 'number' ? rates.hit : rates.miss
  const miss = rates.miss
  const input = (usage?.inputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)
  const read = usage?.cacheReadTokens ?? 0
  const output = usage?.outputTokens ?? 0
  const base = (input * miss + read * hit + output * rates.output) / 1e6
  return Math.round(base * (peak ? 2 : 1) * 1e6) / 1e6
}

// 默认价目表（deepseek 官方 2026-08-17 生效；v4-flash 已核对，v4-pro/scnet 待核对 → 不预设）
export const DEFAULT_PRICING = {
  deepseekOfficial: {
    'deepseek-v4-flash': { hit: 0.05, miss: 1.5, output: 4.5 },
  },
  scnet: {},
}

export function pricingRates(pricing, provider, model, kind) {
  const table = pricing?.[kind === 'deepseek' ? 'deepseekOfficial' : 'scnet']
  return table?.[model] ?? null
}
