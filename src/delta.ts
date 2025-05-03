import { Config } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { chunkArray, range } from './utils'
import Algodv2 = algosdk.Algodv2

/**
 * Retrieves deltas in bulk (30 at a time) between the given round numbers.
 * @param context The deltas to retrieve
 * @param client The algod client
 * @returns The blocks
 */
export async function getDeltasBulk(context: { startRound: bigint; maxRound: bigint }, client: Algodv2) {
  // Grab 30 at a time in parallel to not overload the node
  const blockChunks = chunkArray(range(context.startRound, context.maxRound), 30)
  let deltas: algosdk.LedgerStateDelta[] = []
  for (const chunk of blockChunks) {
    Config.logger.info(`Retrieving ${chunk.length} blocks from round ${chunk[0]} via algod`)
    const start = +new Date()
    deltas = deltas.concat(
      await Promise.all(
        chunk.map(async (round) => {
          return await client.getLedgerStateDelta(round).do()
        }),
      ),
    )
    Config.logger.debug(`Retrieved ${chunk.length} blocks from round ${chunk[0]} via algod in ${(+new Date() - start) / 1000}s`)
  }
  return deltas
}

