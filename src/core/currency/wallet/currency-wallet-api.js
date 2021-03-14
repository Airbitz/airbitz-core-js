// @flow

import { add, div, lte, mul, sub } from 'biggystring'
import { type Disklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { CurrencyWalletSync } from '../../../client-side.js'
import {
  type EdgeBalances,
  type EdgeCurrencyCodeOptions,
  type EdgeCurrencyEngine,
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyWallet,
  type EdgeDataDump,
  type EdgeEncodeUri,
  type EdgeGetTransactionsOptions,
  type EdgeMetadata,
  type EdgeParsedUri,
  type EdgePaymentProtocolInfo,
  type EdgeReceiveAddress,
  type EdgeSpendInfo,
  type EdgeSpendTarget,
  type EdgeTokenInfo,
  type EdgeTransaction,
  type EdgeWalletInfo,
  type JsonObject
} from '../../../types/types.js'
import { mergeDeeply } from '../../../util/util.js'
import { getCurrencyTools } from '../../plugins/plugins-selectors.js'
import { type ApiInput } from '../../root-pixie.js'
import { makeStorageWalletApi } from '../../storage/storage-api.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import { makeCurrencyWalletCallbacks } from './currency-wallet-callbacks.js'
import {
  asTxSwap,
  packMetadata,
  unpackMetadata
} from './currency-wallet-cleaners.js'
import {
  dateFilter,
  exportTransactionsToCSVInner,
  exportTransactionsToQBOInner,
  searchStringFilter
} from './currency-wallet-export.js'
import {
  type TransactionFile,
  loadTxFiles,
  renameCurrencyWallet,
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
} from './currency-wallet-files.js'
import { type CurrencyWalletInput } from './currency-wallet-pixie.js'
import { type MergedTransaction } from './currency-wallet-reducer.js'

const fakeMetadata = {
  bizId: 0,
  category: '',
  exchangeAmount: {},
  name: '',
  notes: ''
}

/**
 * Creates an `EdgeCurrencyWallet` API object.
 */
export function makeCurrencyWalletApi(
  input: CurrencyWalletInput,
  plugin: EdgeCurrencyPlugin,
  engine: EdgeCurrencyEngine,
  publicWalletInfo: EdgeWalletInfo
): EdgeCurrencyWallet {
  const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
  const { walletInfo } = input.props.selfState

  const storageWalletApi = makeStorageWalletApi(ai, walletInfo)

  const fakeCallbacks = makeCurrencyWalletCallbacks(input)

  let otherMethods = {}
  if (engine.otherMethods != null) {
    otherMethods = engine.otherMethods
    bridgifyObject(otherMethods)
  }

  function lockdown(): void {
    if (ai.props.state.hideKeys) {
      throw new Error('Not available when `hideKeys` is enabled')
    }
  }

  const out: EdgeCurrencyWallet = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get id(): string {
      return storageWalletApi.id
    },
    get type(): string {
      return storageWalletApi.type
    },
    get keys(): JsonObject {
      lockdown()
      return storageWalletApi.keys
    },
    publicWalletInfo,
    get disklet(): Disklet {
      return storageWalletApi.disklet
    },
    get localDisklet(): Disklet {
      return storageWalletApi.localDisklet
    },
    async sync(): Promise<void> {
      await storageWalletApi.sync()
    },

    // Wallet keys:
    get displayPrivateSeed(): string | null {
      lockdown()
      return input.props.selfState.displayPrivateSeed
    },
    get displayPublicSeed(): string | null {
      return input.props.selfState.displayPublicSeed
    },

    // Wallet name:
    get name(): string | null {
      return input.props.selfState.name
    },
    async renameWallet(name: string): Promise<void> {
      await renameCurrencyWallet(input, name)
    },

    // Currency info:
    get currencyInfo(): EdgeCurrencyInfo {
      return plugin.currencyInfo
    },
    async nativeToDenomination(
      nativeAmount: string,
      currencyCode: string
    ): Promise<string> {
      const multiplier = getCurrencyMultiplier(
        input.props.state.currency.infos,
        input.props.state.currency.customTokens,
        currencyCode
      )
      return div(nativeAmount, multiplier, multiplier.length)
    },
    async denominationToNative(
      denominatedAmount: string,
      currencyCode: string
    ): Promise<string> {
      const multiplier = getCurrencyMultiplier(
        input.props.state.currency.infos,
        input.props.state.currency.customTokens,
        currencyCode
      )
      return mul(denominatedAmount, multiplier)
    },

    // Fiat currency option:
    get fiatCurrencyCode(): string {
      return input.props.selfState.fiat
    },
    async setFiatCurrencyCode(fiatCurrencyCode: string): Promise<void> {
      await setCurrencyWalletFiat(input, fiatCurrencyCode)
    },

    // Chain state:
    get balances(): EdgeBalances {
      return input.props.selfState.balances
    },

    get blockHeight(): number {
      return input.props.selfState.height
    },

    get syncRatio(): number {
      return input.props.selfState.syncRatio
    },

    // Running state:
    async startEngine(): Promise<void> {
      await engine.startEngine()
    },

    async stopEngine(): Promise<void> {
      await engine.killEngine()
    },

    // Tokens:
    async changeEnabledTokens(currencyCodes: string[]): Promise<void> {
      const enabled = await engine.getEnabledTokens()
      await engine.disableTokens(
        enabled.filter(currencyCode => currencyCodes.indexOf(currencyCode) < 0)
      )
      await engine.enableTokens(
        currencyCodes.filter(currencyCode => enabled.indexOf(currencyCode) < 0)
      )
    },

    async enableTokens(tokens: string[]): Promise<void> {
      await engine.enableTokens(tokens)
    },

    async disableTokens(tokens: string[]): Promise<void> {
      await engine.disableTokens(tokens)
    },

    async getEnabledTokens(): Promise<string[]> {
      return engine.getEnabledTokens()
    },

    async addCustomToken(tokenInfo: EdgeTokenInfo): Promise<void> {
      ai.props.dispatch({ type: 'ADDED_CUSTOM_TOKEN', payload: tokenInfo })
      await engine.addCustomToken(tokenInfo)
    },

    // Transactions:
    async getNumTransactions(
      opts: EdgeCurrencyCodeOptions = {}
    ): Promise<number> {
      return engine.getNumTransactions(opts)
    },

    async getTransactions(
      opts: EdgeGetTransactionsOptions = {}
    ): Promise<EdgeTransaction[]> {
      const defaultCurrency = plugin.currencyInfo.currencyCode
      const currencyCode = opts.currencyCode || defaultCurrency

      let state = input.props.selfState
      if (!state.gotTxs[currencyCode]) {
        const txs = await engine.getTransactions(opts)
        fakeCallbacks.onTransactionsChanged(txs)
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_GOT_TXS',
          payload: {
            walletId: input.props.id,
            currencyCode
          }
        })
        state = input.props.selfState
      }

      // Txid array of all txs
      const txids = state.txids
      // Merged tx data from metadata files and blockchain data
      const txs = state.txs
      const { startIndex = 0, startEntries = txids.length } = opts
      // Decrypted metadata files
      const files = state.files
      // A sorted list of transaction based on chronological order
      // these are tx id hashes merged between blockchain and cache some tx id hashes
      // some may have been dropped by the blockchain
      const sortedTransactions = state.sortedTransactions.sortedList
      // create map of tx id hashes to their order (cardinality)
      const mappedUnfilteredIndexes = {}
      sortedTransactions.forEach((item, index) => {
        mappedUnfilteredIndexes[item] = index
      })
      // we need to make sure that after slicing, the total txs number is equal to opts.startEntries
      // slice, verify txs in files, if some are dropped and missing, do it again recursively
      let searchedTxs = 0
      let counter = 0
      const out: EdgeTransaction[] = []
      while (searchedTxs < startEntries) {
        // take a slice from sorted transactions that begins at current index and goes until however many are left
        const slicedTransactions = sortedTransactions.slice(
          startIndex + startEntries * counter,
          startIndex + startEntries * (counter + 1)
        )

        // break loop if slicing starts beyond length of array
        if (slicedTransactions.length === 0) break

        // filter the transactions
        const missingTxIdHashes = slicedTransactions.filter(txidHash => {
          // remove any that do not have a file
          return !files[txidHash]
        })
        // load files into state
        const missingFiles = await loadTxFiles(input, missingTxIdHashes)
        Object.assign(files, missingFiles)
        // give txs the unfilteredIndex

        for (const txidHash of slicedTransactions) {
          const file = files[txidHash]
          if (file == null) continue
          const tempTx = txs[file.txid]
          // skip irrelevant transactions - txs that are not in the files (dropped)
          if (
            !tempTx ||
            (!tempTx.nativeAmount[currencyCode] &&
              !tempTx.networkFee[currencyCode])
          ) {
            // exit block if there is no transaction or no amount / no fee
            continue
          }
          const tx = {
            ...tempTx,
            unfilteredIndex: mappedUnfilteredIndexes[txidHash]
          }
          // add this tx / file to the output
          const edgeTx = combineTxWithFile(input, tx, file, currencyCode)
          if (searchStringFilter(edgeTx, opts) && dateFilter(edgeTx, opts)) {
            out.push(edgeTx)
          }
          searchedTxs++
        }
        counter++
      }
      return out
    },

    async exportTransactionsToQBO(
      opts: EdgeGetTransactionsOptions
    ): Promise<string> {
      const txs: EdgeTransaction[] = await this.getTransactions(opts)
      const currencyCode =
        opts && opts.currencyCode
          ? opts.currencyCode
          : input.props.selfState.currencyInfo.currencyCode
      const denom = opts && opts.denomination ? opts.denomination : null
      const qbo: string = exportTransactionsToQBOInner(
        txs,
        currencyCode,
        this.fiatCurrencyCode,
        denom,
        Date.now()
      )
      return qbo
    },

    async exportTransactionsToCSV(
      opts: EdgeGetTransactionsOptions
    ): Promise<string> {
      const txs: EdgeTransaction[] = await this.getTransactions(opts)
      const currencyCode =
        opts && opts.currencyCode
          ? opts.currencyCode
          : input.props.selfState.currencyInfo.currencyCode
      const denom = opts && opts.denomination ? opts.denomination : null
      const csv: string = await exportTransactionsToCSVInner(
        txs,
        currencyCode,
        this.fiatCurrencyCode,
        denom
      )
      return csv
    },

    async getReceiveAddress(
      opts: EdgeCurrencyCodeOptions = {}
    ): Promise<EdgeReceiveAddress> {
      const freshAddress = await engine.getFreshAddress(opts)
      const receiveAddress: EdgeReceiveAddress = {
        metadata: fakeMetadata,
        nativeAmount: '0',
        publicAddress: freshAddress.publicAddress,
        legacyAddress: freshAddress.legacyAddress,
        segwitAddress: freshAddress.segwitAddress
      }
      return receiveAddress
    },

    async saveReceiveAddress(
      receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      // TODO: Address metadata
    },

    async lockReceiveAddress(
      receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      // TODO: Address metadata
    },

    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const { currencyInfo } = input.props.selfState
      const {
        currencyCode = currencyInfo.currencyCode,
        privateKeys,
        spendTargets = [],
        noUnconfirmed = false,
        networkFeeOption = 'standard',
        customNetworkFee,
        rbfTxid,
        metadata,
        swapData,
        otherParams
      } = spendInfo

      const cleanTargets: EdgeSpendTarget[] = []
      const savedTargets = []
      for (const target of spendTargets) {
        const { publicAddress, nativeAmount = '0', otherParams = {} } = target
        if (publicAddress == null) continue

        // Handle legacy spenders:
        let { uniqueIdentifier } = target
        if (
          uniqueIdentifier == null &&
          typeof otherParams.uniqueIdentifier === 'string'
        ) {
          uniqueIdentifier = otherParams.uniqueIdentifier
        }

        // Support legacy currency plugins:
        if (uniqueIdentifier != null) {
          otherParams.uniqueIdentifier = uniqueIdentifier
        }

        cleanTargets.push({
          publicAddress,
          nativeAmount,
          uniqueIdentifier,
          otherParams
        })
        savedTargets.push({
          currencyCode,
          publicAddress,
          nativeAmount,
          uniqueIdentifier
        })
      }

      if (cleanTargets.length === 0) {
        throw new TypeError('The spend has no destination')
      }
      if (privateKeys != null) {
        throw new TypeError('Only sweepPrivateKeys takes private keys')
      }

      const tx: EdgeTransaction = await engine.makeSpend({
        currencyCode,
        spendTargets: cleanTargets,
        noUnconfirmed,
        networkFeeOption,
        customNetworkFee,
        rbfTxid,
        metadata,
        otherParams
      })
      tx.networkFeeOption = networkFeeOption
      tx.requestedCustomFee = customNetworkFee
      tx.spendTargets = savedTargets
      if (metadata != null) tx.metadata = metadata
      if (swapData != null) tx.swapData = asTxSwap(swapData)

      return tx
    },

    async sweepPrivateKeys(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      if (!engine.sweepPrivateKeys) {
        return Promise.reject(
          new Error('Sweeping this currency is not supported.')
        )
      }
      return engine.sweepPrivateKeys(spendInfo)
    },

    async signTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      return engine.signTx(tx)
    },

    async broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      return engine.broadcastTx(tx)
    },

    async saveTx(tx: EdgeTransaction): Promise<void> {
      await setupNewTxMetadata(input, tx)
      await engine.saveTx(tx)
      fakeCallbacks.onTransactionsChanged([tx])
    },

    async resyncBlockchain(): Promise<void> {
      ai.props.dispatch({
        type: 'CURRENCY_ENGINE_CLEARED',
        payload: { walletId: input.props.id }
      })
      await engine.resyncBlockchain()
    },

    async dumpData(): Promise<EdgeDataDump> {
      return engine.dumpData()
    },

    async getPaymentProtocolInfo(
      paymentProtocolUrl: string
    ): Promise<EdgePaymentProtocolInfo> {
      if (!engine.getPaymentProtocolInfo) {
        throw new Error(
          "'getPaymentProtocolInfo' is not implemented on wallets of this type"
        )
      }
      return engine.getPaymentProtocolInfo(paymentProtocolUrl)
    },

    async saveTxMetadata(
      txid: string,
      currencyCode: string,
      metadata: EdgeMetadata
    ): Promise<void> {
      await setCurrencyWalletTxMetadata(
        input,
        txid,
        currencyCode,
        packMetadata(metadata, input.props.selfState.fiat),
        fakeCallbacks
      )
    },

    async getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string> {
      const { currencyCode, networkFeeOption, customNetworkFee } = spendInfo
      const balance = engine.getBalance({ currencyCode })

      // Copy all the spend targets, setting the amounts to 0
      // but keeping all other information so we can get accurate fees:
      const spendTargets = spendInfo.spendTargets.map(spendTarget => {
        return { ...spendTarget, nativeAmount: '0' }
      })

      // The range of possible values includes `min`, but not `max`.
      function getMax(min: string, max: string): Promise<string> {
        const diff = sub(max, min)
        if (lte(diff, '1')) {
          return Promise.resolve(min)
        }
        const mid = add(min, div(diff, '2'))

        // Try the average:
        spendTargets[0].nativeAmount = mid
        return engine
          .makeSpend({
            currencyCode,
            spendTargets,
            networkFeeOption,
            customNetworkFee
          })
          .then(good => getMax(mid, max))
          .catch(bad => getMax(min, mid))
      }

      return getMax('0', add(balance, '1'))
    },

    async parseUri(uri: string, currencyCode?: string): Promise<EdgeParsedUri> {
      const tools = await getCurrencyTools(ai, walletInfo.type)
      return tools.parseUri(
        uri,
        currencyCode,
        input.props.state.currency.customTokens
      )
    },

    async encodeUri(obj: EdgeEncodeUri): Promise<string> {
      const { legacyAddress, segwitAddress } = obj
      const copy = { ...obj }
      if (segwitAddress != null) copy.publicAddress = segwitAddress
      if (legacyAddress != null) copy.publicAddress = legacyAddress

      const tools = await getCurrencyTools(ai, walletInfo.type)
      return tools.encodeUri(copy, input.props.state.currency.customTokens)
    },

    otherMethods,

    // Deprecated API's:
    getBalance: CurrencyWalletSync.prototype.getBalance,
    getBlockHeight: CurrencyWalletSync.prototype.getBlockHeight,
    getDisplayPrivateSeed: CurrencyWalletSync.prototype.getDisplayPrivateSeed,
    getDisplayPublicSeed: CurrencyWalletSync.prototype.getDisplayPublicSeed
  }
  bridgifyObject(out)

  return out
}

