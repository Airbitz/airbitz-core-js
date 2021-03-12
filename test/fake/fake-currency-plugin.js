// @flow

import { add, lt } from 'biggystring'

import {
  type EdgeCreatePrivateKeyOptions,
  type EdgeCurrencyCodeOptions,
  type EdgeCurrencyEngine,
  type EdgeCurrencyEngineCallbacks,
  type EdgeCurrencyEngineOptions,
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
  type EdgeDataDump,
  type EdgeFreshAddress,
  type EdgeGetTransactionsOptions,
  type EdgeParsedUri,
  type EdgeSpendInfo,
  type EdgeTokenInfo,
  type EdgeTransaction,
  type EdgeWalletInfo,
  type JsonObject,
  InsufficientFundsError
} from '../../src/index.js'
import { compare } from '../../src/util/compare.js'

const GENESIS_BLOCK = 1231006505000

export const fakeCurrencyInfo: EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: 'FAKE',
  displayName: 'Fake Coin',
  pluginId: 'fakecoin',
  denominations: [
    { multiplier: '10', name: 'SMALL' },
    { multiplier: '100', name: 'FAKE' }
  ],
  walletType: 'wallet:fakecoin',

  // Configuration options:
  defaultSettings: {},
  metaTokens: [
    {
      currencyCode: 'TOKEN',
      currencyName: 'Fake Token',
      denominations: [{ multiplier: '1000', name: 'TOKEN' }]
    }
  ],

  // Explorers:
  addressExplorer: 'https://edge.app',
  transactionExplorer: 'https://edge.app'
}

const nop: Function = () => {}

type State = {
  balance: number,
  tokenBalance: number,
  blockHeight: number,
  progress: number,
  txs: { [txid: string]: EdgeTransaction }
}

/**
 * Currency plugin transaction engine.
 */
class FakeCurrencyEngine {
  callbacks: EdgeCurrencyEngineCallbacks
  state: State

  constructor(walletInfo: EdgeWalletInfo, opts: EdgeCurrencyEngineOptions) {
    this.callbacks = opts.callbacks
    this.state = {
      balance: 0,
      tokenBalance: 0,
      blockHeight: 0,
      progress: 0,
      txs: {}
    }
    // Fire initial callbacks:
    this._updateState(this.state)
  }

  _updateState(settings: State): void {
    const state = this.state
    const {
      onAddressesChecked = nop,
      onBalanceChanged = nop,
      onBlockHeightChanged = nop,
      onTransactionsChanged = nop
    } = this.callbacks

    // Address callback:
    if (typeof settings.progress === 'number') {
      state.progress = settings.progress
      onAddressesChecked(state.progress)
    }

    // Balance callback:
    if (typeof settings.balance === 'number') {
      state.balance = settings.balance
      onBalanceChanged('FAKE', state.balance.toString())
    }

    // Token balance callback:
    if (typeof settings.tokenBalance === 'number') {
      state.tokenBalance = settings.tokenBalance
      onBalanceChanged('TOKEN', state.tokenBalance.toString())
    }

    // Block height callback:
    if (typeof settings.blockHeight === 'number') {
      state.blockHeight = settings.blockHeight
      onBlockHeightChanged(state.blockHeight)
    }

    // Transactions callback:
    if (typeof settings.txs === 'object' && settings.txs != null) {
      const changes: EdgeTransaction[] = []
      for (const txid in settings.txs) {
        const newTx: EdgeTransaction = {
          blockHeight: 0,
          date: GENESIS_BLOCK,
          nativeAmount: '0',
          networkFee: '0',
          ourReceiveAddresses: [],
          ...settings.txs[txid],
          txid
        }
        const oldTx = state.txs[txid]

        if (oldTx == null || !compare(oldTx, newTx)) {
          changes.push(newTx)
          state.txs[txid] = newTx
        }
      }

      if (changes.length > 0) onTransactionsChanged(changes)
    }
  }

  async changeUserSettings(settings: JsonObject): Promise<void> {
    await this._updateState(settings)
  }

  // Keys:
  getDisplayPrivateSeed(): string | null {
    return 'xpriv'
  }

  getDisplayPublicSeed(): string | null {
    return 'xpub'
  }

  // Engine state
  startEngine(): Promise<void> {
    return Promise.resolve()
  }

  killEngine(): Promise<void> {
    return Promise.resolve()
  }

  resyncBlockchain(): Promise<void> {
    return Promise.resolve()
  }

