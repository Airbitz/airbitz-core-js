import { base32, base64 } from 'rfc4648'

import { EdgeAccountOptions } from '../../types/types'
import { fixOtpKey, totp } from '../../util/crypto/hotp'
import { applyKit } from '../login/login'
import { ApiInput } from '../root-pixie'
import { loginFetch } from './login-fetch'
import { hashUsername } from './login-selectors'
import { LoginStash } from './login-stash'
import { LoginKit, LoginTree } from './login-types'

/**
 * Gets the current OTP for a logged-in account.
 */
export function getLoginOtp(login: LoginTree): string | undefined {
  if (login.otpKey != null) return totp(login.otpKey)
}

/**
 * Gets the current OTP from either the disk storage or login options.
 */
export function getStashOtp(
  stash: LoginStash,
  opts: EdgeAccountOptions
): string | undefined {
  const { otp, otpKey = stash.otpKey } = opts
  if (otp != null) {
    if (/[0-9]+/.test(otp) && otp.length < 16) return otp
    return totp(otp)
  }
  if (otpKey != null) return totp(otpKey)
}

export async function enableOtp(
  ai: ApiInput,
  accountId: string,
  otpTimeout: number
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const otpKey =
    loginTree.otpKey != null
      ? fixOtpKey(loginTree.otpKey)
      : base32.stringify(ai.props.io.random(10))

  const kit: LoginKit = {
    serverPath: '/v2/login/otp',
    server: {
      otpKey,
      otpTimeout
    },
    stash: {
      otpKey,
      otpResetDate: undefined,
      otpTimeout
    },
    login: {
      otpKey,
      otpResetDate: undefined,
      otpTimeout
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function disableOtp(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/otp',
    stash: {
      otpKey: undefined,
      otpResetDate: undefined,
      otpTimeout: undefined
    },
    login: {
      otpKey: undefined,
      otpResetDate: undefined,
      otpTimeout: undefined
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function cancelOtpReset(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    serverPath: '/v2/login/otp',
    server: {
      otpTimeout: loginTree.otpTimeout,
      otpKey: loginTree.otpKey
    },
    stash: {
      otpResetDate: undefined
    },
    login: {
      otpResetDate: undefined
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

/**
 * Requests an OTP reset.
 */
export async function resetOtp(
  ai: ApiInput,
  username: string,
  resetToken: string
): Promise<Date> {
  const request = {
    userId: base64.stringify(await hashUsername(ai, username)),
    otpResetAuth: resetToken
  }
  return loginFetch(ai, 'DELETE', '/v2/login/otp', request).then(reply => {
    // The server returns dates as ISO 8601 formatted strings:
    return new Date(reply.otpResetDate)
  })
}
