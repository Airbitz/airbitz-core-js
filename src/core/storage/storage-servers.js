// @flow

import {
  type EdgeFetchOptions,
  type EdgeIo,
  type EdgeLog,
  NetworkError
} from '../../types/types.js'

const syncServers = [
  'https://sync-us1.edge.app',
  'https://sync-us2.edge.app',
  'https://sync-us3.edge.app',
  'https://sync-us4.edge.app',
  'https://sync-eu1.edge.app',
  'https://sync-eu2.edge.app',
  'https://sync-eu3.edge.app',
  'https://sync-eu4.edge.app'
  // 'https://git1.edge.app',
  // 'https://git3.airbitz.co',
  // 'https://git4.edge.app'
]

type SyncReply = {
  changes?: { [path: string]: any },
  hash?: string
}

/**
 * Fetches some resource from a sync server.
 */
export async function syncRequest(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  uri: string,
  body: any
): Promise<SyncReply> {
  const start = Math.floor(Math.random() * syncServers.length)

  async function loop(i: number): Promise<SyncReply> {
    const server = syncServers[(start + i) % syncServers.length]
    const promise = syncRequestInner(io, log, method, uri, body, server)
    return i < syncServers.length ? promise.catch(() => loop(i + 1)) : promise
  }
  return loop(0)
}

export async function syncRequestInner(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  path: string,
  body: any,
  server: string
): Promise<SyncReply> {
  const opts: EdgeFetchOptions = {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    }
  }
  if (method !== 'GET') opts.body = JSON.stringify(body)

  // Do the fetch, translating the raw network error into our format:
  const uri = `${server}${path}`
  const start = Date.now()
  const response = await io.fetch(uri, opts).catch(error => {
    const time = Date.now() - start
    const message = `${method} ${server} failed in ${time}ms, ${String(error)}`
    log.error(message)
    throw new NetworkError(message)
  })
  const time = Date.now() - start
  const message = `${method} ${uri} returned ${response.status} in ${time}ms`

  // Log our result and return its contents:
  if (!response.ok) {
    log.error(message)
    throw new NetworkError(message)
  }
  log(message)
  return response.json()
}
