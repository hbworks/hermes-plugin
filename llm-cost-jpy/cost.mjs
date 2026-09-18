const MILLION = 1_000_000

const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
const ANTHROPIC_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const CHECKED_AT = '2026-09-18'

function createTier(inputUsdPerMillion, outputUsdPerMillion, cacheReadUsdPerMillion = null, cacheWriteUsdPerMillion = null) {
    return {
        cacheReadUsdPerMillion,
        cacheWriteUsdPerMillion,
        inputUsdPerMillion,
        outputUsdPerMillion
    }
}

function createPricing({
    provider,
    model,
    sourceUrl,
    inputUsdPerMillion,
    outputUsdPerMillion,
    cacheReadUsdPerMillion = null,
    cacheWriteUsdPerMillion = null,
    longContextThreshold = null,
    longContext = null
}) {
    const pricing = {
        provider,
        model,
        sourceUrl,
        checkedAt: CHECKED_AT,
        inputUsdPerMillion,
        outputUsdPerMillion,
        cacheReadUsdPerMillion,
        cacheWriteUsdPerMillion
    }

    if (longContextThreshold !== null && longContext) {
        pricing.longContextThreshold = longContextThreshold
        pricing.longContext = Object.freeze(longContext)
    }

    return Object.freeze(pricing)
}

