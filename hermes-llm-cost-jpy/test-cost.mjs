import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
    calculateCost,
    calculateEstimatedUsd,
    calculateTokenCostUsd,
    canPersistCostHistory,
    createCostHistoryRecord,
    extractUsageTokens,
    formatJpy,
    getCostHistoryEntries,
    getPricing,
    historyResultForSession,
    isTokenCountValid,
    normalizeRate,
    resolveModelForUsage,
    upsertCostHistory
} from './cost.mjs'

const pricing = getPricing('openai-api', 'gpt-5.6-luna')
assert.ok(pricing)

const gpt6LunaPricing = getPricing('openai-api', 'gpt-6-luna')
assert.ok(gpt6LunaPricing, 'gpt-6-luna should have a verified price record')
assert.deepEqual(
    {
        input: gpt6LunaPricing.inputUsdPerMillion,
        output: gpt6LunaPricing.outputUsdPerMillion,
        cacheRead: gpt6LunaPricing.cacheReadUsdPerMillion,
        cacheWrite: gpt6LunaPricing.cacheWriteUsdPerMillion,
        longContext: gpt6LunaPricing.longContext
    },
    {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        longContext: {
            cacheReadUsdPerMillion: 0.02,
            cacheWriteUsdPerMillion: 0.25,
            inputUsdPerMillion: 0.2,
            outputUsdPerMillion: 0.75
        }
    }
)
assert.equal(gpt6LunaPricing.checkedAt, '2026-09-27')

assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 0 }, pricing),
    0.2
)
assert.deepEqual(
    extractUsageTokens({
        cache_hit_pct: 50,
        input: 100_000,
        output: 10_000,
        total: 1_110_000
    }),
    { cachedInput: 550_000, cacheWriteInput: 450_000, input: 1_100_000, output: 10_000 }
)
assert.equal(
    calculateEstimatedUsd({
        cache_hit_pct: 50,
        input: 100_000,
        output: 10_000,
        total: 1_110_000
    }, pricing),
    0.1555
)
assert.deepEqual(
    extractUsageTokens({
        input: 100_000,
        output: 10_000,
        total: 1_110_000
    }),
    { cachedInput: 0, cacheWriteInput: 1_000_000, input: 1_100_000, output: 10_000 }
)
assert.equal(
    calculateEstimatedUsd({
        input: 100_000,
        output: 10_000,
        total: 1_110_000
    }, pricing),
    0.282
)
assert.deepEqual(
    extractUsageTokens({
        cache_read_tokens: 550_000,
        cache_write_tokens: 450_000,
        input: 100_000,
        output: 10_000,
        total: 1_110_000
    }),
    { cachedInput: 550_000, cacheWriteInput: 450_000, input: 1_100_000, output: 10_000 }
)
assert.equal(
    calculateEstimatedUsd({ input: 0, output: 1_000_000 }, pricing),
    1.2
)
assert.equal(
    calculateEstimatedUsd({
        cache_write_input: 100_000,
        cached_input: 200_000,
        input: 1_000_000,
        output: 1_000_000
    }, pricing),
    1.369
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000, reasoning_tokens: 500_000 }, pricing),
    1.4
)

const solPricing = getPricing('openai-api', 'gpt-5.6-sol')
assert.ok(solPricing)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, solPricing),
    24
)

const terraPricing = getPricing('openai-api', 'gpt-5.6-terra')
assert.ok(terraPricing)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, terraPricing),
    14
)

const geminiProPricing = getPricing('gemini', 'gemini-3.1-pro-preview')
assert.ok(geminiProPricing)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, geminiProPricing),
    14
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000, long_context: true }, geminiProPricing),
    22
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, getPricing('gemini', 'gemini-2.5-flash')),
    2.8
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, getPricing('gemini', 'gemini-2.5-flash-lite')),
    0.5
)

const anthropicOpusPricing = getPricing('anthropic', 'claude-opus-5')
assert.ok(anthropicOpusPricing)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, anthropicOpusPricing),
    30
)
assert.equal(
    calculateEstimatedUsd({
        cache_creation_input_tokens: 100_000,
        cache_read_input_tokens: 200_000,
        input: 1_000_000,
        output: 1_000_000
    }, anthropicOpusPricing),
    29.225
)
assert.equal(
    getPricing('anthropic', 'claude-haiku-4-5').inputUsdPerMillion,
    getPricing('anthropic', 'claude-haiku-4-5-20251001').inputUsdPerMillion
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, getPricing('anthropic', 'claude-sonnet-5')),
    12
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, getPricing('anthropic', 'claude-haiku-4-5')),
    6
)