export function combineTxWithFile(
  input: CurrencyWalletInput,
  tx: MergedTransaction,
  file: TransactionFile | void,
  currencyCode: string
): EdgeTransaction {
  const wallet = input.props.selfOutput.api
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const walletFiat = input.props.selfState.fiat

  const flowHack: any = tx
  const { unfilteredIndex } = flowHack

  // Copy the tx properties to the output:
  const out: EdgeTransaction = {
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,
    otherParams: { ...tx.otherParams, unfilteredIndex },

    amountSatoshi: Number(tx.nativeAmount[currencyCode]),
    nativeAmount: tx.nativeAmount[currencyCode],
    networkFee: tx.networkFee[currencyCode],
    parentNetworkFee: tx.networkFee[walletCurrency],
    currencyCode,
    wallet,
    metadata: {}
  }

  // If we have a file, use it to override the defaults:
  if (file != null) {
    if (file.creationDate < out.date) out.date = file.creationDate

    const merged = mergeDeeply(
      file.currencies[walletCurrency],
      file.currencies[currencyCode]
    )
    if (merged.metadata != null) {
      out.metadata = {
        ...out.metadata,
        ...unpackMetadata(merged.metadata, walletFiat)
      }
    }

    if (file.feeRateRequested != null) {
      if (typeof file.feeRateRequested === 'string') {
        out.networkFeeOption = file.feeRateRequested
      } else {
        out.networkFeeOption = 'custom'
        out.requestedCustomFee = file.feeRateRequested
      }
    }
    out.feeRateUsed = file.feeRateUsed

    if (file.payees != null) {
      out.spendTargets = file.payees.map(payee => ({
        currencyCode: payee.currency,
        nativeAmount: payee.amount,
        publicAddress: payee.address,
        uniqueIdentifier: payee.tag
      }))
    }

    if (file.swap != null) out.swapData = asTxSwap(file.swap)
    if (typeof file.secret === 'string') out.txSecret = file.secret
  }

  return out
}
