import {
    atom,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    host,
    Input,
    STATUSBAR_AREAS,
    usePluginI18n,
    useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

/* BEGIN GENERATED COST LOGIC */
const MILLION = 1_000_000
const JPY_DECIMAL_PLACES = 2

const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
const ANTHROPIC_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const LONGCAT_PRICING_URL = 'https://artificialanalysis.ai/ja/models/longcat-2-0'
const NEMOTRON_PRICING_URL = 'https://artificialanalysis.ai/ja/models/nvidia-nemotron-3-super-120b-a12b'
const CHECKED_AT = '2026-09-18'

const PRICING_MODEL_ALIASES = Object.freeze({
    'longcat-2-0': 'longcat-2.0',
    'nvidia-nemotron-3-super-120b-a12b': 'nemotron-3-super-120b-a12b'
})

const PRICING_PROVIDER_ALIASES = Object.freeze({
    'longcat-api': 'longcat',
    'nvidia-api': 'nvidia'
})

const MAX_COST_HISTORY_ENTRIES = 200

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

const PRICING = Object.freeze({
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
    'longcat/longcat-2.0': createPricing({
        provider: 'longcat',
        model: 'longcat-2.0',
        sourceUrl: LONGCAT_PRICING_URL,
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 1.2,
        cacheReadUsdPerMillion: 0.006
    }),
    'nvidia/nemotron-3-super-120b-a12b': createPricing({
        provider: 'nvidia',
        model: 'nemotron-3-super-120b-a12b',
        sourceUrl: NEMOTRON_PRICING_URL,
        inputUsdPerMillion: 0.193,
        outputUsdPerMillion: 0.65
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

function finiteNonNegative(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null
    }

    return value
}

function normalizeRate(value) {
    const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return finiteNonNegative(numeric) && numeric > 0 ? numeric : null
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function resolveModelForUsage({ currentModel = '', focusedTile = false, usage = null } = {}) {
    const usageModel = normalizeText(usage?.model)
    return usageModel || (focusedTile ? '' : normalizeText(currentModel))
}

function canPersistCostHistory({ amountUsd = null, sessionId = '', usage = null } = {}) {
    const normalizedSessionId = normalizeText(sessionId)
    const usageSessionId = normalizeText(usage?.sessionId || usage?.session_id)
    return Boolean(
        normalizedSessionId &&
        finiteNonNegative(amountUsd) !== null &&
        (!usageSessionId || usageSessionId === normalizedSessionId)
    )
}

function serializeHistoryPricing(pricing) {
    if (!pricing || typeof pricing !== 'object') {
        return null
    }

    return {
        checkedAt: normalizeText(pricing.checkedAt),
        model: normalizeText(pricing.model),
        provider: normalizeText(pricing.provider),
        sourceUrl: normalizeText(pricing.sourceUrl)
    }
}

function createCostHistoryRecord(sessionId, result, updatedAt = Date.now()) {
    const normalizedSessionId = normalizeText(sessionId)
    const amountUsd = finiteNonNegative(result?.amountUsd)
    if (!normalizedSessionId || amountUsd === null) {
        return null
    }

    return {
        amountUsd,
        model: normalizeText(result?.model),
        pricing: serializeHistoryPricing(result?.pricing),
        provider: normalizeText(result?.provider),
        sessionId: normalizedSessionId,
        status: normalizeText(result?.status) || 'unknown',
        updatedAt: finiteNonNegative(updatedAt) ?? Date.now()
    }
}

function normalizeCostHistory(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
    }

    const records = Object.entries(value)
        .map(([sessionId, record]) => {
            const normalized = createCostHistoryRecord(sessionId, record, record?.updatedAt)
            return normalized ? [sessionId, normalized] : null
        })
        .filter(record => record !== null)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_COST_HISTORY_ENTRIES)

    return Object.fromEntries(records)
}

function upsertCostHistory(history, sessionId, result, updatedAt = Date.now()) {
    const normalizedHistory = normalizeCostHistory(history)
    const record = createCostHistoryRecord(sessionId, result, updatedAt)
    if (!record) {
        return normalizedHistory
    }

    const existing = normalizedHistory[record.sessionId]
    if (existing && JSON.stringify({ ...existing, updatedAt: 0 }) === JSON.stringify({ ...record, updatedAt: 0 })) {
        return normalizedHistory
    }

    return normalizeCostHistory({
        ...normalizedHistory,
        [record.sessionId]: record
    })
}

function getCostHistoryEntries(history) {
    if (!history || typeof history !== 'object' || Array.isArray(history)) {
        return []
    }

    return Object.values(history)
}

function historyResultForSession(history, sessionId) {
    const normalizedSessionId = normalizeText(sessionId)
    const record = history && typeof history === 'object' && !Array.isArray(history)
        ? history[normalizedSessionId]
        : null
    if (!record) {
        return null
    }

    return {
        amountUsd: record.amountUsd,
        model: record.model,
        pricing: record.pricing,
        provider: record.provider,
        sessionId: normalizedSessionId,
        status: record.status
    }
}

function normalizePricingModel(value) {
    const modelKey = normalizeText(value).toLowerCase()
    const separator = modelKey.lastIndexOf('/')
    const unprefixedModel = separator === -1 ? modelKey : modelKey.slice(separator + 1)
    return PRICING_MODEL_ALIASES[unprefixedModel] || unprefixedModel
}

function getPricing(provider, model) {
    const providerKey = normalizeText(provider).toLowerCase()
    const modelKey = normalizePricingModel(model)
    if (!providerKey || !modelKey) {
        return null
    }

    const providerAlias = PRICING_PROVIDER_ALIASES[providerKey] || providerKey
    return PRICING[`${providerAlias}/${modelKey}`] || null
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

function calculateEstimatedUsd(usage, pricing) {
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

function calculateCost({ sessionId = null, provider = '', model = '', usage = null } = {}) {
    const normalizedProvider = normalizeText(provider).toLowerCase()
    const normalizedModel = normalizeText(model)
    const normalizedSessionId = normalizeText(sessionId) || null
    const reportedCost = finiteNonNegative(usage?.cost_usd)
    const pricing = getPricing(normalizedProvider, normalizedModel) ||
        getPricingByModel(normalizedModel)
    const resolvedProvider = pricing?.provider || normalizedProvider

    if (reportedCost !== null && reportedCost > 0) {
        return {
            amountUsd: reportedCost,
            model: normalizedModel,
            pricing,
            provider: resolvedProvider,
            sessionId: normalizedSessionId,
            status: 'provider-reported'
        }
    }

    const estimatedCost = calculateEstimatedUsd(usage, pricing)
    if (reportedCost === 0 && estimatedCost === null) {
        return {
            amountUsd: 0,
            model: normalizedModel,
            pricing,
            provider: resolvedProvider,
            sessionId: normalizedSessionId,
            status: 'included'
        }
    }
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

function formatJpy(amount) {
    const numeric = finiteNonNegative(amount)
    return numeric === null
        ? '¥—'
        : `¥${numeric.toLocaleString('ja-JP', {
            maximumFractionDigits: JPY_DECIMAL_PLACES,
            minimumFractionDigits: JPY_DECIMAL_PLACES
        })}`
}

function formatUsd(amount) {
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
/* END GENERATED COST LOGIC */

const ID = 'hermes-llm-cost-jpy'
const STORAGE_KEY = 'usd_jpy_rate'
const COST_HISTORY_STORAGE_KEY = 'session_cost_history'
const MAX_VISIBLE_COST_HISTORY_ENTRIES = 10
const EMPTY_USAGE = atom(null)
const EMPTY_STRING = atom('')
const EMPTY_OWNER = atom(null)

const usageAtom = host.state?.focusedUsage || EMPTY_USAGE
const modelAtom = host.state?.model || EMPTY_STRING
const providerAtom = host.state?.focusedProvider || host.state?.provider || EMPTY_STRING
const focusedProfileAtom = host.state?.focusedSessionProfile || host.state?.profile || EMPTY_STRING
const ownerAtom = host.state?.focusedSessionOwner || EMPTY_OWNER
const activeSessionIdAtom = host.state?.activeSessionId || EMPTY_STRING
const storedSessionIdAtom = host.state?.focusedStoredSessionId || EMPTY_STRING
const runtimeSessionIdAtom = host.state?.focusedSessionId || EMPTY_STRING

function createController(storage) {
    const initialRate = normalizeRate(storage.get(STORAGE_KEY, null))
    const initialHistory = normalizeCostHistory(storage.get(COST_HISTORY_STORAGE_KEY, {}))
    const rate = atom(initialRate)
    const history = atom(initialHistory)

    return {
        history,
        rate,
        clearHistory() {
            storage.remove(COST_HISTORY_STORAGE_KEY)
            history.set({})
        },
        clearRate() {
            storage.remove(STORAGE_KEY)
            rate.set(null)
        },
        recordCost(sessionId, result) {
            const current = history.get()
            const next = upsertCostHistory(current, sessionId, result)
            if (JSON.stringify(current) === JSON.stringify(next)) {
                return false
            }

            storage.set(COST_HISTORY_STORAGE_KEY, next)
            history.set(next)
            return true
        },
        setRate(value) {
            const normalized = normalizeRate(value)
            if (normalized === null) {
                return false
            }

            storage.set(STORAGE_KEY, normalized)
            rate.set(normalized)
            return true
        }
    }
}

function normalizeProvider(value) {
    if (typeof value === 'string') {
        return value.trim().toLowerCase()
    }

    if (value && typeof value === 'object') {
        return normalizeProvider(value.provider || value.name || value.id)
    }

    return ''
}

function normalizeModel(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeSessionId(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function DetailRow({ label, value }) {
    return jsxs('div', {
        className: 'flex items-baseline justify-between gap-3',
        children: [
            jsx('span', { className: 'shrink-0 text-(--ui-text-tertiary)', children: label }),
            jsx('span', { className: 'min-w-0 break-all text-right text-(--ui-text-primary)', children: value })
        ]
    })
}

function getStatusbarLabel(t, result, rate) {
    if (result.status === 'unknown') {
        return t('statusbar.unknown')
    }
    if (result.status === 'included') {
        return t('statusbar.included')
    }
    if (rate === null) {
        return t('statusbar.rateUnset')
    }

    const amount = formatJpy(result.amountUsd * rate)
    return result.status === 'estimated' ? `${amount} ${t('statusbar.estimated')}` : amount
}

function formatHistoryTimestamp(value) {
    const timestamp = finiteNonNegative(value)
    if (timestamp === null) {
        return ''
    }

    return new Date(timestamp).toLocaleString('ja-JP')
}

function HistoryRow({ rate, record }) {
    const jpy = rate === null ? '' : ` / ${formatJpy(record.amountUsd * rate)}`
    return jsxs('div', {
        className: 'border-b border-(--ui-stroke-secondary) py-1.5 last:border-b-0',
        children: [
            jsxs('div', {
                className: 'flex items-baseline justify-between gap-2',
                children: [
                    jsx('span', { className: 'min-w-0 truncate text-(--ui-text-primary)', children: record.model || record.sessionId }),
                    jsx('span', { className: 'shrink-0 text-right text-(--ui-text-primary)', children: `${formatUsd(record.amountUsd)}${jpy}` })
                ]
            }),
            jsx('div', {
                className: 'truncate text-[0.6875rem] text-(--ui-text-tertiary)',
                title: record.sessionId,
                children: `${record.sessionId} · ${formatHistoryTimestamp(record.updatedAt)}`
            })
        ]
    })
}

function CostDetails({ jpyValue, ownerLabel, providerLabel, rate, result, sessionId, sourceUrl, t }) {
    return jsxs('div', {
        className: 'flex flex-col gap-1.5 text-xs',
        children: [
            jsx('div', { className: 'mb-1 text-sm font-medium text-(--ui-text-primary)', children: t('detail.title') }),
            jsx(DetailRow, { label: t('detail.usd'), value: result.amountUsd === null ? t('detail.unavailable') : formatUsd(result.amountUsd) }),
            jsx(DetailRow, { label: t('detail.jpy'), value: jpyValue }),
            jsx(DetailRow, { label: t('detail.rate'), value: rate === null ? t('detail.unset') : `${formatJpy(rate)} / $1` }),
            jsx(DetailRow, { label: t('detail.provider'), value: providerLabel }),
            jsx(DetailRow, { label: t('detail.model'), value: result.model || t('detail.unavailable') }),
            jsx(DetailRow, { label: t('detail.profile'), value: ownerLabel }),
            jsx(DetailRow, { label: t('detail.session'), value: sessionId || t('detail.unavailable') }),
            jsx(DetailRow, { label: t('detail.status'), value: t(`status.${result.status}`) }),
            jsx(DetailRow, { label: t('detail.checkedAt'), value: result.pricing?.checkedAt || t('detail.unavailable') }),
            sourceUrl && jsx('a', { className: 'mt-1 break-all text-(--ui-accent)', href: sourceUrl, rel: 'noreferrer', target: '_blank', children: sourceUrl })
        ]
    })
}

function CostHistorySection({ entries, rate, t }) {
    return jsxs('div', {
        className: 'flex flex-col gap-2',
        children: [
            jsx('div', { className: 'text-xs font-medium text-(--ui-text-primary)', children: t('history.title') }),
            entries.length === 0
                ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t('history.empty') })
                : jsx('div', {
                    className: 'max-h-48 overflow-y-auto pr-1',
                    children: entries.map(record => jsx(HistoryRow, { key: record.sessionId, rate, record }))
                })
        ]
    })
}

function RateSettings({ draftRate, error, historyCount, onClearHistory, onClearRate, onDraftRateChange, onSave, t, rate }) {
    return jsxs('div', {
        className: 'flex flex-col gap-2',
        children: [
            jsx('div', { className: 'text-xs font-medium text-(--ui-text-primary)', children: t('settings.title') }),
            jsx(Input, {
                'aria-label': t('settings.rateLabel'),
                inputMode: 'decimal',
                onChange: onDraftRateChange,
                onKeyDown: event => {
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        onSave()
                    }
                },
                placeholder: t('settings.placeholder'),
                type: 'number',
                value: draftRate
            }),
            error && jsx('div', { className: 'text-xs text-(--ui-danger)', children: error }),
            jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                    jsx(Button, { onClick: onSave, size: 'sm', type: 'button', children: t('settings.save') }),
                    jsx(Button, { disabled: rate === null, onClick: onClearRate, size: 'sm', type: 'button', variant: 'ghost', children: t('settings.clear') }),
                    jsx(Button, { disabled: historyCount === 0, onClick: onClearHistory, size: 'sm', type: 'button', variant: 'ghost', children: t('settings.clearHistory') })
                ]
            }),
            jsx('div', { className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)', children: t('settings.note') })
        ]
    })
}

function CostStatusbar({ controller }) {
    const t = usePluginI18n(ID)
    const usage = useValue(usageAtom)
    const currentModel = normalizeModel(useValue(modelAtom))
    const provider = normalizeProvider(useValue(providerAtom))
    const focusedProfile = normalizeText(useValue(focusedProfileAtom))
    const owner = useValue(ownerAtom)
    const activeSessionId = normalizeSessionId(useValue(activeSessionIdAtom))
    const storedSessionId = normalizeSessionId(useValue(storedSessionIdAtom))
    const runtimeSessionId = normalizeSessionId(useValue(runtimeSessionIdAtom))
    const sessionId = storedSessionId || runtimeSessionId
    const historySessionId = sessionId
    const focusedTile = Boolean(runtimeSessionId && runtimeSessionId !== activeSessionId)
    const model = resolveModelForUsage({ currentModel, focusedTile, usage })
    const usageModel = normalizeModel(usage?.model)
    const rate = useValue(controller.rate)
    const history = useValue(controller.history)
    const calculatedResult = calculateCost({ model, provider, sessionId, usage })
    const historicalResult = historyResultForSession(history, historySessionId)
    const useHistoricalResult = Boolean(
        historicalResult &&
        ((!usageModel && calculatedResult.status !== 'provider-reported') ||
            !model || calculatedResult.status === 'unknown' ||
            (calculatedResult.status === 'included' && !calculatedResult.pricing))
    )
    const result = useHistoricalResult ? historicalResult : calculatedResult
    const historyEntries = getCostHistoryEntries(history).slice(0, MAX_VISIBLE_COST_HISTORY_ENTRIES)
    const previousSessionIdRef = useRef(historySessionId)
    const persistedSnapshotRef = useRef('')
    const [draftRate, setDraftRate] = useState(() => rate === null ? '' : String(rate))
    const [error, setError] = useState('')

    useEffect(() => {
        setDraftRate(rate === null ? '' : String(rate))
    }, [rate])

    useEffect(() => {
        const usageSessionId = normalizeSessionId(usage?.sessionId || usage?.session_id)
        if (!canPersistCostHistory({ amountUsd: calculatedResult.amountUsd, sessionId: historySessionId, usage })) {
            return
        }

        const sessionChanged = previousSessionIdRef.current !== historySessionId
        previousSessionIdRef.current = historySessionId
        if (sessionChanged && !usageSessionId) {
            persistedSnapshotRef.current = ''
            return
        }

        const snapshot = JSON.stringify({
            amountUsd: calculatedResult.amountUsd,
            model: calculatedResult.model,
            provider: calculatedResult.provider,
            sessionId: historySessionId,
            status: calculatedResult.status
        })
        if (persistedSnapshotRef.current === snapshot) {
            return
        }

        if (controller.recordCost(historySessionId, calculatedResult)) {
            persistedSnapshotRef.current = snapshot
        }
    }, [calculatedResult.amountUsd, calculatedResult.model, calculatedResult.provider, calculatedResult.status, controller, historySessionId, usage])

    const saveRate = () => {
        if (!controller.setRate(draftRate)) {
            setError(t('settings.invalidRate'))
            return
        }

        setError('')
    }

    const clearRate = () => {
        controller.clearRate()
        setDraftRate('')
        setError('')
    }

    const clearCostHistory = () => {
        controller.clearHistory()
        setError('')
    }

    const statusbarLabel = getStatusbarLabel(t, result, rate)
    const providerLabel = result.provider || provider || t('detail.unavailable')
    const jpyValue = result.amountUsd === null
        ? t('detail.unavailable')
        : result.status === 'included'
            ? t('statusbar.included')
            : rate === null
                ? t('detail.rateUnset')
                : formatJpy(result.amountUsd * rate)
    const ownerLabel = owner?.connectionId
        ? `${owner.connectionId} / ${owner.profile || focusedProfile || t('detail.unavailable')}`
        : owner?.profile || focusedProfile || t('detail.unavailable')
    const sourceUrl = result.pricing?.sourceUrl || ''
    const title = result.status === 'unknown'
        ? t('statusbar.unknown')
        : t('statusbar.title', result.model || t('detail.unavailable'))

    return jsx(DropdownMenu, {
        children: [
            jsx(DropdownMenuTrigger, {
                asChild: true,
                children: jsx('button', {
                    'aria-label': title,
                    className: 'inline-flex h-full max-w-56 items-center gap-1 truncate px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
                    title,
                    type: 'button',
                    children: statusbarLabel
                })
            }),
            jsxs(DropdownMenuContent, {
                align: 'end',
                className: 'w-80 p-3',
                children: [
                    jsx(CostDetails, { jpyValue, ownerLabel, providerLabel, rate, result, sessionId, sourceUrl, t }),
                    jsx(DropdownMenuSeparator, { className: 'my-3' }),
                    jsx(CostHistorySection, { entries: historyEntries, rate, t }),
                    jsx(DropdownMenuSeparator, { className: 'my-3' }),
                    jsx(RateSettings, {
                        draftRate,
                        error,
                        historyCount: Object.keys(history).length,
                        onClearHistory: clearCostHistory,
                        onClearRate: clearRate,
                        onDraftRateChange: event => setDraftRate(event.target.value),
                        onSave: saveRate,
                        rate,
                        t
                    })
                ]
            })
        ]
    })
}

export default {
    defaultEnabled: true,
    description: 'Show focused-session LLM cost in JPY using fixed local pricing and exchange-rate settings.',
    id: ID,
    name: 'Hermes LLM Cost JPY',
    register(ctx) {
        ctx.i18n.register({
            en: {
                detail: {
                    checkedAt: 'Price checked',
                    jpy: 'JPY',
                    model: 'Model',
                    profile: 'Connection / profile',
                    provider: 'Provider',
                    rate: 'Rate',
                    session: 'Session',
                    status: 'Status',
                    title: 'Focused session cost',
                    unavailable: 'Unavailable',
                    unset: 'Not set',
                    usd: 'USD'
                },
                history: {
                    empty: 'No saved session costs yet.',
                    title: 'Cost history'
                },
                settings: {
                    clear: 'Clear',
                    clearHistory: 'Clear history',
                    invalidRate: 'Enter a positive finite USD/JPY rate.',
                    note: 'This is a fixed display conversion. No exchange-rate or pricing API is contacted. Session cost snapshots are stored locally in this plugin.',
                    placeholder: 'e.g. 150.00',
                    rateLabel: 'JPY per USD',
                    save: 'Save',
                    title: 'USD/JPY rate'
                },
                status: {
                    estimated: 'Estimated from tokens',
                    included: 'Included / zero cost',
                    'provider-reported': 'Provider reported',
                    unknown: 'Unavailable'
                },
                statusbar: {
                    estimated: 'estimated',
                    included: 'Included',
                    openDetails: 'Open LLM cost details',
                    rateUnset: '¥—',
                    title: model => `LLM cost for ${model}`,
                    unknown: 'Cost n/a'
                }
            },
            ja: {
                detail: {
                    checkedAt: '料金確認日',
                    jpy: '日本円',
                    model: 'モデル',
                    profile: '接続 / プロファイル',
                    provider: 'プロバイダー',
                    rate: '換算レート',
                    session: 'セッション',
                    status: '状態',
                    title: 'フォーカス中セッションのコスト',
                    unavailable: '取得不可',
                    unset: '未設定',
                    usd: '米ドル'
                },
                history: {
                    empty: '保存済みのセッションコストはありません。',
                    title: 'コスト履歴'
                },
                settings: {
                    clear: 'クリア',
                    clearHistory: '履歴をクリア',
                    invalidRate: '正の有限なUSD/JPYレートを入力してください。',
                    note: '固定の表示換算です。為替APIや料金APIには接続しません。セッションのコストスナップショットはこのプラグインにローカル保存します。',
                    placeholder: '例: 150.00',
                    rateLabel: '1ドルあたりの円',
                    save: '保存',
                    title: 'USD/JPYレート'
                },
                status: {
                    estimated: 'トークンからの推定',
                    included: '無料またはコスト0',
                    'provider-reported': 'プロバイダー報告値',
                    unknown: '取得不可'
                },
                statusbar: {
                    estimated: '推定',
                    included: '無料',
                    openDetails: 'LLMコストの詳細を開く',
                    rateUnset: '¥—',
                    title: model => `${model}のLLMコスト`,
                    unknown: 'Cost n/a'
                }
            }
        })

        const controller = createController(ctx.storage)
        ctx.register({
            area: STATUSBAR_AREAS.right,
            data: {
                id: ID,
                render: () => jsx(CostStatusbar, { controller }),
                toggleLabel: 'LLM cost',
                variant: 'text'
            },
            id: 'statusbar'
        })
    }
}
