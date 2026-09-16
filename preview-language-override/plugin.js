import { atom, PANES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'preview-language-override'
const PREVIEW_PARTITION = 'persist:hermes-preview'
const STORAGE_KEY = 'settings'
const MAX_LANGUAGE_TAGS = 10
const MAX_LANGUAGE_TAG_LENGTH = 64
const DEFAULT_LANGUAGES = ['en-US', 'ja-JP', 'en-JP']
const LANGUAGE_TAG_RE = /^(?:[A-Za-z0-9]{1,8})(?:-[A-Za-z0-9]{1,8})*$/
const CONTROLLER_SLOT = Symbol.for('hermes.preview-language-override.controller')
const CONFIG_PREFIX = 'hermes-preview-language:'
const PRELOAD_URL = (() => {
  try {
    return new URL('./preload.js', import.meta.url).href
  } catch (_) {
    return ''
  }
})()

const DEFAULT_SETTINGS = {
  enabled: false,
  languages: [...DEFAULT_LANGUAGES]
}

const EMPTY_SETTINGS = atom(DEFAULT_SETTINGS)
const EMPTY_STATUS = atom({ kind: 'disabled', message: 'Preview language override is starting…' })
const EMPTY_OBSERVED = atom({ language: '', languages: [], tabs: 0 })

function isLanguageTag(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LANGUAGE_TAG_LENGTH &&
    LANGUAGE_TAG_RE.test(value)
}

function parseLanguageTags(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : []
  const valid = []

  for (const raw of values) {
    const tag = String(raw).trim().split(';', 1)[0]
    if (!isLanguageTag(tag) || valid.includes(tag)) {
      continue
    }
    valid.push(tag)
    if (valid.length >= MAX_LANGUAGE_TAGS) {
      break
    }
  }

  return valid
}

function inspectLanguageInput(value) {
  const tokens = String(value || '')
    .split(/[\s,]+/)
    .map(token => token.trim().split(';', 1)[0])
    .filter(Boolean)
  const valid = []
  const invalid = []

  for (const token of tokens) {
    if (!isLanguageTag(token)) {
      invalid.push(token)
      continue
    }
    if (!valid.includes(token) && valid.length < MAX_LANGUAGE_TAGS) {
      valid.push(token)
    }
  }

  return { invalid, valid }
}

function normalizeSettings(raw) {
  const languages = parseLanguageTags(raw?.languages)

  return {
    enabled: raw?.enabled === true,
    languages: languages.length > 0 ? languages : [...DEFAULT_LANGUAGES]
  }
}

function buildAcceptLanguage(languages) {
  return languages
    .map((language, index) => {
      if (index === 0) {
        return language
      }

      const quality = Math.max(0.1, 1 - index * 0.1).toFixed(1)
      return `${language};q=${quality}`
    })
    .join(',')
}

function mergeAcceptLanguageHeader(options, header) {
  const next = { ...(options || {}) }
  const existing = typeof next.extraHeaders === 'string' ? next.extraHeaders : ''
  const preserved = existing
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^accept-language\s*:/i.test(line))

  next.extraHeaders = [...preserved, `Accept-Language: ${header}`].join('\n') + '\n'
  return next
}

function navigatorOverrideScript(languages) {
  const primary = JSON.stringify(languages[0])
  const serializedLanguages = JSON.stringify(languages)

  return `(() => {
  const language = ${primary};
  const languages = Object.freeze(${serializedLanguages});
  const define = (target, key, getter) => {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get: getter
      });
    } catch (_) {}
  };
  const currentNavigator = window.navigator;
  const navigatorPrototype = Object.getPrototypeOf(currentNavigator);
  define(navigatorPrototype, 'language', () => language);
  define(navigatorPrototype, 'languages', () => languages);
  define(currentNavigator, 'language', () => language);
  define(currentNavigator, 'languages', () => languages);
  return {
    language: currentNavigator.language,
    languages: Array.from(currentNavigator.languages || [])
  };
})()`
}

