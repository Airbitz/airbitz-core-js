// @flow

import { base64 } from 'rfc4648'

import {
  type CreateLoginPayload,
  type LoginRequestPayload
} from '../../types/server-types.js'
import {
  type EdgeAccountOptions,
  type EdgeWalletInfo,
  errorNames
} from '../../types/types.js'
import { encrypt } from '../../util/crypto/crypto.js'
import { type ApiInput } from '../root-pixie.js'
import { makeKeysKit } from './keys.js'
import { loginFetch } from './login-fetch.js'
import { fixUsername, hashUsername } from './login-selectors.js'
import { saveStash } from './login-stash.js'
import { type LoginKit, type LoginTree } from './login-types.js'
import { makePasswordKit } from './password.js'
import { makeChangePin2Kit } from './pin2.js'

export type LoginCreateOpts = {
  keyInfo?: EdgeWalletInfo,
  password?: string | void,
  pin?: string | void
}

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable(
  ai: ApiInput,
  username: string
): Promise<boolean> {
  return hashUsername(ai, username).then(userId => {
    const request = {
      userId: base64.stringify(userId)
    }
    return loginFetch(ai, 'POST', '/v2/login', request)
      .then(reply => false) // It's not available if we can hit it!
      .catch(e => {
        if (e.name !== errorNames.UsernameError) throw e
        return true
      })
  })
}

/**
 * Assembles all the data needed to create a new login.
 */
export function makeCreateKit(
  ai: ApiInput,
  parentLogin?: LoginTree,
  appId: string,
  username: string,
  opts: LoginCreateOpts
): Promise<LoginKit> {
  const { io } = ai.props

  // Figure out login identity:
  const loginId =
    parentLogin != null ? io.random(32) : hashUsername(ai, username)
  const loginKey = io.random(32)
  const loginAuth = io.random(32)
  const loginAuthBox = encrypt(io, loginAuth, loginKey)

  const dummyLogin: LoginTree = {
    appId,
    lastLogin: new Date(),
    loginId: '',
    loginKey,
    pendingVouchers: [],
    children: [],
    keyInfos: []
  }

  // Set up login methods:
  const parentBox =
    parentLogin != null
      ? encrypt(io, loginKey, parentLogin.loginKey)
      : undefined
  const passwordKit =
    opts.password != null
      ? makePasswordKit(ai, dummyLogin, username, opts.password)
      : {}
  const pin2Kit =
    opts.pin != null
      ? makeChangePin2Kit(ai, dummyLogin, username, opts.pin, true)
      : {}
  const keysKit =
    opts.keyInfo != null ? makeKeysKit(ai, dummyLogin, opts.keyInfo) : {}

  // Bundle everything:
  return Promise.all([loginId, passwordKit]).then(values => {
    const [loginIdRaw, passwordKit] = values
    const loginId = base64.stringify(loginIdRaw)
    const passwordServer: LoginRequestPayload | void = passwordKit.server
    const pin2Server: LoginRequestPayload | void = pin2Kit.server
    const keysServer: LoginRequestPayload | void = keysKit.server

    const server: CreateLoginPayload = {
      appId,
      loginAuth,
      loginAuthBox,
      loginId,
      parentBox,
      ...passwordServer,
      ...pin2Server,
      ...keysServer
    }
    return {
      loginId,
      serverPath: '/v2/login/create',
      server,
      stash: {
        appId,
        loginAuthBox,
        loginId,
        parentBox,
        ...passwordKit.stash,
        ...pin2Kit.stash,
        ...keysKit.stash
      },
      login: {
        appId,
        loginAuth,
        loginId,
        loginKey,
        keyInfos: [],
        ...passwordKit.login,
        ...pin2Kit.login,
        ...keysKit.login
      }
    }
  })
}

/**
 * Creates a new login on the auth server.
 */
export async function createLogin(
  ai: ApiInput,
  username: string,
  accountOpts: EdgeAccountOptions,
  opts: LoginCreateOpts
): Promise<LoginTree> {
  const fixedName = fixUsername(username)
  const { now = new Date() } = accountOpts

  const kit = await makeCreateKit(ai, undefined, '', fixedName, opts)
  kit.login.username = fixedName
  kit.stash.username = fixedName
  kit.login.userId = kit.login.loginId

  const request = {}
  request.data = kit.server
  await loginFetch(ai, 'POST', kit.serverPath, request)

  kit.stash.lastLogin = now
  await saveStash(ai, kit.stash)
  return kit.login
}
