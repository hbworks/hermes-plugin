const { webFrame } = require('electron')

const CONFIG_PREFIX = 'hermes-preview-language:'
const MAX_LANGUAGE_TAGS = 10
const LANGUAGE_TAG_RE = /^(?:[A-Za-z0-9]{1,8})(?:-[A-Za-z0-9]{1,8})*$/

function readConfig() {
  if (typeof window === 'undefined' || typeof window.name !== 'string' || !window.name.startsWith(CONFIG_PREFIX)) {
    return null
  }

  try {
    const raw = JSON.parse(decodeURIComponent(window.name.slice(CONFIG_PREFIX.length)))
    const languages = Array.isArray(raw) ? raw : raw?.languages
    const windowName = Array.isArray(raw) ? '' : typeof raw?.windowName === 'string' ? raw.windowName : ''
    if (!Array.isArray(languages) || languages.length === 0 || languages.length > MAX_LANGUAGE_TAGS) {
      return null
    }

    const validLanguages = languages.filter(
      value => typeof value === 'string' && value.length <= 64 && LANGUAGE_TAG_RE.test(value)
    )
    return validLanguages.length === languages.length ? { languages: validLanguages, windowName } : null
  } catch (_) {
    return null
  }
}

const config = readConfig()
if (config) {
  try {
    window.name = config.windowName
  } catch (_) {}

  const language = JSON.stringify(config.languages[0])
  const serializedLanguages = JSON.stringify(config.languages)
  const script = `(() => {
  const language = ${language};
  const languages = Object.freeze(${serializedLanguages});
  const define = (target, key, getter) => {
    try {
      Object.defineProperty(target, key, { configurable: true, enumerable: true, get: getter });
    } catch (_) {}
  };
  const currentNavigator = window.navigator;
  const navigatorPrototype = Object.getPrototypeOf(currentNavigator);
  define(navigatorPrototype, 'language', () => language);
  define(navigatorPrototype, 'languages', () => languages);
  define(currentNavigator, 'language', () => language);
  define(currentNavigator, 'languages', () => languages);
})()`

  try {
    // world 0 is the page's main world. Unlike an isolated-world mutation,
    // this is visible to document-start page scripts after the preload runs.
    webFrame.executeJavaScript(script, false, () => {})
  } catch (_) {}
}
