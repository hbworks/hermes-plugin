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
export function useValue(value) {
  if (typeof globalThis.__agentActiveManagerReadAtom === 'function') {
    return globalThis.__agentActiveManagerReadAtom(value)
  }
  return typeof value?.get === 'function' ? value.get() : value
}
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
`)

  writeModule(root, 'node_modules/react/package.json', '{"type":"module","main":"./index.js","exports":{".":"./index.js","./jsx-runtime":"./jsx-runtime.js"}}')
  writeModule(root, 'node_modules/react/index.js', `
export function useEffect(effect) {
  globalThis.__agentActiveManagerEffects?.push(effect)
}
export function useMemo(factory) { return factory() }
export function useRef(initial) {
  const index = Number.isInteger(globalThis.__agentActiveManagerRefIndex)
    ? globalThis.__agentActiveManagerRefIndex++
    : -1
  const refs = globalThis.__agentActiveManagerRefs
  if (index >= 0 && Array.isArray(refs)) {
    if (!(index in refs)) refs[index] = { current: initial }
    return refs[index]
  }
  return { current: initial }
}
export function useState(initial) {
  const initialRoster = globalThis.__agentActiveManagerInitialRoster
  const hasStateIndex = Number.isInteger(globalThis.__agentActiveManagerStateIndex)
  const index = hasStateIndex ? globalThis.__agentActiveManagerStateIndex++ : -1
  const stateValues = globalThis.__agentActiveManagerStateValues
  let value = typeof initial === 'function' ? initial() : initial
  if (Array.isArray(initialRoster) && Array.isArray(value) && value.length === 0 && (!hasStateIndex || index === 1)) {
    return [initialRoster, () => {}]
  }
  if (hasStateIndex && Array.isArray(stateValues)) {
    if (index in stateValues) value = stateValues[index]
    else stateValues[index] = value
  }
  return [value, (next) => {
    const previous = hasStateIndex && Array.isArray(stateValues) ? stateValues[index] : value
    const update = typeof next === 'function' ? next(previous) : next
    if (hasStateIndex && Array.isArray(stateValues)) stateValues[index] = update
    if (Array.isArray(globalThis.__agentActiveManagerStateUpdates)) {
      globalThis.__agentActiveManagerStateUpdates.push(update)
    }
  }]
}
export default { useEffect, useMemo, useRef, useState }
`)
  writeModule(root, 'node_modules/react/jsx-runtime.js', `
