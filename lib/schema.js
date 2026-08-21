// time-router 设置命名空间 schema（schemastery；设置页按此自动渲染）
import z from '@deepseek-ai/schemastery'

const priorityEntry = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

const slot = z.object({
  id: z.string().required(),
  name: z.string().default('时段'),
  start: z.string().required(),
  end: z.string().required(),
  days: z.array(z.number().step(1).min(0).max(6)),
  priority: z.array(priorityEntry).required(),
})

const deepseekRates = z.object({
  hit: z.number().min(0).default(0),
  miss: z.number().min(0).default(0),
  output: z.number().min(0).default(0),
})

const scnetRates = z.object({
  input: z.number().min(0).default(0),
  output: z.number().min(0).default(0),
})

const DEFAULT_FALLBACK = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const DEFAULT_FLASH_RATES = { 'deepseek-v4-flash': { hit: 0.05, miss: 1.5, output: 4.5 } }

export const Config = z.object({
  routing: z.object({
    slots: z.array(slot).default([]),
    defaultFallback: z
      .object({ provider: z.string().default('deepseek-official'), model: z.string().default('deepseek-v4-flash') })
      .default(DEFAULT_FALLBACK),
  }).default({ slots: [], defaultFallback: DEFAULT_FALLBACK }),
  override: z.object({
    enabled: z.boolean().default(false),
    provider: z.string(),
    model: z.string(),
    until: z.string(),
  }).default({}),
  probe: z.object({
    intervalSec: z.number().min(10).max(3600).default(60),
    successThreshold: z.number().step(1).min(1).max(10).default(2),
  }).default({}),
  pricing: z.object({
    deepseekOfficial: z.dict(deepseekRates).default(DEFAULT_FLASH_RATES),
    scnet: z.dict(scnetRates).default({}),
  }).default({ deepseekOfficial: DEFAULT_FLASH_RATES, scnet: {} }),
  budget: z.object({
    dailyCny: z.number().min(0),
    scnetCreditPercent: z.number().min(0).max(100).default(20),
    autoDegrade: z.boolean().default(false),
  }).default({}),
  scnetBalance: z.object({
    manualCny: z.number().min(0),
    unit: z.union(['cny', 'credits']).default('cny'),
  }).default({}),
})
