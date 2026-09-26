import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

function writeModule(root, relativePath, content) {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function installMocks(root) {
  writeModule(root, 'node_modules/@hermes/plugin-sdk/package.json', '{"type":"module","main":"./index.js"}')
  writeModule(root, 'node_modules/@hermes/plugin-sdk/index.js', `
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}
export function useValue(readable) { return readable.get() }
`)

  writeModule(root, 'node_modules/react/package.json', '{"type":"module","main":"./index.js","exports":{".":"./index.js","./jsx-runtime":"./jsx-runtime.js"}}')
  writeModule(root, 'node_modules/react/index.js', `
export function useEffect() {}
export function useState(initial) {
  return [typeof initial === 'function' ? initial() : initial, () => {}]
}
`)

  writeModule(root, 'node_modules/react/jsx-runtime.js', `
export function jsx(type, props) { return { type, props } }
export function jsxs(type, props) { return { type, props } }
`)
}

test('plugin disable cleanup is registered with the desktop loader', async () => {
  const root = mkdtempSync(join(tmpdir(), 'preview-language-override-'))
  installMocks(root)
  writeModule(root, 'plugin.mjs', readFileSync(new URL('../plugin.js', import.meta.url), 'utf8'))

  const observers = []
  const intervals = []
  const clearedIntervals = []
  globalThis.document = {
    documentElement: {},
    querySelectorAll: () => []
  }
  globalThis.MutationObserver = class {
    constructor() {
      observers.push(this)
    }

    observe() {}

    disconnect() {
      this.disconnected = true
    }
  }
  globalThis.setInterval = callback => {
    const token = { callback }
    intervals.push(token)
    return token
  }
  globalThis.clearInterval = token => {
    clearedIntervals.push(token)
  }

  const { default: plugin } = await import(pathToFileURL(join(root, 'plugin.mjs')).href)
  const disposeHooks = []
  const pluginCleanup = plugin.register({
    storage: {
      get: (_key, fallback) => fallback,
      set: () => {},
      remove: () => {}
    },
    registerMany: () => () => {},
    onDispose: callback => disposeHooks.push(callback)
  })

  try {
    assert.equal(disposeHooks.length, 1)
    disposeHooks[0]()
    assert.equal(observers.length, 1)
    assert.equal(observers[0].disconnected, true)
    assert.deepEqual(clearedIntervals, intervals)
  } finally {
    pluginCleanup?.()
  }
})

test('plugin does not install a guest preload owned by the desktop core', async () => {
  const root = mkdtempSync(join(tmpdir(), 'preview-language-override-preload-'))
  installMocks(root)
  writeModule(root, 'plugin.mjs', readFileSync(new URL('../plugin.js', import.meta.url), 'utf8'))

  const attributes = new Map([
    ['partition', 'persist:hermes-preview'],
    ['src', 'about:blank']
  ])
  let preloadWrites = 0
  const webview = {
    addEventListener: () => {},
    executeJavaScript: async () => ({}),
    getAttribute: name => attributes.get(name) ?? null,
    getURL: () => 'about:blank',
    isConnected: true,
    loadURL: () => Promise.resolve(),
    reload: () => {},
    removeAttribute: name => attributes.delete(name),
    removeEventListener: () => {},
    setAttribute: (name, value) => {
      if (name === 'preload') {
        preloadWrites += 1
      }
      attributes.set(name, value)
    },
    tagName: 'webview'
  }
  globalThis.document = {
    documentElement: {},
    querySelectorAll: () => [webview]
  }

  const { default: plugin } = await import(pathToFileURL(join(root, 'plugin.mjs')).href)
  const disposeHooks = []
  const pluginCleanup = plugin.register({
    storage: {
      get: (_key, fallback) => ({ ...fallback, enabled: true }),
      set: () => {},
      remove: () => {}
    },
    registerMany: () => () => {},
    onDispose: callback => disposeHooks.push(callback)
  })

  try {
    assert.equal(preloadWrites, 0)
    assert.equal(attributes.has('preload'), false)
  } finally {
    disposeHooks[0]?.()
    pluginCleanup?.()
  }
})

test('preview language apply accepts a valid language list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'preview-language-override-input-'))
  installMocks(root)
  writeModule(root, 'plugin.mjs', readFileSync(new URL('../plugin.js', import.meta.url), 'utf8'))
  globalThis.document = {
    documentElement: {},
    querySelectorAll: () => []
  }

  const { default: plugin } = await import(pathToFileURL(join(root, 'plugin.mjs')).href)
  const writes = []
  let contributions = []
  const disposeHooks = []
  const pluginCleanup = plugin.register({
    storage: {
      get: (_key, fallback) => fallback,
      set: (_key, value) => writes.push(value),
      remove: () => {}
    },
    registerMany: next => {
      contributions = next
      return () => {}
    },
    onDispose: callback => disposeHooks.push(callback)
  })

  try {
    const paneElement = contributions.find(contribution => contribution.id === 'pane').render()
    const renderedPane = paneElement.type(paneElement.props)
    const applyButton = renderedPane.props.children[3].props.children[0]

    assert.doesNotThrow(() => applyButton.props.onClick())
    assert.deepEqual(writes.at(-1), { enabled: true, languages: ['en-US', 'ja-JP', 'en-JP'] })
  } finally {
    disposeHooks[0]?.()
    pluginCleanup?.()
  }
})
