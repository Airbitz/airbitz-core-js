// @flow

import { bridgifyObject, onMethod } from 'yaob'

import {
  type EdgeConvertCurrencyOpts,
  type EdgeRateCache
} from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import { getExchangeRate } from './exchange-selectors.js'

const biasDefaults = {
  nomics: 0.1,
  coincap: -0.1,
  coinbase: -0.2
}

/**
 * Creates an unwrapped exchange cache API object.
 */
export function makeExchangeCache(ai: ApiInput): EdgeRateCache {
  /**
   * TODO: Once the user has an exchange-rate preference,
   * look that up and bias in favor of the preferred exchange.
   */
  function makeGetPairCost(biases?: { [name: string]: number }) {
    return (source, age, inverse) => {
      // The age curve goes from 0 to 1, with 1 being infinitely old.
      // The curve reaches half way (0.5) at 30 seconds in:
      const ageCurve = age / (30 + age)
      let bias = biases ? biases[source] : biasDefaults[source]
      if (typeof bias !== 'number') {
        bias = 0
      }
      return ageCurve + bias + (inverse ? 1.1 : 1) // + 2 * isWrongExchange()
    }
  }

  const out: EdgeRateCache = {
    on: onMethod,

    async convertCurrency(
      fromCurrency: string,
      toCurrency: string,
      amount: number = 1,
      opts: EdgeConvertCurrencyOpts = {}
    ): Promise<number> {
      const rate = getExchangeRate(
        ai.props.state,
        fromCurrency,
        toCurrency,
        makeGetPairCost(opts.biases)
      )
      return amount * rate
    }
  }
  bridgifyObject(out)

  return out
}
