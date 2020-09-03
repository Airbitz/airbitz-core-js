/**
 * Functions for working with login data in its on-disk format.
 */

import { base64 } from 'rfc4648'

import { EdgeAccountOptions, EdgeWalletInfo } from '../../types/types'
import { decrypt, decryptText } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { filterObject, softCat } from '../../util/util'
import { ApiInput } from '../root-pixie'
import {
  fixWalletInfo,
  makeAccountType,
  makeKeyInfo,
  mergeKeyInfos
} from './keys'
import { loginFetch } from './login-fetch'
import { asLoginReply, LoginReply } from './login-reply'
import { getStash } from './login-selectors'
import { LoginStash, saveStash } from './login-stash'
import { LoginKit, LoginRequest, LoginTree } from './login-types'
import { getLoginOtp, getStashOtp } from './otp'

function cloneNode<Node extends {}, Output>(
  node: Node,
  children: Output[] | undefined
): Output {
  const out: any = { ...node, children }
  return out
}

/**
 * Returns the login that satisfies the given predicate,
 * or undefined if nothing matches.
 */
export function searchTree<T>(
  node: T,
  predicate: (node: T) => boolean
): T | undefined {
  if (predicate(node)) return node

  const flowHack: any = node
  if (flowHack.children != null) {
    for (const child of flowHack.children) {
      const out = searchTree(child, predicate)
      if (out != null) return out
    }
  }
}

/**
 * Replaces a node within a tree.
 * The `clone` callback is called for each unmodified node.
 * The `predicate` callback is used to find the target node.
 * The `update` callback is called on the target.
 */
function updateTree<Node extends { readonly children?: any[] }, Output>(
  node: Node,
  predicate: (node: Node) => boolean,
  update: (node: Node) => Output,
  clone: (node: Node, children: Output[] | undefined) => Output = cloneNode
): Output {
  if (predicate(node)) return update(node)

  const children: Output[] =
    node.children != null
      ? node.children.map(child => updateTree(child, predicate, update, clone))
      : []

  return clone(node, children)
}

function applyLoginReplyInner(
  stash: LoginStash,
  loginKey: Uint8Array,
  loginReply: LoginReply
): LoginStash {
  // Copy common items:
  const out: LoginStash = filterObject(loginReply, [
    'appId',
    'created',
    'loginId',
    'loginAuthBox',
    'userId',
    'otpKey',
    'otpResetDate',
    'otpTimeout',
    'parentBox',
    'passwordAuthBox',
    'passwordAuthSnrp',
    'passwordBox',
    'passwordKeySnrp',
    'pin2TextBox',
    'mnemonicBox',
    'rootKeyBox',
    'syncKeyBox'
  ])

  // Preserve client-only data:
  if (stash.lastLogin != null) out.lastLogin = stash.lastLogin
  if (stash.username != null) out.username = stash.username
  if (stash.userId != null) out.userId = stash.userId

  // Store the pin key unencrypted:
  if (loginReply.pin2KeyBox != null) {
    const pin2Key = decrypt(loginReply.pin2KeyBox, loginKey)
    out.pin2Key = base64.stringify(pin2Key)
  }

  // Store the recovery key unencrypted:
  if (loginReply.recovery2KeyBox != null) {
    const recovery2Key = decrypt(loginReply.recovery2KeyBox, loginKey)
    out.recovery2Key = base64.stringify(recovery2Key)
  }

  // Keys (we could be more picky about this):
  out.keyBoxes = loginReply.keyBoxes != null ? loginReply.keyBoxes : []

  // Recurse into children:
  const stashChildren = stash.children != null ? stash.children : []
  const replyChildren = loginReply.children != null ? loginReply.children : []
  if (stashChildren.length > replyChildren.length) {
    throw new Error('The server has lost children!')
  }
  out.children = replyChildren.map((child, index) => {
    if (!child.parentBox) {
      throw new Error('Key integrity violation: No parentBox on child login.')
    }
    const childKey = decrypt(child.parentBox, loginKey)
    const childStash =
      stashChildren[index] != null
        ? stashChildren[index]
        : { appId: child.appId, loginId: child.loginId }
    return applyLoginReplyInner(childStash, childKey, child)
  })

  return out
}

/**
 * Updates the given login stash object with fields from the auth server.
 * TODO: We don't trust the auth server 100%, so be picky about what we copy.
 */
export function applyLoginReply(
  stashTree: LoginStash,
  loginKey: Uint8Array,
  loginReply: LoginReply
): LoginStash {
  return updateTree(
    stashTree,
    stash => stash.appId === loginReply.appId,
    stash => applyLoginReplyInner(stash, loginKey, loginReply)
  )
}

