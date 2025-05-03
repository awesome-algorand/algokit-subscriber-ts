import type {Arc28EventGroup, NamedTransactionFilter, TransactionFilter, SubscriptionParams} from "../src/types";
import {AlgorandClient} from "@algorandfoundation/algokit-utils";
import {vi} from "vitest";
import {getSubscribedTransactions} from "../src";

export const GetDeltaSubscription = (
  subscription: {
    syncBehaviour: SubscriptionParams['syncBehaviour']
    roundsToSync: number
    indexerRoundsToSync?: number
    watermark?: bigint
    currentRound?: bigint
    filters: "deltas"
    arc28Events?: Arc28EventGroup[]
  },
  algorand: AlgorandClient,
) => {
  const { roundsToSync, indexerRoundsToSync, syncBehaviour, watermark, currentRound, filters, arc28Events } = subscription

  if (currentRound !== undefined) {
    const existingStatus = algorand.client.algod.status
    Object.assign(algorand.client.algod, {
      status: vi.fn().mockImplementation(() => {
        return {
          do: async () => {
            const status = await existingStatus.apply(algorand.client.algod).do()
            status.lastRound = currentRound
            return status
          },
        }
      }),
    })
  }

  return getSubscribedTransactions(
    {
      filters: "deltas",
      maxRoundsToSync: roundsToSync,
      maxIndexerRoundsToSync: indexerRoundsToSync,
      syncBehaviour: syncBehaviour,
      watermark: watermark ?? 0n,
      arc28Events,
    },
    algorand.client.algod,
    algorand.client.indexer,
  )
}