export const PRICING = Object.freeze({
    'openai-api/gpt-6-astra': createPricing({
        provider: 'openai-api',
        model: 'gpt-6-astra',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 10,
        outputUsdPerMillion: 50,
        cacheReadUsdPerMillion: 1,
        cacheWriteUsdPerMillion: 12.5,
        longContextThreshold: 272_000,
        longContext: createTier(20, 75, 2, 25)
    }),
    'openai-api/gpt-5.6-sol': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.6-sol',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 4,
        outputUsdPerMillion: 20,
        cacheReadUsdPerMillion: 0.4,
        cacheWriteUsdPerMillion: 5,
        longContextThreshold: 272_000,
        longContext: createTier(8, 30, 0.8, 10)
    }),
    'openai-api/gpt-5.6-terra': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.6-terra',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 12,
        cacheReadUsdPerMillion: 0.2,
        cacheWriteUsdPerMillion: 2.5,
        longContextThreshold: 272_000,
        longContext: createTier(4, 18, 0.4, 5)
    }),
    'openai-api/gpt-5.6-luna': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.6-luna',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.2,
        outputUsdPerMillion: 1.2,
        cacheReadUsdPerMillion: 0.02,
        cacheWriteUsdPerMillion: 0.25,
        longContextThreshold: 272_000,
        longContext: createTier(0.4, 1.8, 0.04, 0.5)
    }),
    'openai-api/gpt-5.5': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.5',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 30,
        cacheReadUsdPerMillion: 0.5,
        longContextThreshold: 272_000,
        longContext: createTier(10, 45, 1)
    }),
    'openai-api/gpt-5.5-pro': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.5-pro',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 30,
        outputUsdPerMillion: 180,
        longContextThreshold: 272_000,
        longContext: createTier(60, 270)
    }),
    'openai-api/gpt-5.4': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.4',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 15,
        cacheReadUsdPerMillion: 0.25,
        longContextThreshold: 272_000,
        longContext: createTier(5, 22.5, 0.5)
    }),
    'openai-api/gpt-5.4-mini': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.4-mini',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 4.5,
        cacheReadUsdPerMillion: 0.075
    }),
    'openai-api/gpt-5.4-nano': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.4-nano',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.2,
        outputUsdPerMillion: 1.25,
        cacheReadUsdPerMillion: 0.02
    }),
    'openai-api/gpt-5.4-pro': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.4-pro',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 30,
        outputUsdPerMillion: 180,
        longContextThreshold: 272_000,
        longContext: createTier(60, 270)
    }),
    'openai-api/gpt-5.2': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.2',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 1.75,
        outputUsdPerMillion: 14,
        cacheReadUsdPerMillion: 0.175
    }),
    'openai-api/gpt-5.2-pro': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.2-pro',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 21,
        outputUsdPerMillion: 168
    }),
    'openai-api/gpt-5.1': createPricing({
        provider: 'openai-api',
        model: 'gpt-5.1',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 1.25,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.125
    }),
    'openai-api/gpt-5': createPricing({
        provider: 'openai-api',
        model: 'gpt-5',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 1.25,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.125
    }),
    'openai-api/gpt-5-mini': createPricing({
        provider: 'openai-api',
        model: 'gpt-5-mini',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.25,
        outputUsdPerMillion: 2,
        cacheReadUsdPerMillion: 0.025
    }),
    'openai-api/gpt-5-nano': createPricing({
        provider: 'openai-api',
        model: 'gpt-5-nano',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.05,
        outputUsdPerMillion: 0.4,
        cacheReadUsdPerMillion: 0.005
    }),
    'openai-api/gpt-5-pro': createPricing({
        provider: 'openai-api',
        model: 'gpt-5-pro',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 15,
        outputUsdPerMillion: 120
    }),
    'openai-api/gpt-4.1': createPricing({
        provider: 'openai-api',
        model: 'gpt-4.1',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 8,
        cacheReadUsdPerMillion: 0.5
    }),
    'openai-api/gpt-4.1-mini': createPricing({
        provider: 'openai-api',
        model: 'gpt-4.1-mini',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.4,
        outputUsdPerMillion: 1.6,
        cacheReadUsdPerMillion: 0.1
    }),
    'openai-api/gpt-4.1-nano': createPricing({
        provider: 'openai-api',
        model: 'gpt-4.1-nano',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
        cacheReadUsdPerMillion: 0.025
    }),
    'openai-api/gpt-4o': createPricing({
        provider: 'openai-api',
        model: 'gpt-4o',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 1.25
    }),
    'openai-api/gpt-4o-2024-05-13': createPricing({
        provider: 'openai-api',
        model: 'gpt-4o-2024-05-13',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 15
    }),
    'openai-api/gpt-4o-mini': createPricing({
        provider: 'openai-api',
        model: 'gpt-4o-mini',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.6,
        cacheReadUsdPerMillion: 0.075
    }),
    'openai-api/o1': createPricing({
        provider: 'openai-api',
        model: 'o1',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 15,
        outputUsdPerMillion: 60,
        cacheReadUsdPerMillion: 7.5
    }),
    'openai-api/o1-pro': createPricing({
        provider: 'openai-api',
        model: 'o1-pro',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 150,
        outputUsdPerMillion: 600
    }),
    'openai-api/o3-pro': createPricing({
        provider: 'openai-api',
        model: 'o3-pro',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 20,
        outputUsdPerMillion: 80
    }),
    'openai-api/o3': createPricing({
        provider: 'openai-api',
        model: 'o3',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 8,
        cacheReadUsdPerMillion: 0.5
    }),
    'openai-api/o4-mini': createPricing({
        provider: 'openai-api',
        model: 'o4-mini',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 1.1,
        outputUsdPerMillion: 4.4,
        cacheReadUsdPerMillion: 0.275
    }),
    'openai-api/o3-mini': createPricing({
        provider: 'openai-api',
        model: 'o3-mini',
        sourceUrl: OPENAI_PRICING_URL,
        inputUsdPerMillion: 1.1,
        outputUsdPerMillion: 4.4,
        cacheReadUsdPerMillion: 0.55
    }),
    'gemini/gemini-3.8-flash': createPricing({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 3.75,
        cacheReadUsdPerMillion: 0.075
    }),
    'gemini/gemini-3.7-flash': createPricing({
        provider: 'gemini',
        model: 'gemini-3.7-flash',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 3.75,
        cacheReadUsdPerMillion: 0.075
    }),
    'gemini/gemini-3.6-flash': createPricing({
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 3.75,
        cacheReadUsdPerMillion: 0.075
    }),
    'gemini/gemini-3.5-flash': createPricing({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 1.5,
        outputUsdPerMillion: 9,
        cacheReadUsdPerMillion: 0.15
    }),
    'gemini/gemini-3.5-flash-lite': createPricing({
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 2.5,
        cacheReadUsdPerMillion: 0.03
    }),
    'gemini/gemini-3.1-flash-lite': createPricing({
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.25,
        outputUsdPerMillion: 1.5,
        cacheReadUsdPerMillion: 0.025
    }),
    'gemini/gemini-3-flash-preview': createPricing({
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 3,
        cacheReadUsdPerMillion: 0.05
    }),
    'gemini/gemini-3.1-pro-preview': createPricing({
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 12,
        cacheReadUsdPerMillion: 0.2,
        longContextThreshold: 200_000,
        longContext: createTier(4, 18, 0.4)
    }),
    'gemini/gemini-2.5-pro': createPricing({
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 1.25,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.125,
        longContextThreshold: 200_000,
        longContext: createTier(2.5, 15, 0.25)
    }),
    'gemini/gemini-2.5-flash': createPricing({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 2.5,
        cacheReadUsdPerMillion: 0.03
    }),
    'gemini/gemini-2.5-flash-lite': createPricing({
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        sourceUrl: GEMINI_PRICING_URL,
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
        cacheReadUsdPerMillion: 0.01
    }),
    'anthropic/claude-fable-5-1': createPricing({
        provider: 'anthropic',
        model: 'claude-fable-5-1',
        sourceUrl: ANTHROPIC_PRICING_URL,
        inputUsdPerMillion: 10,
        outputUsdPerMillion: 50,
        cacheReadUsdPerMillion: 0.25,
        cacheWriteUsdPerMillion: 12.5
    }),
    'anthropic/claude-opus-5': createPricing({
        provider: 'anthropic',
        model: 'claude-opus-5',
        sourceUrl: ANTHROPIC_PRICING_URL,
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 25,
        cacheReadUsdPerMillion: 0.5,
        cacheWriteUsdPerMillion: 6.25
    }),
    'anthropic/claude-sonnet-5': createPricing({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        sourceUrl: ANTHROPIC_PRICING_URL,
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.2,
        cacheWriteUsdPerMillion: 2.5
    }),
    'anthropic/claude-haiku-4-5': createPricing({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        sourceUrl: ANTHROPIC_PRICING_URL,
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 5,
        cacheReadUsdPerMillion: 0.1,
        cacheWriteUsdPerMillion: 1.25
    }),
    'anthropic/claude-haiku-4-5-20251001': createPricing({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        sourceUrl: ANTHROPIC_PRICING_URL,
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 5,
        cacheReadUsdPerMillion: 0.1,
        cacheWriteUsdPerMillion: 1.25
    })
})