// claude.com/ja/pricing#api で 2026-10-10 に確認した Anthropic 5.5/5.1 モデルの単価
const fable51Pricing = getPricing('anthropic', 'claude-fable-5-1')
assert.ok(fable51Pricing)
assert.deepEqual(
    {
        cacheRead: fable51Pricing.cacheReadUsdPerMillion,
        cacheWrite: fable51Pricing.cacheWriteUsdPerMillion,
        input: fable51Pricing.inputUsdPerMillion,
        output: fable51Pricing.outputUsdPerMillion
    },
    { cacheRead: 0.25, cacheWrite: 12.5, input: 10, output: 50 }
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, fable51Pricing),
    60
)

const opus55Pricing = getPricing('anthropic', 'claude-opus-5-5')
assert.ok(opus55Pricing, 'claude-opus-5-5 should have a verified price record')
assert.deepEqual(
    {
        cacheRead: opus55Pricing.cacheReadUsdPerMillion,
        cacheWrite: opus55Pricing.cacheWriteUsdPerMillion,
        input: opus55Pricing.inputUsdPerMillion,
        output: opus55Pricing.outputUsdPerMillion
    },
    { cacheRead: 0.2, cacheWrite: 5, input: 4, output: 20 }
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, opus55Pricing),
    24
)
assert.equal(
    calculateEstimatedUsd({
        cache_creation_input_tokens: 100_000,
        cache_read_input_tokens: 200_000,
        input: 1_000_000,
        output: 1_000_000
    }, opus55Pricing),
    23.34
)
assert.equal(getPricing('anthropic', 'claude-opus-5-5-20261001'), opus55Pricing)

const sonnet55Pricing = getPricing('anthropic', 'claude-sonnet-5-5')
assert.ok(sonnet55Pricing)
assert.deepEqual(
    {
        cacheRead: sonnet55Pricing.cacheReadUsdPerMillion,
        cacheWrite: sonnet55Pricing.cacheWriteUsdPerMillion,
        input: sonnet55Pricing.inputUsdPerMillion,
        output: sonnet55Pricing.outputUsdPerMillion
    },
    { cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10 }
)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, sonnet55Pricing),
    12
)

const longCatPricing = getPricing('longcat', 'LongCat-2.0')
assert.ok(longCatPricing)
assert.equal(getPricing('longcat-api', 'longcat-2-0'), longCatPricing)
assert.equal(longCatPricing.inputUsdPerMillion, 0.3)
assert.equal(longCatPricing.outputUsdPerMillion, 1.2)
assert.equal(longCatPricing.cacheReadUsdPerMillion, 0.006)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, longCatPricing),
    1.5
)
assert.equal(
    calculateEstimatedUsd({ cached_input: 1_000_000, input: 1_000_000, output: 0 }, longCatPricing),
    0.006
)

const nemotronPricing = getPricing('nvidia', 'nvidia/nemotron-3-super-120b-a12b')
assert.ok(nemotronPricing)
assert.equal(getPricing('nvidia-api', 'nvidia-nemotron-3-super-120b-a12b'), nemotronPricing)
assert.equal(nemotronPricing.inputUsdPerMillion, 0.193)
assert.equal(nemotronPricing.outputUsdPerMillion, 0.65)
assert.equal(nemotronPricing.cacheReadUsdPerMillion, null)
assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 1_000_000 }, nemotronPricing),
    0.843
)

for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '']) {
    assert.equal(normalizeRate(invalid), null)
}
assert.equal(normalizeRate('150.25'), 150.25)
assert.equal(formatJpy(198.4), '¥198.40')
assert.equal(canPersistCostHistory({ amountUsd: 1, sessionId: 'session-a', usage: { session_id: 'session-a' } }), true)
assert.equal(canPersistCostHistory({ amountUsd: 1, sessionId: 'session-a', usage: { session_id: 'session-b' } }), false)
assert.equal(canPersistCostHistory({ amountUsd: 1, sessionId: 'session-a', usage: {} }), true)
assert.equal(
    resolveModelForUsage({
        currentModel: 'main-model',
        focusedTile: true,
        usage: { model: 'historical-model' }
    }),
    'historical-model'
)
assert.equal(
    resolveModelForUsage({ currentModel: 'main-model', focusedTile: true, usage: {} }),
    ''
)
assert.equal(
    resolveModelForUsage({ currentModel: 'main-model', focusedTile: false, usage: {} }),
    'main-model'
)

