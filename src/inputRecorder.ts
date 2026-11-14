// An opt-in timeline of how text reaches the page's boxes, for input that does not behave like
// typing (dictation tools, paste helpers). It records lengths and key names, never the text, and
// stays off unless `?debug=input` or the localStorage flag turns it on.

const FLAG_KEY = 'grill-flow:debug-input'
const CARRY_KEY = 'grill-flow:input-log'
const ENDPOINT = '/api/debug/input-log'
const MAX_ENTRIES = 6000
const WATCH_MS = 200
const SHIP_MS = 2000
// The DOM typings lag the Event Timing API's threshold option.
const slowEvents: PerformanceObserverInit & { durationThreshold: number } = {
  type: 'event',
  durationThreshold: 32,
  buffered: false,
}

type Field = string | number | boolean
type Entry = Record<string, Field>

type TextBox = HTMLTextAreaElement | HTMLInputElement

const isTextBox = (target: unknown): target is TextBox =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement

const describe = (target: EventTarget | null): string => {
  if (target === window) {
    return 'window'
  }
  if (target === document) {
    return 'document'
  }
  if (!(target instanceof Element)) {
    return 'none'
  }
  const className =
    typeof target.className === 'string' ? target.className.trim() : ''
  return `${target.localName}${target.id === '' ? '' : `#${target.id}`}${
    className === '' ? '' : `.${className.split(/\s+/).join('.')}`
  }`
}

const lengthOf = (target: EventTarget | null): number =>
  isTextBox(target) ? target.value.length : -1

const modifiersOf = (event: KeyboardEvent): string =>
  [
    event.metaKey ? 'Meta' : '',
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
  ]
    .filter(name => name !== '')
    .join('+')

// A plain character is part of the text, so only its presence is kept; shortcuts and named keys
// are what the timeline is for.
const keyOf = (event: KeyboardEvent): string =>
  event.key.length === 1 && !event.metaKey && !event.ctrlKey
    ? 'char'
    : event.key

/** Turns the recorder on or off from the page's query string, and says whether it is on. */
export const inputRecorderEnabled = (): boolean => {
  try {
    const debug = new URLSearchParams(window.location.search).get('debug')
    if (debug === 'input') {
      window.localStorage.setItem(FLAG_KEY, '1')
    }
    if (debug === 'input-off') {
      window.localStorage.removeItem(FLAG_KEY)
    }
    return window.localStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}

const carriedEntries = (): Array<Entry> => {
  try {
    const carried = window.sessionStorage.getItem(CARRY_KEY)
    window.sessionStorage.removeItem(CARRY_KEY)
    const parsed: unknown = carried === null ? [] : JSON.parse(carried)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const record = (): void => {
  const entries: Array<Entry> = carriedEntries()
  const seen = new WeakMap<Element, string>()
  const state = {
    shipped: entries.length,
    shipping: true,
    maybeFocused: document.activeElement,
  }

  const log = (type: string, fields: Entry = {}): Entry => {
    const entry: Entry = {
      // The recorder runs outside the Foldkit program, so no Command exists to take the time in.
      // oxlint-disable-next-line foldkit/no-impure-call-at-decision-time
      at: Math.round((performance.timeOrigin + performance.now()) * 10) / 10,
      type,
      ...fields,
    }
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) {
      const dropped = entries.length - MAX_ENTRIES
      entries.splice(0, dropped)
      state.shipped = Math.max(0, state.shipped - dropped)
    }
    return entry
  }

  const navigation = performance.getEntriesByType('navigation')[0]
  log('boot', {
    navigation:
      navigation instanceof PerformanceNavigationTiming
        ? navigation.type
        : 'unknown',
    path: window.location.pathname,
    agent: navigator.userAgent,
  })

  const remember = (target: EventTarget | null): void => {
    if (isTextBox(target)) {
      seen.set(target, target.value)
    }
  }

  // The default action runs after every listener, so what an event did to the box, and whether
  // a listener prevented it, is only known once the dispatch is over.
  const afterDispatch = (event: Event, entry: Entry): void => {
    window.setTimeout(() => {
      entry.prevented = event.defaultPrevented
      entry.lenAfter = lengthOf(event.target)
      remember(event.target)
    }, 0)
  }

  const onKey = (event: KeyboardEvent): void => {
    afterDispatch(
      event,
      log(event.type, {
        key: keyOf(event),
        code: event.code,
        modifiers: modifiersOf(event),
        repeat: event.repeat,
        composing: event.isComposing,
        el: describe(event.target),
        len: lengthOf(event.target),
      }),
    )
  }

  const listen = <Name extends keyof WindowEventMap>(
    type: Name,
    handler: (event: WindowEventMap[Name]) => void,
  ): void => {
    window.addEventListener(
      type,
      event => {
        try {
          handler(event)
        } catch {
          // A recorder fault must never reach the page it is watching.
        }
      },
      { capture: true },
    )
  }

  listen('keydown', onKey)
  listen('keyup', onKey)
  listen('focusin', event => {
    state.maybeFocused = event.target instanceof Element ? event.target : null
    remember(event.target)
    log('focusin', {
      el: describe(event.target),
      from: describe(event.relatedTarget),
      len: lengthOf(event.target),
    })
  })
  listen('focusout', event => {
    log('focusout', {
      el: describe(event.target),
      to: describe(event.relatedTarget),
      len: lengthOf(event.target),
    })
  })
  listen('focus', event => {
    if (event.target === window) {
      log('window-focus')
    }
  })
  listen('blur', event => {
    if (event.target === window) {
      log('window-blur', { el: describe(document.activeElement) })
    }
  })
  // NOTE: the clipboard is deliberately left unread. A dictation tool can hand its text over
  // on the first read and take the clipboard back, so a read here could cause the very
  // failure being recorded.
  listen('paste', event => {
    afterDispatch(
      event,
      log('paste', {
        el: describe(event.target),
        len: lengthOf(event.target),
      }),
    )
  })
  listen('beforeinput', event => {
    afterDispatch(
      event,
      log('beforeinput', {
        el: describe(event.target),
        inputType: event.inputType,
        data: event.data?.length ?? -1,
        len: lengthOf(event.target),
      }),
    )
  })
  listen('input', event => {
    remember(event.target)
    log('input', {
      el: describe(event.target),
      inputType: event instanceof InputEvent ? event.inputType : '',
      len: lengthOf(event.target),
    })
  })
  listen('compositionstart', event => {
    log('compositionstart', { el: describe(event.target) })
  })
  listen('compositionend', event => {
    log('compositionend', {
      el: describe(event.target),
      data: event.data.length,
    })
  })
  listen('pagehide', () => {
    log('pagehide')
    window.sessionStorage.setItem(CARRY_KEY, JSON.stringify(entries))
  })
  document.addEventListener('visibilitychange', () => {
    log('visibility', { state: document.visibilityState })
  })

  // Page code that writes a box's value shows up here with the box it wrote to.
  const valueProperty = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )
  if (valueProperty?.get !== undefined && valueProperty.set !== undefined) {
    const readValue = valueProperty.get
    const writeValue = valueProperty.set
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
      configurable: true,
      enumerable: valueProperty.enumerable ?? true,
      get(this: HTMLTextAreaElement): string {
        return String(readValue.call(this))
      },
      set(this: HTMLTextAreaElement, next: string) {
        const before = String(readValue.call(this))
        writeValue.call(this, next)
        const after = String(readValue.call(this))
        seen.set(this, after)
        if (before !== after) {
          log('value-set', {
            el: describe(this),
            len: before.length,
            lenAfter: after.length,
            focused: document.activeElement === this,
          })
        }
      },
    })
  }

  // Text that arrives with no input event and no script write (an accessibility or dictation
  // tool writing the box directly) only shows as a value that changed between two looks.
  window.setInterval(() => {
    document.querySelectorAll('textarea').forEach(box => {
      const before = seen.get(box)
      if (before !== undefined && before !== box.value) {
        log('value-drift', {
          el: describe(box),
          len: before.length,
          lenAfter: box.value.length,
          focused: document.activeElement === box,
        })
      }
      seen.set(box, box.value)
    })
  }, WATCH_MS)

  const panel = document.createElement('div')
  panel.id = 'input-recorder'
  panel.setAttribute(
    'style',
    'position:fixed;left:8px;bottom:8px;z-index:2147483647;display:flex;gap:6px;align-items:center;padding:6px 8px;border-radius:8px;background:#1b1b1f;color:#f4f4f5;font:12px/1.2 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.35)',
  )

  const textAreasIn = (node: Node): Array<HTMLTextAreaElement> =>
    node instanceof HTMLTextAreaElement
      ? [node]
      : node instanceof Element
        ? Array.from(node.querySelectorAll('textarea'))
        : []

  // The whole document is watched because the runtime replaces the root element it is given;
  // the recorder's own panel is the one part of it that is not the page.
  new MutationObserver(all => {
    const records = all.filter(
      mutation =>
        !(mutation.target instanceof Node && panel.contains(mutation.target)) &&
        mutation.target !== document.body,
    )
    const bodyRecords = all.filter(
      mutation =>
        mutation.target === document.body &&
        !Array.from(mutation.addedNodes).includes(panel),
    )
    const pageRecords = [...records, ...bodyRecords]
    if (pageRecords.length === 0) {
      return
    }
    log('render', { records: pageRecords.length })
    pageRecords.forEach(mutation => {
      mutation.removedNodes.forEach(node => {
        textAreasIn(node).forEach(box => {
          log('unmount', {
            el: describe(box),
            len: box.value.length,
            hadFocus: state.maybeFocused === box,
            stillInPage: box.isConnected,
          })
        })
      })
      mutation.addedNodes.forEach(node => {
        textAreasIn(node).forEach(box => {
          seen.set(box, box.value)
          log('mount', { el: describe(box), len: box.value.length })
        })
      })
    })
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  })

  new PerformanceObserver(list => {
    list.getEntries().forEach(resource => {
      const path = new URL(resource.name, window.location.href).pathname
      if (path.startsWith('/api/') && path !== ENDPOINT) {
        log('fetch', { path, ms: Math.round(resource.duration) })
      }
    })
  }).observe({ type: 'resource', buffered: false })

  // A busy page answers a paste keystroke late; these say how late and for how long.
  new PerformanceObserver(list => {
    list.getEntries().forEach(task => {
      log('longtask', {
        ms: Math.round(task.duration),
        startedAt:
          Math.round((performance.timeOrigin + task.startTime) * 10) / 10,
      })
    })
  }).observe({ type: 'longtask', buffered: false })
  new PerformanceObserver(list => {
    list.getEntries().forEach(timing => {
      if (
        timing instanceof PerformanceEventTiming &&
        (timing.name === 'keydown' || timing.name === 'paste')
      ) {
        log('slow-event', {
          name: timing.name,
          waitedMs: Math.round(timing.processingStart - timing.startTime),
          handledMs: Math.round(timing.processingEnd - timing.processingStart),
          paintedMs: Math.round(timing.duration),
          startedAt:
            Math.round((performance.timeOrigin + timing.startTime) * 10) / 10,
        })
      }
    })
  }).observe(slowEvents)

  const ship = (): void => {
    if (!state.shipping || state.shipped >= entries.length) {
      return
    }
    const from = state.shipped
    state.shipped = entries.length
    void fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ entries: entries.slice(from) }),
    })
      .then(response => {
        // A server without the log file set answers 404: the Copy button is the way out then.
        if (!response.ok) {
          state.shipping = false
        }
      })
      .catch(() => {
        state.shipping = false
      })
  }
  window.setInterval(ship, SHIP_MS)
  window.addEventListener('pagehide', ship)

  const count = document.createElement('span')
  panel.append(count)
  const button = (label: string, press: () => void): void => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.setAttribute(
      'style',
      'font:inherit;color:inherit;background:#3f3f46;border:0;border-radius:6px;padding:4px 8px;cursor:pointer',
    )
    // Taking focus would itself blur the box under test.
    element.addEventListener('mousedown', event => event.preventDefault())
    element.addEventListener('click', press)
    panel.append(element)
  }
  const mark = (verdict: string): void => {
    log('mark', {
      verdict,
      el: describe(document.activeElement),
      len: lengthOf(document.activeElement),
    })
  }
  button('Dictation failed', () => mark('failed'))
  button('Dictation worked', () => mark('worked'))
  button('Copy log', () => {
    void navigator.clipboard
      .writeText(entries.map(entry => JSON.stringify(entry)).join('\n'))
      .then(() => log('copied'))
      .catch(() => log('copy-failed'))
  })
  button('Stop', () => {
    window.localStorage.removeItem(FLAG_KEY)
    ship()
    panel.remove()
  })
  document.body.append(panel)
  window.setInterval(() => {
    count.textContent = `Input log · ${entries.length}${state.shipping ? '' : ' · not shipped'}`
  }, 500)
}

/** Starts the recorder when it is switched on; a fault in it never stops the page. */
export const startInputRecorder = (): void => {
  try {
    if (inputRecorderEnabled()) {
      record()
    }
  } catch {
    // Diagnostics only.
  }
}