export function finiteNonNegative(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null
    }

    return value
}

export function normalizeRate(value) {
    const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return finiteNonNegative(numeric) && numeric > 0 ? numeric : null
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizePricingModel(value) {
    const modelKey = normalizeText(value)
    const separator = modelKey.lastIndexOf('/')
    return separator === -1 ? modelKey : modelKey.slice(separator + 1)
}

export function getPricing(provider, model) {
    const providerKey = normalizeText(provider).toLowerCase()
    const modelKey = normalizePricingModel(model)
    if (!providerKey || !modelKey) {
        return null
    }

    return PRICING[`${providerKey}/${modelKey}`] || null
}

function getPricingByModel(model) {
    const modelKey = normalizePricingModel(model)
    if (!modelKey) {
        return null
    }

    const matches = Object.values(PRICING).filter(pricing => pricing.model === modelKey)
    return matches.length === 1 ? matches[0] : null
}

function readTokenCount(value) {
    return finiteNonNegative(value)
}

function readOptionalTokenCount(usage, names, nested) {
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(usage, name)) {
            return readTokenCount(usage[name])
        }
    }

    const nestedValue = nested?.()
    return nestedValue === undefined ? undefined : readTokenCount(nestedValue)
}

function selectTier(usage, pricing) {
    const longContext = usage?.long_context === true || usage?.pricing_tier === 'long'
    if (!longContext) {
        return pricing
    }

    return pricing.longContext || null
}