function makeLoginTreeInner(
  stash: LoginStash,
  loginKey: Uint8Array
): LoginTree {
  const {
    appId,
    created,
    lastLogin = new Date(),
    loginId,
    otpKey,
    otpResetDate,
    otpTimeout,
    userId,
    username,
    children: stashChildren = [],
    keyBoxes = []
  } = stash

  const login: LoginTree = {
    appId,
    created,
    lastLogin,
    loginId,
    otpKey,
    otpResetDate,
    otpTimeout,
    userId,
    username,
    loginKey,
    children: [],
    keyInfos: []
  }

  // Server authentication:
  if (stash.loginAuthBox != null) {
    login.loginAuth = decrypt(stash.loginAuthBox, loginKey)
  }
  if (stash.passwordAuthBox != null) {
    if (login.userId == null) login.userId = loginId
    login.passwordAuth = decrypt(stash.passwordAuthBox, loginKey)
  }
  if (login.loginAuth == null && login.passwordAuth == null) {
    throw new Error('No server authentication methods on login')
  }

  // PIN v2:
  if (stash.pin2Key != null) {
    login.pin2Key = base64.parse(stash.pin2Key)
  }
  if (stash.pin2TextBox != null) {
    login.pin = decryptText(stash.pin2TextBox, loginKey)
  }

  // Recovery v2:
  if (stash.recovery2Key != null) {
    login.recovery2Key = base64.parse(stash.recovery2Key)
  }

  const legacyKeys: EdgeWalletInfo[] = []

  // BitID wallet:
  const { mnemonicBox, rootKeyBox } = stash
  if (mnemonicBox != null && rootKeyBox != null) {
    const rootKey = decrypt(rootKeyBox, loginKey)
    const infoKey = hmacSha256(rootKey, utf8.parse('infoKey'))
    const keys = {
      mnemonic: decryptText(mnemonicBox, infoKey),
      rootKey: base64.stringify(rootKey)
    }
    legacyKeys.push(makeKeyInfo('wallet:bitid', keys, rootKey))
  }

  // Account settings:
  if (stash.syncKeyBox != null) {
    const syncKey = decrypt(stash.syncKeyBox, loginKey)
    const type = makeAccountType(login.appId)
    const keys = {
      syncKey: base64.stringify(syncKey),
      dataKey: base64.stringify(loginKey)
    }
    legacyKeys.push(makeKeyInfo(type, keys, loginKey))
  }

  // Keys:
  const keyInfos = keyBoxes.map(box => JSON.parse(decryptText(box, loginKey)))
  login.keyInfos = mergeKeyInfos([...legacyKeys, ...keyInfos]).map(walletInfo =>
    fixWalletInfo(walletInfo)
  )

  // Recurse into children:
  login.children = stashChildren.map(child => {
    if (!child.parentBox) {
      throw new Error('Key integrity violation: No parentBox on child login.')
    }
    const childKey = decrypt(child.parentBox, loginKey)
    return makeLoginTreeInner(child, childKey)
  })

  return login
}

/**
 * Converts a login stash into an in-memory login object.
 */
export function makeLoginTree(
  stashTree: LoginStash,
  loginKey: Uint8Array,
  appId: string = ''
): LoginTree {
  return updateTree(
    stashTree,
    stash => stash.appId === appId,
    stash => makeLoginTreeInner(stash, loginKey),
    (stash, children) => {
      const login: LoginTree = filterObject(stash, [
        'username',
        'appId',
        'loginId'
      ])
      login.children = children != null ? children : []
      return login
    }
  )
}

/**
 * Prepares a login stash for edge login,
 * stripping out any information that the target app is not allowed to see.
 */
export function sanitizeLoginStash(
  stashTree: LoginStash,
  appId: string
): LoginStash {
  return updateTree(
    stashTree,
    stash => stash.appId === appId,
    stash => stash,
    (stash, children) => {
      const login: LoginStash = filterObject(stash, [
        'username',
        'appId',
        'loginId'
      ])
      login.children = children
      return login
    }
  )
}

/**
 * Logs a user in, using the auth server to retrieve information.
 * The various login methods (password / PIN / recovery, etc.) share
 * common logic, which all lives in here.
 *
 * The things tha differ between the methods are the server payloads
 * and the decryption steps, so this function accepts those two things
 * as parameters, plus the ordinary login options.
 */
