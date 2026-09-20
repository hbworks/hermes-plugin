import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
    calculateCost,
    calculateEstimatedUsd,
    formatJpy,
    getPricing,
    normalizeRate
} from './cost.mjs'

const pricing = getPricing('openai-api', 'gpt-5.6-luna')
assert.ok(pricing)

assert.equal(
    calculateEstimatedUsd({ input: 1_000_000, output: 0 }, pricing),
    0.2
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
assert.equal(formatJpy(198.4), '¥198')

const estimated = calculateCost({
    model: 'gpt-5.6-luna',
    provider: 'openai-api',
    sessionId: 'session-a',
    usage: { input: 1_000_000, output: 0 }
})
assert.equal(estimated.amountUsd, 0.2)
assert.equal(estimated.status, 'estimated')
assert.equal(estimated.sessionId, 'session-a')

const providerReported = calculateCost({
    model: 'unregistered-model',
    provider: 'unknown-provider',
    usage: { cost_usd: 0.42, input: Number.NaN, output: Number.NaN }
})
assert.equal(providerReported.amountUsd, 0.42)
assert.equal(providerReported.status, 'provider-reported')

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

const pluginSource = await readFile(new URL('./plugin.js', import.meta.url), 'utf8')
assert.equal(/\b(fetch|XMLHttpRequest)\s*\(/.test(pluginSource), false)
assert.equal(pluginSource.includes('host.request('), false)
assert.equal(pluginSource.includes("from './cost.mjs'"), false)

console.log('hermes-llm-cost-jpy calculation tests passed')
