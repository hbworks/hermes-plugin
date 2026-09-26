import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
export const host = globalThis.__agentActiveManagerHost
export function useValue(value) { return typeof value?.get === 'function' ? value.get() : value }
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
`)

  writeModule(root, 'node_modules/react/package.json', '{"type":"module","main":"./index.js","exports":{".":"./index.js","./jsx-runtime":"./jsx-runtime.js"}}')
  writeModule(root, 'node_modules/react/index.js', `
export function useEffect() {}
export function useMemo(factory) { return factory() }
export function useRef(initial) { return { current: initial } }
export function useState(initial) {
  const value = typeof initial === 'function' ? initial() : initial
  if (Array.isArray(value) && value.length === 0 && Array.isArray(globalThis.__agentActiveManagerInitialRoster)) {
    return [globalThis.__agentActiveManagerInitialRoster, () => {}]
  }
  return [value, () => {}]
}
export default { useEffect, useMemo, useRef, useState }
`)
  writeModule(root, 'node_modules/react/jsx-runtime.js', `
export function jsx(type, props) { return { type, props: props ?? {} } }
export function jsxs(type, props) { return { type, props: props ?? {} } }
`)
}

function createHost({ routes = [], sessions = [], createdSessionId = 'created-target-session', routed = false } = {}) {
  const calls = {
    openSessions: [],
    profileRequests: [],
    requests: [],
    retained: [],
    lifecycle: []
  }
  const host = {
    state: {
      busyBySession: { get: () => ({}) },
      focusedSessionProfile: { get: () => 'default' },
      profile: { get: () => 'default' },
      focusedSessionId: { get: () => 'current-session' },
      focusedStoredSessionId: { get: () => 'current-session' }
    },
    profileRoutes: async () => routes,
    request: async (method, params) => {
      calls.requests.push({ method, params })
      if (method === 'session.list') return { sessions }
      if (method === 'session.create') return { session: { id: createdSessionId } }
      return {}
    },
    ensureAgent: async (...args) => {
      calls.lifecycle.push(['ensureAgent', ...args])
    },
    openSession: async (...args) => {
      calls.openSessions.push(args)
      calls.lifecycle.push(['openSession', ...args])
    }
  }

  if (routed) {
    host.retainProfile = async (route, options) => {
      calls.retained.push({ route, options })
      calls.lifecycle.push(['retainProfile'])
      return () => calls.lifecycle.push(['releaseProfile'])
    }
    host.requestProfile = async (route, method, params, timeoutMs, options) => {
      calls.profileRequests.push({ route, method, params, timeoutMs, options })
      calls.lifecycle.push([method])
      if (method === 'session.list') return { sessions }
      if (method === 'session.create') return { session: { id: createdSessionId } }
      return {}
    }
  }

  return { host, calls }
}

function renderComponents(node) {
  if (Array.isArray(node)) return node.map(renderComponents)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return renderComponents(node.type(node.props))
  return {
    ...node,
    props: { ...node.props, children: renderComponents(node.props?.children) }
  }
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  return findElement(node.props?.children, predicate)
}

async function createSwitchHarness(host, targetProfile, initialRoster = null) {
  const root = mkdtempSync(join(tmpdir(), 'agent-active-manager-'))
  installMocks(root)
  writeModule(root, 'plugin.mjs', readFileSync(new URL('../plugin.js', import.meta.url), 'utf8'))

  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previousWindow = globalThis.window
  const previousTimeout = globalThis.setTimeout
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const hadHost = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerHost')
  const previousHost = globalThis.__agentActiveManagerHost
  const hadRoster = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerInitialRoster')
  const previousRoster = globalThis.__agentActiveManagerInitialRoster
  globalThis.window = { hermesDesktop: {} }
  globalThis.setTimeout = () => 0
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  globalThis.__agentActiveManagerHost = host
  if (initialRoster) globalThis.__agentActiveManagerInitialRoster = initialRoster
  else delete globalThis.__agentActiveManagerInitialRoster

  const { default: plugin } = await import(pathToFileURL(join(root, 'plugin.mjs')).href)
  let entries = []
  const unregister = plugin.register({
    registerMany: (contributions) => {
      entries = contributions
      return () => {}
    }
  })

  const paneContribution = entries.find((entry) => entry.id === 'agent-active-manager-pane')
  const paneElement = paneContribution.render()
  const paneTree = paneElement.type(paneElement.props)
  const listElement = paneTree.props.children[1]
  listElement.props.roster = [{ name: targetProfile, display_name: targetProfile }]
  const listTree = renderComponents(listElement)
  const switchButton = findElement(
    listTree,
    (element) => element.type === 'button' && element.props.children === 'Switch ➔'
  )

  return {
    clickSwitch: async () => {
      switchButton.props.onClick()
      await new Promise((resolve) => setImmediate(resolve))
    },
    cleanup: () => {
      unregister?.()
      if (hadWindow) globalThis.window = previousWindow
      else delete globalThis.window
      globalThis.setTimeout = previousTimeout
      if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor)
      else delete globalThis.localStorage
      if (hadHost) globalThis.__agentActiveManagerHost = previousHost
      else delete globalThis.__agentActiveManagerHost
      if (hadRoster) globalThis.__agentActiveManagerInitialRoster = previousRoster
      else delete globalThis.__agentActiveManagerInitialRoster
      rmSync(root, { recursive: true, force: true })
    }
  }
}

test('profile switch opens the target stored session with the SDK session-id argument', async () => {
  const { host, calls } = createHost({ sessions: [{ id: 'stored-target-session', title: 'Research' }] })
  const harness = await createSwitchHarness(host, 'research')

  try {
    await harness.clickSwitch()

    assert.equal(calls.openSessions.length, 1)
    assert.equal(calls.openSessions[0][0], 'stored-target-session')
    assert.equal(typeof calls.openSessions[0][0], 'string')
    assert.equal(calls.openSessions[0][1].profile, 'research')
    assert.equal(calls.openSessions[0][1].awaitHydration, false)
  } finally {
    harness.cleanup()
  }
})

test('profile switch reuses the selected profile session already in the roster', async () => {
  const { host, calls } = createHost()
  const roster = [{ name: 'research', canonical_session: { resolved_id: 'roster-stored-session' } }]
  const harness = await createSwitchHarness(host, 'research', roster)

  try {
    await harness.clickSwitch()

    assert.equal(calls.openSessions.length, 1)
    assert.equal(calls.openSessions[0][0], 'roster-stored-session')
    assert.deepEqual(calls.requests, [])
    assert.deepEqual(calls.profileRequests, [])
  } finally {
    harness.cleanup()
  }
})

test('profile switch creates a missing session on the selected route and releases its lease', async () => {
  const route = { connectionId: 'source-a', mode: 'remote', profile: 'research', targetProfile: 'research' }
  const { host, calls } = createHost({ routes: [route], sessions: [], routed: true })
  const harness = await createSwitchHarness(host, 'research')

  try {
    await harness.clickSwitch()

    assert.equal(calls.openSessions.length, 1)
    assert.equal(calls.openSessions[0][0], 'created-target-session')
    assert.equal(typeof calls.openSessions[0][0], 'string')
    assert.equal(calls.openSessions[0][1].profile, 'research')
    assert.equal(calls.openSessions[0][1].route, route)
    assert.equal(calls.openSessions[0][1].awaitHydration, false)
    assert.deepEqual(calls.retained, [{ route, options: { spawnPriority: 'foreground' } }])
    assert.deepEqual(calls.profileRequests.map((call) => call.method), ['session.list', 'session.create'])
    assert.equal(calls.profileRequests.every((call) => call.options?.spawnPriority === 'foreground'), true)
    assert.deepEqual(calls.lifecycle.map(([name]) => name), [
      'retainProfile',
      'session.list',
      'session.create',
      'ensureAgent',
      'openSession',
      'releaseProfile'
    ])
  } finally {
    harness.cleanup()
  }
})