const historyResult = {
    amountUsd: 1.23,
    model: 'historical-model',
    pricing,
    provider: 'openai-api',
    status: 'estimated'
}
const historyRecord = createCostHistoryRecord('history-session', historyResult, 100)
assert.equal(historyRecord.sessionId, 'history-session')
assert.equal(historyRecord.amountUsd, 1.23)
const history = upsertCostHistory({}, 'history-session', historyResult, 100)
assert.equal(historyResultForSession(history, 'history-session').amountUsd, 1.23)
const updatedHistory = upsertCostHistory(history, 'history-session', { ...historyResult, amountUsd: 2.34 }, 200)
assert.equal(historyResultForSession(updatedHistory, 'history-session').amountUsd, 2.34)
assert.equal(historyResultForSession(updatedHistory, 'missing-session'), null)
const newestHistory = upsertCostHistory(updatedHistory, 'newer-session', historyResult, 300)
assert.deepEqual(
    getCostHistoryEntries(newestHistory).map(record => record.sessionId),
    ['newer-session', 'history-session']
)

const estimated = calculateCost({
    model: 'gpt-5.6-luna',
    provider: 'openai-api',
    sessionId: 'session-a',
    usage: { input: 1_000_000, output: 0 }
})
assert.equal(estimated.amountUsd, 0.2)
assert.equal(estimated.status, 'estimated')
assert.equal(estimated.sessionId, 'session-a')

const legacyGatewayEstimate = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { cost_usd: 0.42, input: Number.NaN, output: Number.NaN }
})
assert.equal(legacyGatewayEstimate.amountUsd, 0.42)
assert.equal(legacyGatewayEstimate.status, 'estimated')

const actualCost = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { actual_cost_usd: 0.42, cost_usd: 8.88, estimated_cost_usd: 9.99 }
})
assert.equal(actualCost.amountUsd, 0.42)
assert.equal(actualCost.status, 'provider-reported')

const actualZeroCost = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { actual_cost_usd: 0, estimated_cost_usd: 9.99 }
})
assert.equal(actualZeroCost.amountUsd, 0)
assert.equal(actualZeroCost.status, 'provider-reported')

const estimatedGatewayCost = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { actual_cost_usd: null, cost_usd: 8.88, estimated_cost_usd: 0.84 }
})
assert.equal(estimatedGatewayCost.amountUsd, 0.84)
assert.equal(estimatedGatewayCost.status, 'estimated')

const estimatedZeroGatewayCost = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { actual_cost_usd: null, estimated_cost_usd: 0 }
})
assert.equal(estimatedZeroGatewayCost.amountUsd, 0)
assert.equal(estimatedZeroGatewayCost.status, 'estimated')

const invalidActualUsesEstimate = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { actual_cost_usd: Number.NaN, estimated_cost_usd: 0.84 }
})
assert.equal(invalidActualUsesEstimate.amountUsd, 0.84)
assert.equal(invalidActualUsesEstimate.status, 'estimated')

// Current TUI Gateway usage has token totals but no cost fields.
const currentGatewayTokenEstimate = calculateCost({
    model: 'gpt-5.6-luna',
    provider: 'openai-api',
    usage: {
        calls: 1,
        completion: 0,
        input: 1_000_000,
        model: 'gpt-5.6-luna',
        output: 0,
        prompt: 1_000_000,
        reasoning: 0,
        total: 1_000_000
    }
})
assert.equal(currentGatewayTokenEstimate.amountUsd, 0.2)
assert.equal(currentGatewayTokenEstimate.status, 'estimated')

const currentGatewayGpt6LunaEstimate = calculateCost({
    model: 'gpt-6-luna',
    provider: 'openai-api',
    usage: {
        input: 1_000_000,
        model: 'gpt-6-luna',
        output: 1_000_000,
        total: 2_000_000
    }
})
assert.equal(currentGatewayGpt6LunaEstimate.amountUsd, 0.6)
assert.equal(currentGatewayGpt6LunaEstimate.status, 'estimated')

const included = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { cost_usd: 0 }
})
assert.equal(included.status, 'included')

const freeModelEstimate = calculateCost({
    model: 'LongCat-2.0',
    provider: 'longcat',
    usage: { cost_usd: 0, input: 1_000_000, output: 1_000_000 }
})
assert.equal(freeModelEstimate.amountUsd, 1.5)
assert.equal(freeModelEstimate.status, 'estimated')

const historicalUsageModel = resolveModelForUsage({
    currentModel: 'main-model',
    focusedTile: true,
    usage: { model: 'LongCat-2.0' }
})
const historicalFreeModelEstimate = calculateCost({
    model: historicalUsageModel,
    usage: { cost_usd: 0, input: 1_000_000, output: 1_000_000 }
})
assert.equal(historicalFreeModelEstimate.amountUsd, 1.5)
assert.equal(historicalFreeModelEstimate.status, 'estimated')

