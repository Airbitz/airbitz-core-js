// @flow

import {
  type EdgeWalletInfo,
  type EdgeWalletInfoFull
} from '../../types/types.js'
import { type EdgeBox } from '../../util/crypto/crypto.js'
import { type EdgeSnrp } from '../scrypt/scrypt-pixie.js'
import { type LoginStash } from './login-stash.js'

/**
 * Data sent back by the auth server.
 */
export type LoginReply = {
  appId: string,
  loginAuthBox?: EdgeBox,
  loginId: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: string,
  otpTimeout?: number,

  // Offline password logins:
  passwordAuthBox?: EdgeBox,
  passwordAuthSnrp?: EdgeSnrp,
  passwordBox?: EdgeBox,
  passwordKeySnrp?: EdgeSnrp,

  // PIN login:
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox?: EdgeBox,

  // Recovery login:
  question2Box?: EdgeBox,
  recovery2Box?: EdgeBox,
  recovery2KeyBox?: EdgeBox,

  // Resources:
  children?: LoginReply[],
  keyBoxes?: EdgeBox[],
  mnemonicBox?: EdgeBox,
  parentBox?: EdgeBox,
  rootKeyBox?: EdgeBox,
  syncKeyBox?: EdgeBox
}

// Login data decrypted into memory.
export type LoginTree = {
  appId: string,
  loginAuth?: Uint8Array,
  loginId: string,
  loginKey: Uint8Array,
  userId: string,
  username?: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: string,
  otpTimeout?: number,

  // Login methods:
  passwordAuth?: Uint8Array,
  pin?: string,
  pin2Key?: Uint8Array,
  recovery2Key?: Uint8Array,

  // Resources:
  keyInfos: EdgeWalletInfo[],
  children: LoginTree[]
}

export type AppIdMap = { [walletId: string]: string[] }

export type LoginKit = {
  loginId: string,
  login: any,
  server?: any,
  serverMethod?: string,
  serverPath: string,
  stash: $Shape<LoginStash>
}

export type WalletInfoFullMap = { [walletId: string]: EdgeWalletInfoFull }