export async function serverLogin(
  ai: ApiInput,
  stashTree: LoginStash,
  stash: LoginStash,
  opts: EdgeAccountOptions,
  serverAuth: LoginRequest,
  decrypt: (reply: LoginReply) => Promise<Uint8Array>
): Promise<LoginTree> {
  const { now = new Date() } = opts
  const { deviceDescription } = ai.props.state.login

  const request: LoginRequest = {
    otp: getStashOtp(stash, opts),
    voucherId: stash.voucherId,
    voucherAuth: stash.voucherAuth,
    ...serverAuth
  }
  if (deviceDescription != null) request.deviceDescription = deviceDescription

  const loginReply = asLoginReply(
    await loginFetch(ai, 'POST', '/v2/login', request).catch(error => {
      // Save the username / voucher if we get an OTP error:
      if (
        error.name === 'OtpError' &&
        error.loginId != null &&
        // We have never seen this user before:
        (stash.loginId === '' ||
          // We got a voucher:
          (error.voucherId != null && error.voucherAuth != null))
      ) {
        stash.loginId = error.loginId
        stash.voucherId = error.voucherId
        stash.voucherAuth = error.voucherAuth
        stashTree.lastLogin = now
        saveStash(ai, stashTree).catch(() => undefined)
      }
      throw error
    })
  )

  // Try decrypting the reply:
  const loginKey = await decrypt(loginReply)

  // Save the latest data:
  stashTree = applyLoginReply(stashTree, loginKey, loginReply)
  stashTree.lastLogin = now
  await saveStash(ai, stashTree)
  return makeLoginTree(stashTree, loginKey, stash.appId)
}

/**
 * Changing a login involves updating the server, the in-memory login,
 * and the on-disk stash. A login kit contains all three elements,
 * and this function knows how to apply them all.
 */
export function applyKit(
  ai: ApiInput,
  loginTree: LoginTree,
  kit: LoginKit
): Promise<LoginTree> {
  const { loginId, serverMethod = 'POST', serverPath } = kit
  const login = searchTree(loginTree, login => login.loginId === loginId)
  if (!login) throw new Error('Cannot apply kit: missing login')
  if (!loginTree.username) throw new Error('Cannot apply kit: missing username')

  const stashTree = getStash(ai, loginTree.username)
  const request = makeAuthJson(login)
  request.data = kit.server
  return loginFetch(ai, serverMethod, serverPath, request).then(reply => {
    const newLoginTree = updateTree(
      loginTree,
      login => login.loginId === loginId,
      login => ({
        ...login,
        ...kit.login,
        children: softCat(login.children, kit.login.children),
        keyInfos: mergeKeyInfos(softCat(login.keyInfos, kit.login.keyInfos))
      })
    )

    const newStashTree = updateTree(
      stashTree,
      stash => stash.loginId === loginId,
      stash => ({
        ...stash,
        ...kit.stash,
        children: softCat(stash.children, kit.stash.children),
        keyBoxes: softCat(stash.keyBoxes, kit.stash.keyBoxes)
      })
    )

    return saveStash(ai, newStashTree).then(() => newLoginTree)
  })
}

/**
 * Applies an array of kits to a login, one after another.
 * We can't use `Promise.all`, since `applyKit` doesn't handle
 * parallelism correctly.
 */
export function applyKits(
  ai: ApiInput,
  loginTree: LoginTree,
  kits: LoginKit[]
): Promise<void> {
  if (!kits.length) return Promise.resolve()

  const [first, ...rest] = kits
  return applyKit(ai, loginTree, first).then(loginTree =>
    applyKits(ai, loginTree, rest)
  )
}

export async function syncAccount(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  if (ai.props.state.accounts[accountId] == null) return
  const { login, loginTree } = ai.props.state.accounts[accountId]
  await syncLogin(ai, loginTree, login)
}

/**
 * Refreshes a login with data from the server.
 */
export function syncLogin(
  ai: ApiInput,
  loginTree: LoginTree,
  login: LoginTree
): Promise<LoginTree> {
  if (!loginTree.username) throw new Error('Cannot sync: missing username')

  const stashTree = getStash(ai, loginTree.username)
  const request = makeAuthJson(login)
  return loginFetch(ai, 'POST', '/v2/login', request).then(reply => {
    const newStashTree = applyLoginReply(stashTree, login.loginKey, reply)
    const newLoginTree = makeLoginTree(
      newStashTree,
      login.loginKey,
      login.appId
    )

    return saveStash(ai, newStashTree).then(() => newLoginTree)
  })
}

/**
 * Sets up a login v2 server authorization JSON.
 */
export function makeAuthJson(login: LoginTree): LoginRequest {
  if (login.loginAuth != null) {
    return {
      loginId: login.loginId,
      loginAuth: base64.stringify(login.loginAuth),
      otp: getLoginOtp(login)
    }
  }
  if (login.passwordAuth != null) {
    return {
      userId: login.userId,
      passwordAuth: base64.stringify(login.passwordAuth),
      otp: getLoginOtp(login)
    }
  }
  throw new Error('No server authentication methods available')
}
