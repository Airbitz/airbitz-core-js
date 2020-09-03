import {
  asArray,
  asDate,
  asNumber,
  asObject,
  asOptional,
  asString,
  Cleaner
} from 'cleaners'

import { asEdgeBox, EdgeBox } from '../../util/crypto/crypto'
import { asEdgeSnrp, EdgeSnrp } from '../scrypt/scrypt-pixie'

/**
 * Data sent back by the auth server.
 */
export interface LoginReply {
  // Identity:
  appId: string
  created?: Date
  loginId: string

  // 2-factor:
  otpKey?: string
  otpResetDate?: Date
  otpTimeout?: number

  // Return logins:
  loginAuthBox?: EdgeBox
  parentBox?: EdgeBox

  // Password login:
  passwordAuthBox?: EdgeBox
  passwordAuthSnrp?: EdgeSnrp
  passwordBox?: EdgeBox
  passwordKeySnrp?: EdgeSnrp

  // PIN v2 login:
  pin2Box?: EdgeBox
  pin2KeyBox?: EdgeBox
  pin2TextBox?: EdgeBox

  // Recovery v2 login:
  question2Box?: EdgeBox
  recovery2Box?: EdgeBox
  recovery2KeyBox?: EdgeBox

  // Resources:
  children?: LoginReply[]
  keyBoxes?: EdgeBox[]
  mnemonicBox?: EdgeBox
  rootKeyBox?: EdgeBox
  syncKeyBox?: EdgeBox
}

export const asLoginReply: Cleaner<LoginReply> = asObject({
  // Identity:
  appId: asString,
  created: asOptional(asDate),
  loginId: asString,

  // 2-factor:
  otpKey: asOptional(asString),
  otpResetDate: asOptional(asDate),
  otpTimeout: asOptional(asNumber),

  // Return logins:
  loginAuthBox: asOptional(asEdgeBox),
  parentBox: asOptional(asEdgeBox),

  // Password login:
  passwordAuthBox: asOptional(asEdgeBox),
  passwordAuthSnrp: asOptional(asEdgeSnrp),
  passwordBox: asOptional(asEdgeBox),
  passwordKeySnrp: asOptional(asEdgeSnrp),

  // PIN v2 login:
  pin2Box: asOptional(asEdgeBox),
  pin2KeyBox: asOptional(asEdgeBox),
  pin2TextBox: asOptional(asEdgeBox),

  // Recovery v2 login:
  question2Box: asOptional(asEdgeBox),
  recovery2Box: asOptional(asEdgeBox),
  recovery2KeyBox: asOptional(asEdgeBox),

  // Keys and assorted goodies:
  children: asOptional(asArray(raw => asLoginReply(raw))),
  keyBoxes: asOptional(asArray(asEdgeBox)),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox)
})
