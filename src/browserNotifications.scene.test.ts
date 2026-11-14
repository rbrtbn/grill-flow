import { Effect, Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { expect as assert, it, vi } from 'vitest'

import { initialBrowserNotices } from './browserNotifications'
import { Snapshot } from './domain'
import {
  DisableBrowserNotices,
  EnableBrowserNotices,
  FillBox,
  Message,
  OpenBrowserNotice,
  PageData,
  SyncBrowserNotices,
  init,
  update,
} from './main'
import { view } from './view'

const raw = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill: raw,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
})
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
).model
const loaded = {
  ...start,
  page: PageData.Success({ data: snapshot }),
  workspace: { ...start.workspace, isSettingsOpen: true },
  browserNotices: {
    ...initialBrowserNotices,
    status: 'Default' as const,
    ready: true,
  },
}

const fillOne = Mount.resolveAll([FillBox, Message.CompletedFillBox()])

it('offers explicit opt-in, permission progress, on state and a local turn-off control', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(selector('.f-notification-status')).toHaveText(
      'Off in this browser.',
    ),
    click(role('button', { name: 'Enable browser notifications' })),
    expect(role('button', { name: 'Waiting for permission…' })).toBeDisabled(),
    Command.resolve(
      EnableBrowserNotices,
      Message.CompletedEnableBrowserNotices({
        result: { enabled: true, status: 'Granted' },
      }),
    ),
    Command.resolve(
      SyncBrowserNotices,
      Message.CompletedSyncBrowserNotices({
        result: { enabled: true, status: 'Granted' },
      }),
    ),
    expect(selector('.f-notification-status')).toHaveText(
      'On in this browser.',
    ),
    click(role('button', { name: 'Turn off browser notifications' })),
    Command.resolve(
      DisableBrowserNotices,
      Message.CompletedDisableBrowserNotices({
        result: { enabled: false, status: 'Granted' },
        failed: false,
      }),
    ),
    expect(selector('.f-notification-status')).toHaveText(
      'Off in this browser.',
    ),
  )
})

it('keeps denied and unsupported capability states readable', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      browserNotices: { ...loaded.browserNotices, status: 'Denied' },
    }),
    fillOne,
    expect(selector('.f-notification-status')).toContainText(
      'Blocked in browser settings',
    ),
    expect(
      role('button', { name: 'Check notification permission' }),
    ).toBeEnabled(),
  )
  scene(
    { update, view },
    given({
      ...loaded,
      browserNotices: { ...loaded.browserNotices, status: 'Unsupported' },
    }),
    fillOne,
    expect(selector('.f-notification-status')).toContainText('cannot provide'),
    expect(
      role('button', { name: 'Enable browser notifications' }),
    ).toBeDisabled(),
  )
})

it('serializes snapshot checks, seeds once and ignores a stale completion after turning off', () => {
  const enabled = {
    ...loaded,
    browserNotices: { ...loaded.browserNotices, enabled: true },
  }
  const first = update(
    enabled,
    Message.CompletedLoadGrill({ result: Result.succeed(snapshot) }),
  )
  assert(
    first.commands?.find(command => command.name === 'SyncBrowserNotices')
      ?.args,
  ).toMatchObject({ baseline: true })
  const pending = update(
    first.model,
    Message.CompletedLoadGrill({ result: Result.succeed(snapshot) }),
  )
  assert(
    pending.commands?.some(command => command.name === 'SyncBrowserNotices'),
  ).not.toBe(true)
  const done = update(
    pending.model,
    Message.CompletedSyncBrowserNotices({
      result: { enabled: true, status: 'Granted' },
    }),
  )
  const later = update(
    done.model,
    Message.CompletedLoadGrill({ result: Result.succeed(snapshot) }),
  )
  assert(
    later.commands?.find(command => command.name === 'SyncBrowserNotices')
      ?.args,
  ).toMatchObject({ baseline: false })
  const off = update(later.model, Message.ClickedDisableBrowserNotices())
  const stale = update(
    off.model,
    Message.CompletedSyncBrowserNotices({
      result: { enabled: true, status: 'Granted' },
    }),
  )
  assert(stale.model.browserNotices.enabled).toBe(false)
  assert(
    update(
      update(loaded, Message.ClickedEnableBrowserNotices()).model,
      Message.ClickedEnableBrowserNotices(),
    ).commands,
  ).toBeUndefined()
})

it('treats click and failure as notification facts without changing read markers, answers or owner work', async () => {
  const href = '/g/alpha/needs-you#item'
  const opened = update(
    loaded,
    Message.RequestedBrowserNoticeNavigation({ href }),
  )
  assert(opened.model).toBe(loaded)
  assert(opened.commands?.map(command => command.name)).toEqual([
    'OpenBrowserNotice',
  ])
  assert(
    update(
      loaded,
      Message.RequestedBrowserNoticeNavigation({
        href: 'https://example.test',
      }),
    ).commands,
  ).toBeUndefined()
  const failed = update(loaded, Message.BrowserNoticeDeliveryFailed())
  assert(failed.commands?.map(command => command.name)).toEqual([
    'DisableBrowserNotices',
  ])
  assert(failed.model.answers).toBe(loaded.answers)
  assert(failed.model.readIds).toBe(loaded.readIds)
  assert(failed.model.workspace.activityRead).toBe(
    loaded.workspace.activityRead,
  )
  assert(failed.model.page).toBe(loaded.page)
  const textarea = document.createElement('textarea')
  textarea.value = 'DOM-only dictation'
  document.body.append(textarea)
  textarea.focus()
  textarea.setSelectionRange(4, 4)
  const browserOpen = vi.spyOn(window, 'open').mockReturnValue(null)
  try {
    await Effect.runPromise(OpenBrowserNotice({ href }).effect)
    assert(browserOpen).toHaveBeenCalledExactlyOnceWith(
      href,
      '_blank',
      'noopener',
    )
    assert(textarea.value).toBe('DOM-only dictation')
    assert(textarea.selectionStart).toBe(4)
    assert(document.activeElement).toBe(textarea)
  } finally {
    browserOpen.mockRestore()
    textarea.remove()
  }
})