export function jsx(type, props) { return { type, props: props ?? {} } }
export function jsxs(type, props) { return { type, props: props ?? {} } }
`)
}

function createHost({
  routes = [],
  focusedOwner = null,
  focusedSessionId = 'current-session',
  sessions = [],
  createdRuntimeSessionId = 'created-runtime-session',
  createdStoredSessionId = 'created-stored-session',
  routed = false
} = {}) {
  const calls = {
    openSessions: [],
    eventListener: null,
    profileRequests: [],
    requests: [],
    retained: [],
    lifecycle: []
  }
  const host = {
    agents: async () => ({ agents: [] }),
    state: {
      busyBySession: { get: () => ({}) },
      focusedSessionOwner: { get: () => focusedOwner },
      focusedSessionProfile: { get: () => focusedOwner?.profile || 'default' },
      profile: { get: () => 'default' },
      focusedSessionId: { get: () => focusedSessionId },
      focusedStoredSessionId: { get: () => 'current-session' }
    },
    profileRoutes: async () => routes,
    request: async (method, params) => {
      calls.requests.push({ method, params })
      if (method === 'session.list') return { sessions }
      if (method === 'session.create') {
        return { session_id: createdRuntimeSessionId, stored_session_id: createdStoredSessionId }
      }
      return {}
    },
    onEvent: (type, listener) => {
      calls.lifecycle.push(['onEvent', type])
      calls.eventListener = listener
      return () => calls.lifecycle.push(['unsubscribeEvent'])
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
      if (method === 'session.create') {
        return { session_id: createdRuntimeSessionId, stored_session_id: createdStoredSessionId }
      }
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

async function mountSwitchButton(host, targetProfile, initialRoster = null) {
  const root = mkdtempSync(join(tmpdir(), 'agent-active-manager-switch-'))
  installMocks(root)
  writeModule(root, 'plugin.mjs', readFileSync(new URL('../plugin.js', import.meta.url), 'utf8'))

  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previousWindow = globalThis.window
  const previousTimeout = globalThis.setTimeout
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const hadHost = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerHost')
  const previousHost = globalThis.__agentActiveManagerHost
  const hadRoster = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerInitialRoster')
  const previousRoster = globalThis.__agentActiveManagerInitialRoster
  const hadStates = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerStateValues')
  const previousStates = globalThis.__agentActiveManagerStateValues
  const hadStateIndex = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerStateIndex')
  const previousStateIndex = globalThis.__agentActiveManagerStateIndex
  const hadRefs = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerRefs')
  const previousRefs = globalThis.__agentActiveManagerRefs
  const hadRefIndex = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerRefIndex')
  const previousRefIndex = globalThis.__agentActiveManagerRefIndex
  const stateValues = []
  const refs = []
  const profileRow = initialRoster ?? [{ name: targetProfile, display_name: targetProfile }]

  globalThis.window = { hermesDesktop: {} }
  globalThis.setTimeout = () => 0
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  globalThis.__agentActiveManagerHost = host
  globalThis.__agentActiveManagerInitialRoster = profileRow
  globalThis.__agentActiveManagerStateValues = stateValues
  globalThis.__agentActiveManagerStateIndex = 0
  globalThis.__agentActiveManagerRefs = refs
  globalThis.__agentActiveManagerRefIndex = 0

  const { default: plugin } = await import(pathToFileURL(join(root, 'plugin.mjs')).href)
  let contributions = []
  const unregister = plugin.register({
    registerMany: (entries) => {
      contributions = entries
      return () => {}
    }
  })
  const pane = contributions.find((entry) => entry.id === 'agent-active-manager-pane').render()
  globalThis.__agentActiveManagerStateIndex = 0
  globalThis.__agentActiveManagerRefIndex = 0
  const paneTree = pane.type(pane.props)
  const listTree = renderComponents(paneTree.props.children[1])
  const button = findElement(listTree, (element) => element.type === 'button' && element.props.children === 'Switch ➔')

  return {
    button,
    cleanup: () => {
      unregister?.()
      if (hadWindow) globalThis.window = previousWindow
      else delete globalThis.window
      globalThis.setTimeout = previousTimeout
      if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
      else delete globalThis.localStorage
      if (hadHost) globalThis.__agentActiveManagerHost = previousHost
      else delete globalThis.__agentActiveManagerHost
      if (hadRoster) globalThis.__agentActiveManagerInitialRoster = previousRoster
      else delete globalThis.__agentActiveManagerInitialRoster
      if (hadStates) globalThis.__agentActiveManagerStateValues = previousStates
      else delete globalThis.__agentActiveManagerStateValues
      if (hadStateIndex) globalThis.__agentActiveManagerStateIndex = previousStateIndex
      else delete globalThis.__agentActiveManagerStateIndex
      if (hadRefs) globalThis.__agentActiveManagerRefs = previousRefs
      else delete globalThis.__agentActiveManagerRefs
      if (hadRefIndex) globalThis.__agentActiveManagerRefIndex = previousRefIndex
      else delete globalThis.__agentActiveManagerRefIndex
      rmSync(root, { recursive: true, force: true })
    }
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
  const mounted = await mountSwitchButton(host, targetProfile, initialRoster)
  return {
    clickSwitch: async () => {
      assert.ok(mounted.button, 'switch button should be rendered for a non-focused roster profile')
      mounted.button.props.onClick()
      await new Promise((resolve) => setImmediate(resolve))
    },
    cleanup: mounted.cleanup
  }
}

async function createRosterHarness(host) {
  const root = mkdtempSync(join(tmpdir(), 'agent-active-manager-roster-'))
  installMocks(root)
  writeModule(root, 'plugin.mjs', readFileSync(new URL('../plugin.js', import.meta.url), 'utf8'))

  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previousWindow = globalThis.window
  const previousTimeout = globalThis.setTimeout
  const previousInterval = globalThis.setInterval
  const previousClearInterval = globalThis.clearInterval
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const hadHost = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerHost')
  const previousHost = globalThis.__agentActiveManagerHost
  const hadInitialRoster = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerInitialRoster')
  const previousInitialRoster = globalThis.__agentActiveManagerInitialRoster
  const hadEffects = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerEffects')
  const previousEffects = globalThis.__agentActiveManagerEffects
  const hadStateUpdates = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerStateUpdates')
  const previousStateUpdates = globalThis.__agentActiveManagerStateUpdates
  const hadStateValues = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerStateValues')
  const previousStateValues = globalThis.__agentActiveManagerStateValues
  const hadStateIndex = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerStateIndex')
  const previousStateIndex = globalThis.__agentActiveManagerStateIndex
  const hadRefs = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerRefs')
  const previousRefs = globalThis.__agentActiveManagerRefs
  const hadRefIndex = Object.prototype.hasOwnProperty.call(globalThis, '__agentActiveManagerRefIndex')
  const previousRefIndex = globalThis.__agentActiveManagerRefIndex
  const effects = []
  const stateUpdates = []
  const stateValues = []
  const refs = []
  const effectCleanups = []

  globalThis.window = { hermesDesktop: {} }
  globalThis.setTimeout = () => 0
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  globalThis.__agentActiveManagerHost = host
  if (Array.isArray(host.__agentActiveManagerInitialRoster)) {
    globalThis.__agentActiveManagerInitialRoster = host.__agentActiveManagerInitialRoster
  } else {
    delete globalThis.__agentActiveManagerInitialRoster
  }
  globalThis.__agentActiveManagerEffects = effects
  globalThis.__agentActiveManagerStateUpdates = stateUpdates
  globalThis.__agentActiveManagerStateValues = stateValues
  globalThis.__agentActiveManagerStateIndex = 0
  globalThis.__agentActiveManagerRefs = refs
  globalThis.__agentActiveManagerRefIndex = 0

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
  const renderPane = () => {
    globalThis.__agentActiveManagerStateIndex = 0
    globalThis.__agentActiveManagerRefIndex = 0
    return paneElement.type(paneElement.props)
  }
  const paneTree = renderPane()
  for (const effect of effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') effectCleanups.push(cleanup)
  }
  await new Promise((resolve) => setImmediate(resolve))
  const hydratedPaneTree = renderPane()
  const hydratedListElement = hydratedPaneTree.props.children[1]
  const hydratedListProps = hydratedListElement.props

  return {
    stateUpdates,
    stateValues,
    resetInference: (...args) => hydratedListProps.onResetInference(...args),
    resetAllBusy: (...args) => hydratedListProps.onResetAllBusy(...args),
    getRoster: () => stateValues[0],
    getAgentListProps: () => hydratedListElement.props,
    renderPane,
    cleanup: () => {
      for (const cleanup of effectCleanups) cleanup()
      unregister?.()
      if (hadWindow) globalThis.window = previousWindow
      else delete globalThis.window
      globalThis.setTimeout = previousTimeout
      globalThis.setInterval = previousInterval
      globalThis.clearInterval = previousClearInterval
      if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor)
      else delete globalThis.localStorage
      if (hadHost) globalThis.__agentActiveManagerHost = previousHost
      else delete globalThis.__agentActiveManagerHost
      if (hadEffects) globalThis.__agentActiveManagerEffects = previousEffects
      else delete globalThis.__agentActiveManagerEffects
      if (hadStateUpdates) globalThis.__agentActiveManagerStateUpdates = previousStateUpdates
      else delete globalThis.__agentActiveManagerStateUpdates
      if (hadStateIndex) globalThis.__agentActiveManagerStateIndex = previousStateIndex
      else delete globalThis.__agentActiveManagerStateIndex
      if (hadStateValues) globalThis.__agentActiveManagerStateValues = previousStateValues
      else delete globalThis.__agentActiveManagerStateValues
      if (hadRefs) globalThis.__agentActiveManagerRefs = previousRefs
      else delete globalThis.__agentActiveManagerRefs
      if (hadRefIndex) globalThis.__agentActiveManagerRefIndex = previousRefIndex
      else delete globalThis.__agentActiveManagerRefIndex
      rmSync(root, { recursive: true, force: true })
    }
  }
}

test('profile roster merges duplicated same-named source rows', async () => {
  const { host, calls } = createHost()
  host.request = async (method, params) => {
    calls.requests.push({ method, params })
    if (method === 'profiles.list') return { profiles: [
      { name: 'research', canonical_session: { id: 'stored-research-session', resolved_id: 'runtime-research-session' } },
      { name: 'research', connectionId: 'source-a', profile: 'research' }
    ] }
    throw new Error(`Unsupported gateway method: ${method}`)
  }
  const harness = await createRosterHarness(host)

  try {
    assert.deepEqual(calls.requests.map(({ method }) => method), ['profiles.list'])
    assert.equal(harness.stateValues[1]?.length, 1)
    assert.equal(harness.stateValues[1]?.[0]?.connectionId, 'source-a')
    assert.equal(harness.stateValues[1]?.[0]?.canonical_session?.id, 'stored-research-session')
  } finally {
    harness.cleanup()
  }
})

test('gateway events add runtime sessions to the reactive owner map', async () => {
  const { host, calls } = createHost()
  let busyBySession = { 'runtime-research-session': true }
  host.state.busyBySession = { get: () => busyBySession }
  const stateUpdates = []
  const previousReadAtom = globalThis.__agentActiveManagerReadAtom
  const previousUpdates = globalThis.__agentActiveManagerStateUpdates
  globalThis.__agentActiveManagerReadAtom = (value) => {
    if (value === host.state.busyBySession) return busyBySession
    return typeof value?.get === 'function' ? value.get() : value
  }
  globalThis.__agentActiveManagerStateUpdates = stateUpdates
  host.request = async (method, params) => {
    calls.requests.push({ method, params })
    if (method === 'profiles.list') return {
      profiles: [{ name: 'research', canonical_session: { id: 'stored-research-session', resolved_id: 'stored-research-session' } }]
    }
    throw new Error(`Unsupported gateway method: ${method}`)
  }
  const harness = await createRosterHarness(host)

  try {
    calls.eventListener({
      type: 'message.delta',
      connectionId: 'local',
      profile: 'research',
      session_id: 'runtime-research-session',
      payload: { delta: 'working' }
    })
    assert.equal(harness.stateValues[2]?.['runtime-research-session'], 'research')

    calls.eventListener({
      type: 'message.delta',
      connectionId: 'local',
      session_id: 'runtime-research-session',
      payload: { delta: 'still working' }
    })
    assert.equal(harness.stateValues[3]?.research?.status, 'generating')
  } finally {
    harness.cleanup()
    globalThis.__agentActiveManagerReadAtom = previousReadAtom
    globalThis.__agentActiveManagerStateUpdates = previousUpdates
  }
})

test('stuck-session interrupt uses session.interrupt with the runtime session id', async () => {
  const route = { connectionId: 'source-a', mode: 'local', profile: 'research', targetProfile: 'research' }
  const { host, calls } = createHost({
    routes: [route],
    focusedOwner: { connectionId: 'source-a', profile: 'research' },
    focusedSessionId: 'runtime-research-session'
  })
  host.state.busyBySession = { get: () => ({ 'runtime-research-session': true }) }
  const previousReadAtom = globalThis.__agentActiveManagerReadAtom
  globalThis.__agentActiveManagerReadAtom = (value) => {
    if (value === host.state.busyBySession) return { 'runtime-research-session': true }
    return typeof value?.get === 'function' ? value.get() : value
  }
  host.request = async (method, params) => {
    calls.requests.push({ method, params })
    if (method === 'profiles.list') return {
      profiles: [{
        name: 'research',
        canonical_session: { id: 'stored-research-session', resolved_id: 'stored-research-session' }
      }]
    }
    return {}
  }
  host.agents = async () => ({ agents: [{ connectionId: 'source-a', profile: 'research', name: 'research' }] })
  host.requestProfile = async (profileRoute, method, params, timeoutMs, options) => {
    calls.profileRequests.push({ route: profileRoute, method, params, timeoutMs, options })
    return { status: 'interrupted', interrupted: true }
  }
  const harness = await createRosterHarness(host)

  try {
    assert.equal(harness.stateValues[2]?.['stored-research-session'], 'research')
    const currentTime = Date.now
    Date.now = () => 1_800_000_000_000
    calls.eventListener({
      type: 'message.delta',
      connectionId: 'source-a',
      profile: 'research',
      session_id: 'runtime-research-session',
      payload: { delta: 'working' }
    })
    Date.now = currentTime
    assert.equal(harness.stateValues[2]?.['runtime-research-session'], 'research')
    await harness.resetInference('research')

    assert.equal(calls.profileRequests.length, 1)
    assert.deepEqual(calls.profileRequests[0], {
      route,
      method: 'session.interrupt',
      params: { session_id: 'runtime-research-session' },
      timeoutMs: undefined,
      options: undefined
    })
  } finally {
    harness.cleanup()
    globalThis.__agentActiveManagerReadAtom = previousReadAtom
  }
})

test('interrupt uses the exact event source when profile names collide across routes', async () => {
  const localRoute = { connectionId: 'local', mode: 'local', profile: 'research', targetProfile: 'research' }
  const remoteRoute = { connectionId: 'source-b', mode: 'remote', profile: 'research', targetProfile: 'research' }
  const { host, calls } = createHost({
    routes: [localRoute, remoteRoute],
    focusedOwner: { connectionId: 'source-b', profile: 'research' },
    focusedSessionId: 'runtime-remote-session'
  })
  host.state.busyBySession = { get: () => ({ 'runtime-remote-session': true }) }
  host.agents = async () => ({ agents: [
    { connectionId: 'source-a', profile: 'research', name: 'research' },
    { connectionId: 'source-b', profile: 'research', name: 'research' }
  ] })
  host.requestProfile = async (route, method, params, timeoutMs, options) => {
    calls.profileRequests.push({ route, method, params, timeoutMs, options })
    return { status: 'interrupted', interrupted: true }
  }
  const harness = await createRosterHarness(host)

  try {
    calls.eventListener({
      type: 'message.delta',
      connectionId: 'source-b',
      profile: 'research',
      session_id: 'runtime-remote-session',
      payload: { delta: 'working' }
    })
    await harness.resetInference('research')

    assert.equal(calls.profileRequests.length, 1)
    assert.deepEqual(calls.profileRequests[0], {
      route: remoteRoute,
      method: 'session.interrupt',
      params: { session_id: 'runtime-remote-session' },
      timeoutMs: undefined,
      options: undefined
    })
  } finally {
    harness.cleanup()
  }
})

test('interrupt routes each active session through its own source', async () => {
  const localRoute = { connectionId: 'local', mode: 'local', profile: 'research', targetProfile: 'research' }
  const remoteRoute = { connectionId: 'source-b', mode: 'remote', profile: 'research', targetProfile: 'research' }
  const { host, calls } = createHost({ routes: [localRoute, remoteRoute] })
  host.state.busyBySession = { get: () => ({ 'runtime-local-session': true, 'runtime-remote-session': true }) }
  const previousReadAtom = globalThis.__agentActiveManagerReadAtom
  globalThis.__agentActiveManagerReadAtom = (value) => {
    if (value === host.state.busyBySession) return { 'runtime-local-session': true, 'runtime-remote-session': true }
    return typeof value?.get === 'function' ? value.get() : value
  }
  host.requestProfile = async (route, method, params, timeoutMs, options) => {
    calls.profileRequests.push({ route, method, params, timeoutMs, options })
    return { status: 'interrupted', interrupted: true }
  }
  const harness = await createRosterHarness(host)

  try {
    for (const [sessionId, connectionId] of [
      ['runtime-local-session', 'local'],
      ['runtime-remote-session', 'source-b']
    ]) {
      calls.eventListener({
        type: 'message.delta',
        connectionId,
        profile: 'research',
        session_id: sessionId,
        payload: { delta: 'working' }
      })
    }

    await harness.resetInference('research')

    assert.deepEqual(
      calls.profileRequests.map(({ route, method, params }) => ({ route, method, params })),
      [
        { route: localRoute, method: 'session.interrupt', params: { session_id: 'runtime-local-session' } },
        { route: remoteRoute, method: 'session.interrupt', params: { session_id: 'runtime-remote-session' } }
      ]
    )
  } finally {
    harness.cleanup()
    globalThis.__agentActiveManagerReadAtom = previousReadAtom
  }
})

test('ambient primary default events are attributed to the focused cross-profile owner', async () => {
  const remoteRoute = { connectionId: 'source-b', mode: 'remote', profile: 'research', targetProfile: 'research' }
  const { host, calls } = createHost({
    routes: [remoteRoute],
    focusedOwner: { connectionId: 'source-b', profile: 'research' },
    focusedSessionId: 'runtime-focused-session'
  })
  host.state.busyBySession = { get: () => ({ 'runtime-focused-session': true }) }
  host.agents = async () => ({ agents: [{ connectionId: 'source-b', profile: 'research', name: 'research' }] })
  const previousReadAtom = globalThis.__agentActiveManagerReadAtom
  globalThis.__agentActiveManagerReadAtom = (value) => {
    if (value === host.state.busyBySession) return { 'runtime-focused-session': true }
    return typeof value?.get === 'function' ? value.get() : value
  }
  host.requestProfile = async (route, method, params, timeoutMs, options) => {
    calls.profileRequests.push({ route, method, params, timeoutMs, options })
    return { status: 'interrupted', interrupted: true }
  }
  const harness = await createRosterHarness(host)

  try {
    calls.eventListener({
      type: 'message.delta',
      profile: 'default',
      session_id: 'runtime-focused-session',
      payload: { delta: 'working' }
    })
    await harness.resetInference('research')

    assert.equal(calls.profileRequests.length, 1)
    assert.equal(calls.profileRequests[0].route, remoteRoute)
    assert.equal(calls.profileRequests[0].method, 'session.interrupt')
  } finally {
    harness.cleanup()
    globalThis.__agentActiveManagerReadAtom = previousReadAtom
  }
})

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
    assert.equal(calls.openSessions[0][0], 'created-stored-session')
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
