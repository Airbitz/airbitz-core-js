// @flow

import { makeReactNativeDisklet } from 'disklet'
import * as React from 'react'

import { defaultOnLog } from './core/log/log.js'
import { parseReply } from './core/login/login-fetch.js'
import { EdgeCoreBridge } from './io/react-native/react-native-webview.js'
import { asMessagesPayload } from './types/server-cleaners.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFetchOptions,
  type EdgeLoginMessages,
  type EdgeNativeIo,
  type EdgeOnLog,
  NetworkError
} from './types/types.js'
import { timeout } from './util/promise.js'

export { makeFakeIo } from './core/fake/fake-io.js'
export * from './types/types.js'

function onErrorDefault(e: any): void {
  console.error(e)
}

export function MakeEdgeContext(props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (context: EdgeContext) => mixed,
  onLog?: EdgeOnLog,
  options: EdgeContextOptions
}): React.Node {
  const {
    debug,
    nativeIo,
    onError = onErrorDefault,
    onLoad,
    onLog = defaultOnLog
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeEdgeContext')
  }

  return (
    <EdgeCoreBridge
      debug={debug}
      nativeIo={nativeIo}
      onError={onError}
      onLoad={(nativeIo, root) =>
        root.makeEdgeContext(nativeIo, props.options).then(onLoad)
      }
      onLog={onLog}
    />
  )
}

export function MakeFakeEdgeWorld(props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (world: EdgeFakeWorld) => mixed,
  onLog?: EdgeOnLog,
  users?: EdgeFakeUser[]
}): React.Node {
  const {
    debug,
    nativeIo,
    onError = onErrorDefault,
    onLoad,
    onLog = defaultOnLog
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeFakeEdgeWorld')
  }

  return (
    <EdgeCoreBridge
      debug={debug}
      nativeIo={nativeIo}
      onError={onError}
      onLoad={(nativeIo, root) =>
        root.makeFakeEdgeWorld(nativeIo, props.users).then(onLoad)
      }
      onLog={onLog}
    />
  )
}

/**
 * Fetches any login-related messages for all the users on this device.
 */
export async function fetchLoginMessages(
  apiKey: string
): Promise<EdgeLoginMessages> {
  const disklet = makeReactNativeDisklet()

  // Load the login stashes from disk:
  const loginMap: { [loginId: string]: string } = {} // loginId -> username
  const listing = await disklet.list('logins')
  const files: string[] = await Promise.all(
    Object.keys(listing)
      .filter(path => listing[path] === 'file')
      .map(path => disklet.getText(path).catch(() => '{}'))
  )
  for (const text of files) {
    try {
      const { username, loginId } = JSON.parse(text)
      if (loginId == null || username == null) continue
      loginMap[loginId] = username
    } catch (e) {}
  }

  const uri = 'https://auth.airbitz.co/api/v2/messages'
  const opts: EdgeFetchOptions = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Token ${apiKey}`
    },
    body: JSON.stringify({ loginIds: Object.keys(loginMap) })
  }

  return timeout(
    window.fetch(uri, opts),
    30000,
    new NetworkError('Could not reach the auth server: timeout')
  ).then(response => {
    if (!response.ok) {
      throw new Error(`${uri} return status code ${response.status}`)
    }

    return response.json().then(json => {
      const clean = asMessagesPayload(parseReply(json))
      const out: EdgeLoginMessages = {}
      for (const message of clean) {
        const username = loginMap[message.loginId]
        if (username != null) out[username] = message
      }
      return out
    })
  })
}