function guestConfigScript(languages) {
  const serializedLanguages = JSON.stringify(languages)
  const serializedPrefix = JSON.stringify(CONFIG_PREFIX)

  return `(() => {
  const prefix = ${serializedPrefix};
  window.name = prefix + encodeURIComponent(JSON.stringify({ languages: ${serializedLanguages} }));
  return true;
})()`
}

function isPreviewWebview(value) {
  return value &&
    typeof value.getAttribute === 'function' &&
    value.tagName?.toLowerCase() === 'webview' &&
    value.getAttribute('partition') === PREVIEW_PARTITION
}

function currentGuestUrl(webview) {
  try {
    return webview.getURL?.() || webview.getAttribute?.('src') || ''
  } catch (_) {
    return webview.getAttribute?.('src') || ''
  }
}

function isBlankUrl(url) {
  return !url || /^about:blank\/?$/i.test(url)
}

function controllerSlot() {
  return typeof globalThis === 'undefined' ? null : globalThis[CONTROLLER_SLOT]
}

function createController(storage) {
  const initial = (() => {
    try {
      return normalizeSettings(storage.get(STORAGE_KEY, DEFAULT_SETTINGS))
    } catch (_) {
      return normalizeSettings(DEFAULT_SETTINGS)
    }
  })()
  const settings = atom(initial)
  const status = atom({ kind: initial.enabled ? 'working' : 'disabled', message: initial.enabled ? 'Starting…' : 'Override is disabled.' })
  const observed = atom({ language: '', languages: [], tabs: 0 })
  const attached = new Map()
  let observer = null
  let scanTimer = null
  let disposed = false

  const persist = next => {
    try {
      storage.set(STORAGE_KEY, next)
    } catch (_) {}
  }

  const readSettings = () => settings.get()

  const setStatus = (kind, message) => {
    status.set({ kind, message })
  }

  const applyNavigator = async state => {
    if (!readSettings().enabled || typeof state.webview.executeJavaScript !== 'function') {
      return null
    }

    const config = readSettings()
    try {
      const result = await state.webview.executeJavaScript(navigatorOverrideScript(config.languages))
      if (result && typeof result.language === 'string' && Array.isArray(result.languages)) {
        observed.set({
          language: result.language,
          languages: result.languages,
          tabs: attached.size
        })
      }
      return result
    } catch (_) {
      // Electron rejects executeJavaScript while a guest is between documents.
      // The next navigation event retries it after the document is ready.
      return null
    }
  }

  const originalLoad = (state, url, options = {}) => {
    if (typeof state.originalLoadURL !== 'function') {
      return Promise.reject(new Error('Preview webview cannot load URLs'))
    }

    const header = buildAcceptLanguage(readSettings().languages)
    const result = state.originalLoadURL.call(state.webview, url, mergeAcceptLanguageHeader(options, header))
    return result && typeof result.then === 'function' ? result : Promise.resolve(result)
  }

  const ensurePreload = state => {
    if (!PRELOAD_URL || !readSettings().enabled || state.preloadInstalled) {
      return
    }

    try {
      state.webview.setAttribute('preload', PRELOAD_URL)
      state.preloadInstalled = true
    } catch (_) {}
  }

  const restorePreload = state => {
    if (!state.preloadInstalled) {
      return
    }

    try {
      if (state.originalPreload === null) {
        state.webview.removeAttribute('preload')
      } else {
        state.webview.setAttribute('preload', state.originalPreload)
      }
    } catch (_) {}
    state.preloadInstalled = false
  }

  const prepareGuest = async state => {
    if (!readSettings().enabled || typeof state.webview.executeJavaScript !== 'function') {
      return
    }

    ensurePreload(state)
    try {
      // window.name survives a cross-origin navigation and is available to the
      // static preload before the page's document-start scripts run.
      await state.webview.executeJavaScript(guestConfigScript(readSettings().languages))
    } catch (_) {
      // The first document can still be attaching; preload will use the last
      // value and the navigation event will retry on the next load.
    }
  }

  const clearGuestConfig = state => {
    if (typeof state.webview.executeJavaScript !== 'function') {
      return Promise.resolve()
    }

    const prefix = JSON.stringify(CONFIG_PREFIX)
    try {
      return Promise.resolve(state.webview.executeJavaScript(
        `if (typeof window.name === 'string' && window.name.startsWith(${prefix})) window.name = ''; true`
      )).catch(() => undefined)
    } catch (_) {
      return Promise.resolve()
    }
  }

  const loadWithOverride = async (state, url, options = {}) => {
    await prepareGuest(state)
    return originalLoad(state, url, options)
  }

  const reloadWithOverride = async state => {
    if (!readSettings().enabled) {
      return false
    }

    const url = currentGuestUrl(state.webview)
    if (isBlankUrl(url)) {
      await prepareGuest(state)
      await applyNavigator(state)
      return true
    }

    try {
      state.headerApplied = true
      await loadWithOverride(state, url)
      await applyNavigator(state)
      return true
    } catch (_) {
      state.headerApplied = false
      return false
    }
  }

  const restoreWithoutOverride = state => {
    state.headerApplied = false
    restorePreload(state)
    const originalReload = state.originalReload

    return clearGuestConfig(state).finally(() => {
      if (typeof originalReload === 'function') {
        try {
          originalReload.call(state.webview)
        } catch (_) {}
      }
    })
  }

  const patchMethod = (state, name, wrapper) => {
    const original = state.webview[name]
    if (typeof original !== 'function') {
      return
    }

    state[`original${name[0].toUpperCase()}${name.slice(1)}`] = original
    try {
      state.webview[name] = wrapper
      state[`wrapped${name[0].toUpperCase()}${name.slice(1)}`] = wrapper
    } catch (_) {
      // The webview tag may expose a read-only method on an older Electron.
    }
  }

  const detach = state => {
    for (const [event, listener] of state.listeners) {
      state.webview.removeEventListener(event, listener)
    }

    const restoreMethods = [
      ['loadURL', state.originalLoadURL, state.wrappedLoadURL]
    ]
    for (const [name, original, wrapped] of restoreMethods) {
      if (original && state.webview[name] === wrapped) {
        try {
          state.webview[name] = original
        } catch (_) {}
      }
    }
    restorePreload(state)
    attached.delete(state.webview)
  }

  const attach = webview => {
    if (!isPreviewWebview(webview) || attached.has(webview)) {
      return
    }

    const state = {
      headerApplied: false,
      listeners: [],
      originalPreload: webview.getAttribute('preload') ?? null,
      originalReload: typeof webview.reload === 'function' ? webview.reload : null,
      preloadInstalled: false,
      webview
    }
    attached.set(webview, state)
    ensurePreload(state)

    const onReady = () => {
      if (readSettings().enabled) {
        void applyNavigator(state)
        void clearGuestConfig(state)
      }
    }
    const onStop = () => {
      if (readSettings().enabled && !state.headerApplied) {
        void reloadWithOverride(state)
      } else {
        onReady()
      }
    }
    state.listeners = [
      ['dom-ready', onReady],
      ['did-finish-load', onReady],
      ['did-navigate', onReady],
      ['did-navigate-in-page', onReady],
      ['did-stop-loading', onStop]
    ]
    for (const [event, listener] of state.listeners) {
      webview.addEventListener(event, listener)
    }

    patchMethod(state, 'loadURL', function (url, options) {
      if (!readSettings().enabled) {
        return state.originalLoadURL.call(this, url, options)
      }
      return loadWithOverride(state, url, options)
    })
    // The core creates the webview with src already set. Give it one short
    // turn to finish attaching before replacing the first request with one
    // carrying the override header.
    setTimeout(() => {
      if (!disposed && attached.get(webview) === state && readSettings().enabled && !state.headerApplied) {
        void reloadWithOverride(state)
      }
    }, 250)
  }

  const scan = () => {
    if (disposed || typeof document === 'undefined') {
      return
    }

    for (const webview of document.querySelectorAll('webview')) {
      attach(webview)
    }

    for (const state of attached.values()) {
      if (!state.webview.isConnected) {
        detach(state)
      }
    }
  }

  const applyAll = async (forceReload = true) => {
    if (!readSettings().enabled) {
      setStatus('disabled', 'Override is disabled.')
      return
    }

    scan()
    const states = [...attached.values()]
    if (states.length === 0) {
      setStatus('idle', 'No preview browser is open yet.')
      return
    }

    setStatus('working', `Applying to ${states.length} preview browser${states.length === 1 ? '' : 's'}…`)
    const results = await Promise.all(states.map(state => forceReload ? reloadWithOverride(state) : applyNavigator(state)))
    const applied = results.filter(Boolean).length
    setStatus(
      applied === states.length ? 'success' : 'warning',
      `Applied to ${applied}/${states.length} preview browser${states.length === 1 ? '' : 's'}.`
    )
  }

  const update = (patch, { reload = true } = {}) => {
    const next = normalizeSettings({ ...readSettings(), ...patch })
    settings.set(next)
    persist(next)

    if (next.enabled) {
      void applyAll(reload)
    } else {
      for (const state of attached.values()) {
        restoreWithoutOverride(state)
      }
      setStatus('disabled', 'Override is disabled.')
    }
  }

  const start = () => {
    if (typeof document === 'undefined') {
      return
    }

    scan()
    const root = document.documentElement
    if (root && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(scan)
      observer.observe(root, { childList: true, subtree: true })
    }
    scanTimer = setInterval(scan, 2000)

    if (readSettings().enabled) {
      void applyAll(true)
    }
  }

  const dispose = () => {
    disposed = true
    observer?.disconnect()
    if (scanTimer) {
      clearInterval(scanTimer)
    }
    for (const state of [...attached.values()]) {
      if (readSettings().enabled) {
        restoreWithoutOverride(state)
      }
      detach(state)
    }
    attached.clear()
  }

  start()

  return { applyAll, dispose, observed, settings, status, update }
}