  dumpData(): Promise<EdgeDataDump> {
    return {
      walletId: 'xxx',
      walletType: fakeCurrencyInfo.walletType,
      data: {}
    }
  }

  // Chain state
  getBlockHeight(): number {
    return this.state.blockHeight
  }

  getBalance(opts: EdgeCurrencyCodeOptions): string {
    const { currencyCode = 'FAKE' } = opts
    switch (currencyCode) {
      case 'FAKE':
        return this.state.balance.toString()
      case 'TOKEN':
        return this.state.tokenBalance.toString()
      default:
        throw new Error('Unknown currency')
    }
  }

  getNumTransactions(opts: EdgeCurrencyCodeOptions): number {
    return Object.keys(this.state.txs).length
  }

  getTransactions(
    opts: EdgeGetTransactionsOptions
  ): Promise<EdgeTransaction[]> {
    return Promise.resolve(
      Object.keys(this.state.txs).map(txid => this.state.txs[txid])
    )
  }

  // Tokens
  enableTokens(tokens: string[]): Promise<void> {
    return Promise.resolve()
  }

  disableTokens(tokens: string[]): Promise<void> {
    return Promise.resolve()
  }

  getEnabledTokens(): Promise<string[]> {
    return Promise.resolve(['TOKEN'])
  }

  addCustomToken(token: EdgeTokenInfo): Promise<void> {
    return Promise.resolve()
  }

  getTokenStatus(token: string): boolean {
    return token === 'TOKEN'
  }

  // Addresses:
  getFreshAddress(opts: EdgeCurrencyCodeOptions): EdgeFreshAddress {
    return { publicAddress: 'fakeaddress' }
  }

  addGapLimitAddresses(addresses: string[]): void {}

  isAddressUsed(address: string): boolean {
    return address === 'fakeaddress'
  }

  // Spending:
  makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
    const { currencyCode = 'FAKE', spendTargets } = spendInfo

    // Check the spend targets:
    let total = '0'
    for (const spendTarget of spendTargets) {
      if (spendTarget.nativeAmount != null) {
        total = add(total, spendTarget.nativeAmount)
      }
    }

    // Check the balances:
    if (lt(this.getBalance({ currencyCode }), total)) {
      return Promise.reject(new InsufficientFundsError())
    }

    // TODO: Return a high-fidelity transaction
    return Promise.resolve({
      blockHeight: 0,
      currencyCode,
      date: GENESIS_BLOCK,
      nativeAmount: total,
      networkFee: '0',
      feeRateUsed: { fakePrice: 0 },
      otherParams: {},
      ourReceiveAddresses: [],
      signedTx: '',
      txid: 'spend'
    })
  }

  signTx(transaction: EdgeTransaction): Promise<EdgeTransaction> {
    transaction.txSecret = 'open sesame'
    return Promise.resolve(transaction)
  }

  broadcastTx(transaction: EdgeTransaction): Promise<EdgeTransaction> {
    return Promise.resolve(transaction)
  }

  saveTx(transaction: EdgeTransaction): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * Currency plugin setup object.
 */
class FakeCurrencyTools {
  // Keys:
  createPrivateKey(
    walletType: string,
    opts?: EdgeCreatePrivateKeyOptions
  ): Promise<JsonObject> {
    if (walletType !== fakeCurrencyInfo.walletType) {
      throw new Error('Unsupported key type')
    }
    return Promise.resolve({ fakeKey: 'FakePrivateKey' })
  }

  derivePublicKey(walletInfo: EdgeWalletInfo): Promise<JsonObject> {
    return Promise.resolve({
      fakeAddress: 'FakePublicAddress'
    })
  }

  getSplittableTypes(walletInfo: EdgeWalletInfo): string[] {
    return ['wallet:tulipcoin']
  }

  // URI parsing:
  parseUri(uri: string): Promise<EdgeParsedUri> {
    return Promise.resolve({})
  }

  encodeUri(): Promise<string> {
    return Promise.resolve('')
  }
}

export const fakeCurrencyPlugin: EdgeCurrencyPlugin = {
  currencyInfo: fakeCurrencyInfo,

  makeCurrencyEngine(
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine> {
    return Promise.resolve(new FakeCurrencyEngine(walletInfo, opts))
  },

  makeCurrencyTools(): Promise<EdgeCurrencyTools> {
    return Promise.resolve(new FakeCurrencyTools())
  }
}