const nemotronFreeModelEstimate = calculateCost({
    model: 'nvidia-nemotron-3-super-120b-a12b',
    provider: 'nvidia-api',
    usage: { cost_usd: 0, input: 1_000_000, output: 1_000_000 }
})
assert.equal(nemotronFreeModelEstimate.amountUsd, 0.843)
assert.equal(nemotronFreeModelEstimate.status, 'estimated')

const unknownModel = calculateCost({
    model: 'unregistered-model',
    provider: 'openai-api',
    usage: { input: 1_000_000, output: 1_000_000 }
})
assert.equal(unknownModel.amountUsd, null)
assert.equal(unknownModel.status, 'unknown')

const missingProvider = calculateCost({
    model: 'gpt-5.6-luna',
    usage: { input: 1_000_000, output: 1_000_000 }
})
assert.equal(missingProvider.amountUsd, 1.4)
assert.equal(missingProvider.provider, 'openai-api')
assert.equal(missingProvider.status, 'estimated')

const namespacedModel = calculateCost({
    model: 'openai/gpt-5.6-luna',
    usage: { input: 1_000_000, output: 1_000_000 }
})
assert.equal(namespacedModel.amountUsd, 1.4)
assert.equal(namespacedModel.provider, 'openai-api')
assert.equal(namespacedModel.status, 'estimated')

const inferredGeminiProvider = calculateCost({
    model: 'gemini-3.8-flash',
    usage: { input: 1_000_000, output: 1_000_000 }
})
assert.equal(inferredGeminiProvider.amountUsd, 4.5)
assert.equal(inferredGeminiProvider.provider, 'gemini')
assert.equal(inferredGeminiProvider.status, 'estimated')

const unavailableProvider = calculateCost({
    model: 'claude-opus-5',
    provider: 'copilot-acp',
    usage: { input: 1_000_000, output: 1_000_000 }
})
assert.equal(unavailableProvider.amountUsd, 30)
assert.equal(unavailableProvider.provider, 'anthropic')
assert.equal(unavailableProvider.status, 'estimated')

const sessionB = calculateCost({
    model: 'gpt-5.6-luna',
    provider: 'openai-api',
    sessionId: 'session-b',
    usage: { input: 0, output: 1_000_000 }
})
assert.equal(sessionB.sessionId, 'session-b')
assert.notEqual(sessionB.sessionId, estimated.sessionId)
assert.equal(sessionB.amountUsd, 1.2)

// Helper & edge case tests for refactored token validation and calculation
assert.equal(extractUsageTokens(null), null)
assert.equal(extractUsageTokens({}), null)
assert.equal(extractUsageTokens({ input: 100 }), null)
assert.equal(extractUsageTokens({ input: -5, output: 10 }), null)
assert.deepEqual(
    extractUsageTokens({
        input: 1000,
        input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
        output: 500
    }),
    { cachedInput: 200, cacheWriteInput: 100, input: 1000, output: 500 }
)

assert.equal(isTokenCountValid(null), false)
assert.equal(isTokenCountValid({ cachedInput: 600, cacheWriteInput: 500, input: 1000 }), false)
assert.equal(isTokenCountValid({ cachedInput: 500, cacheWriteInput: 500, input: 1000 }), true)
assert.equal(isTokenCountValid({ cachedInput: 100, cacheWriteInput: 200, input: 1000 }), true)

assert.equal(calculateTokenCostUsd(null, null), null)
assert.equal(
    calculateTokenCostUsd(
        { cachedInput: 100, cacheWriteInput: 0, input: 1000, output: 500 },
        { cacheReadUsdPerMillion: null, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
    ),
    null
)
assert.equal(
    calculateEstimatedUsd(
        { cached_input: 800_000, cache_write_input: 300_000, input: 1_000_000, output: 100 },
        pricing
    ),
    null
)
assert.equal(calculateEstimatedUsd(null, pricing), null)
assert.equal(calculateEstimatedUsd({ input: 100, output: 100 }, null), null)

const pluginSource = await readFile(new URL('./plugin.js', import.meta.url), 'utf8')
assert.equal(/\b(fetch|XMLHttpRequest)\s*\(/.test(pluginSource), false)
assert.equal(pluginSource.includes('host.request('), false)
assert.equal(pluginSource.includes("from './cost.mjs'"), false)
assert.ok(pluginSource.includes('const LOCALES = Object.freeze('))
assert.ok(pluginSource.includes("unknown: '取得不可'"))

console.log('hermes-llm-cost-jpy calculation tests passed')
