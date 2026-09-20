import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const pluginDirectory = path.dirname(scriptsDirectory)
const costPath = path.join(pluginDirectory, 'cost.mjs')
const pluginPath = path.join(pluginDirectory, 'plugin.js')
const GENERATED_START = '/* BEGIN GENERATED COST LOGIC */'
const GENERATED_END = '/* END GENERATED COST LOGIC */'

function runtimeCostSource(source) {
    return source
        .replace(/^export\s+/gm, '')
        .trim()
}

function renderPlugin(source, costSource) {
    const generated = `${GENERATED_START}\n${runtimeCostSource(costSource)}\n${GENERATED_END}`
    const start = source.indexOf(GENERATED_START)
    const end = source.indexOf(GENERATED_END)

    if (start !== -1 || end !== -1) {
        if (start === -1 || end === -1 || end < start) {
            throw new Error('Invalid generated cost markers in plugin.js')
        }

        return `${source.slice(0, start)}${generated}${source.slice(end + GENERATED_END.length)}`
    }

    const sourceStart = source.indexOf('const MILLION = 1_000_000')
    const sourceEnd = source.indexOf("const ID = 'hermes-llm-cost-jpy'")
    if (sourceStart === -1 || sourceEnd === -1 || sourceEnd < sourceStart) {
        throw new Error('Could not locate the cost logic boundary in plugin.js')
    }

    return `${source.slice(0, sourceStart)}${generated}\n\n${source.slice(sourceEnd)}`
}

const [costSource, pluginSource] = await Promise.all([
    readFile(costPath, 'utf8'),
    readFile(pluginPath, 'utf8')
])
const next = renderPlugin(pluginSource, costSource)

if (process.argv.includes('--check')) {
    if (next !== pluginSource) {
        console.error('plugin.js is out of sync with cost.mjs')
        process.exitCode = 1
    }
} else if (next !== pluginSource) {
    await writeFile(pluginPath, next)
}