let activeController = null

function PreviewLanguagePane() {
  const controller = activeController
  const config = useValue(controller?.settings || EMPTY_SETTINGS)
  const status = useValue(controller?.status || EMPTY_STATUS)
  const observed = useValue(controller?.observed || EMPTY_OBSERVED)
  const [draft, setDraft] = useState(() => config?.languages?.join(', ') || DEFAULT_LANGUAGES.join(', '))
  const [error, setError] = useState('')

  useEffect(() => {
    if (config?.languages) {
      setDraft(config.languages.join(', '))
    }
  }, [config?.languages?.join('|')])

  if (!controller || !config || !status || !observed) {
    return jsx('div', { className: 'p-3 text-sm text-(--ui-text-tertiary)', children: 'Preview language override is starting…' })
  }

  const configuredAcceptLanguage = buildAcceptLanguage(config.languages)
  const apply = () => {
    const parsed = inspectLanguageInput(draft)
    if (parsed.invalid.length > 0 || parsed.valid.length === 0) {
      setError(
        parsed.invalid.length > 0
          ? `Invalid language tag: ${parsed.invalid.join(', ')}`
          : 'Enter at least one BCP 47 language tag.'
      )
      return
    }

    setError('')
    controller.update({ enabled: true, languages: parsed.valid })
  }
  const disable = () => {
    setError('')
    controller.update({ enabled: false }, { reload: false })
  }

  return jsxs('div', {
    className: 'flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-3 text-sm',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          jsx('div', { className: 'font-medium text-(--ui-text-primary)', children: 'Preview Browser Language' }),
          jsx('div', {
            className: 'text-xs leading-relaxed text-(--ui-text-tertiary)',
            children: 'Override Accept-Language and the top-level navigator language values in Hermes preview browsers.'
          })
        ]
      }),
      jsxs('label', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx('span', { className: 'text-xs text-(--ui-text-secondary)', children: 'Language tags (first tag is primary)' }),
          jsx('input', {
            className: 'w-full rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1.5 text-(--ui-text-primary) outline-none',
            value: draft,
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                apply()
              }
            },
            placeholder: 'ja-JP, ja, en-US',
            spellCheck: false,
            type: 'text'
          }),
          jsx('span', {
            className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
            children: 'Use BCP 47 tags separated by commas or spaces, for example ja-JP, fr-FR, or zh-Hant-TW.'
          })
        ]
      }),
      error && jsx('div', { className: 'rounded border border-(--ui-danger) px-2 py-1.5 text-xs text-(--ui-danger)', children: error }),
      jsxs('div', {
        className: 'flex gap-2',
        children: [
          jsx('button', {
            className: 'rounded bg-(--ui-accent) px-2.5 py-1.5 text-xs text-(--ui-accent-foreground)',
            onClick: apply,
            type: 'button',
            children: 'Apply & Reload Preview'
          }),
          jsx('button', {
            className: 'rounded border border-(--ui-stroke-secondary) px-2.5 py-1.5 text-xs text-(--ui-text-secondary)',
            disabled: !config.enabled,
            onClick: disable,
            type: 'button',
            children: 'Disable'
          })
        ]
      }),
      jsxs('section', {
        className: 'flex flex-col gap-1 rounded border border-(--ui-stroke-secondary) p-2',
        children: [
          jsx('div', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: config.enabled ? 'Override enabled' : 'Override disabled' }),
          jsx('div', { className: 'break-all text-[0.6875rem] text-(--ui-text-tertiary)', children: `Accept-Language: ${configuredAcceptLanguage}` }),
          jsx('div', { className: 'break-all text-[0.6875rem] text-(--ui-text-tertiary)', children: `navigator.language: ${config.languages[0]}` }),
          jsx('div', { className: 'break-all text-[0.6875rem] text-(--ui-text-tertiary)', children: `navigator.languages: ${config.languages.join(', ')}` })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-col gap-1 text-[0.6875rem] text-(--ui-text-tertiary)',
        children: [
          jsx('div', { className: status.kind === 'warning' ? 'text-(--ui-warning)' : status.kind === 'success' ? 'text-(--ui-success)' : '', children: status.message }),
          observed.language && jsx('div', { children: `Last page result: navigator.language=${observed.language}; navigator.languages=${observed.languages.join(', ')}` }),
          jsx('div', { className: 'leading-relaxed text-(--ui-text-quaternary)', children: 'Apply reloads the current preview page so an explicit loadURL request uses the selected header. The preload is best-effort; the post-load fallback handles existing tabs, while forms and hard-reload semantics remain native.' })
        ]
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Preview Language Override',
  description: 'Override language headers and navigator language values in Hermes preview browsers.',
  defaultEnabled: false,
  register(ctx) {
    const previous = controllerSlot()
    previous?.dispose?.()
    const controller = createController(ctx.storage)
    activeController = controller
    globalThis[CONTROLLER_SLOT] = controller

    const contributions = [
      {
        id: 'pane',
        area: PANES_AREA || 'panes',
        title: 'Preview Language',
        data: { placement: 'right', defaultOpen: true, width: '320px' },
        render: () => jsx(PreviewLanguagePane, {})
      },
      {
        id: 'route',
        area: ROUTES_AREA || 'routes',
        data: { path: '/preview-language', title: 'Preview Language' },
        render: () => jsx(PreviewLanguagePane, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA || 'sidebar.nav',
        order: 48,
        data: { codicon: 'globe', label: 'Preview Language', path: '/preview-language' }
      }
    ]

    const disposeContributions = typeof ctx.registerMany === 'function'
      ? ctx.registerMany(contributions)
      : (() => {
          const disposers = contributions.map(contribution => ctx.register(contribution))
          return () => disposers.forEach(disposer => disposer?.())
        })()

    const disposeController = () => {
      controller.dispose?.()
      if (activeController === controller) {
        if (controllerSlot() === controller) {
          delete globalThis[CONTROLLER_SLOT]
        }
        activeController = null
      }
    }

    // The desktop loader tracks context disposers during disable and hot
    // reload. Returning a cleanup function alone is insufficient because the
    // loader does not consume the value returned by register().
    if (typeof ctx.onDispose === 'function') {
      ctx.onDispose(disposeController)
    }

    return () => {
      disposeContributions?.()
      disposeController()
    }
  }
}