export function calculateEstimatedUsd(usage, pricing) {
    if (!usage || !pricing) {
        return null
    }

    const input = readTokenCount(usage.input)
    const output = readTokenCount(usage.output)
    if (input === null || output === null) {
        return null
    }

    const cachedInput = readOptionalTokenCount(
        usage,
        [
            'cached_input',
            'cache_read_input',
            'cache_read_input_tokens',
            'cache_read',
            'input_cached'
        ],
        () => usage.input_tokens_details?.cached_tokens
    )
    const cacheWriteInput = readOptionalTokenCount(
        usage,
        [
            'cache_write_input',
            'cache_write_input_tokens',
            'cache_creation_input_tokens',
            'cache_write',
            'input_cache_write'
        ],
        () => usage.input_tokens_details?.cache_write_tokens
    )

    if (cachedInput === null || cacheWriteInput === null) {
        return null
    }

    const cached = cachedInput ?? 0
    const cacheWrite = cacheWriteInput ?? 0
    if (cached + cacheWrite > input) {
        return null
    }

    const tier = selectTier(usage, pricing)
    if (!tier) {
        return null
    }

    const ordinaryInputPrice = finiteNonNegative(tier.inputUsdPerMillion)
    const outputPrice = finiteNonNegative(tier.outputUsdPerMillion)
    const cacheReadPrice = finiteNonNegative(tier.cacheReadUsdPerMillion)
    const cacheWritePrice = finiteNonNegative(tier.cacheWriteUsdPerMillion)
    if (ordinaryInputPrice === null || outputPrice === null) {
        return null
    }
    if (cached > 0 && cacheReadPrice === null) {
        return null
    }
    if (cacheWrite > 0 && cacheWritePrice === null) {
        return null
    }

    const ordinaryInput = input - cached - cacheWrite
    return (
        ordinaryInput * ordinaryInputPrice +
        cached * (cacheReadPrice ?? 0) +
        cacheWrite * (cacheWritePrice ?? 0) +
        output * outputPrice
    ) / MILLION
}

export function calculateCost({ sessionId = null, provider = '', model = '', usage = null } = {}) {
    const normalizedProvider = normalizeText(provider).toLowerCase()
    const normalizedModel = normalizeText(model)
    const normalizedSessionId = normalizeText(sessionId) || null
    const reportedCost = finiteNonNegative(usage?.cost_usd)
    const pricing = getPricing(normalizedProvider, normalizedModel) ||
        getPricingByModel(normalizedModel)
    const resolvedProvider = pricing?.provider || normalizedProvider

    if (reportedCost !== null) {
        return {
            amountUsd: reportedCost,
            model: normalizedModel,
            pricing,
            provider: resolvedProvider,
            sessionId: normalizedSessionId,
            status: reportedCost === 0 ? 'included' : 'provider-reported'
        }
    }

    const estimatedCost = calculateEstimatedUsd(usage, pricing)
    if (estimatedCost === null) {
        return {
            amountUsd: null,
            model: normalizedModel,
            pricing,
            provider: resolvedProvider,
            sessionId: normalizedSessionId,
            status: 'unknown'
        }
    }

    return {
        amountUsd: estimatedCost,
        model: normalizedModel,
        pricing,
        provider: resolvedProvider,
        sessionId: normalizedSessionId,
        status: 'estimated'
    }
}

export function formatJpy(amount) {
    const numeric = finiteNonNegative(amount)
    return numeric === null ? '¥—' : `¥${Math.round(numeric).toLocaleString('ja-JP')}`
}

export function formatUsd(amount) {
    const numeric = finiteNonNegative(amount)
    if (numeric === null) {
        return '$—'
    }

    return new Intl.NumberFormat('en-US', {
        currency: 'USD',
        maximumFractionDigits: 6,
        style: 'currency'
    }).format(numeric)
}
