import { Config } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { chunkArray, range } from './utils'
import { Mutex, Semaphore } from 'async-mutex'

/**
 * Fetches the delta information for a specific block round from the provided Algorand client.
 *
 * @TODO: Either fix js-algosdk or implement the serialization here
 * @param {bigint} round - The block round for which the delta information is to be retrieved.
 * @param {algosdk.Algodv2} client - The Algorand client instance used to make the request.
 * @return {Promise<Response>} A promise that resolves to the fetched delta response.
 */
export async function getDelta(round: bigint, client: algosdk.Algodv2) {
  // @ts-expect-error, accessing private field
  const origin = client.c.bc.baseURL.origin

  return await fetch(`${origin}/v2/blocks/${round}/deltas`)
}

/**
 * Retrieves deltas in bulk (30 at a time) between the given round numbers.
 * @param lock The mutex to use for concurrency
 * @param context The deltas to retrieve
 * @param client The algod client
 * @returns The blocks
 */
export async function getDeltasBulk(lock: Mutex | Semaphore, context: { startRound: bigint; maxRound: bigint }, client: algosdk.Algodv2) {
  // Grab 30 at a time in parallel to not overload the node
  const blockChunks = chunkArray(range(context.startRound, context.maxRound), 30)
  let deltas: algosdk.LedgerStateDelta[] = []
  for (const chunk of blockChunks) {
    Config.logger.info(`Retrieving ${chunk.length} blocks from round ${chunk[0]} via algod`)
    const start = +new Date()
    deltas = deltas.concat(
      await Promise.all(
        chunk.map(async (round) => {
          return lock.runExclusive(() =>
            client
              .getLedgerStateDelta(round)
              .do()
              .catch((e) => {
                Config.logger.error(`Failed at round ${round} with error ${e}`)
                // TODO: fix js-algosdk
                throw e
              }),
          )
        }),
      ),
    )
    Config.logger.debug(`Retrieved ${chunk.length} blocks from round ${chunk[0]} via algod in ${(+new Date() - start) / 1000}s`)
  }
  return deltas
}
