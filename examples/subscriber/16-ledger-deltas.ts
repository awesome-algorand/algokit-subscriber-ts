import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { Buffer } from 'buffer'
import { AlgorandSubscriber } from '../../src'

/**
 * This example shows how to subscribe to ledger deltas and use the delta observer helpers.
 *
 * The ledger delta endpoint (`/v2/deltas/{round}`) returns a fully resolved snapshot of all
 * state changes in a round: account state, app params + global state, app local state per
 * account, asset params + holdings per account, creatables (created/destroyed apps and assets),
 * box (KV) changes (with previous and next values), transaction ids, header info and ledger totals.
 */
async function main() {
  const algorand = AlgorandClient.defaultLocalNet()

  // Create subscriber with processDeltas enabled
  const subscriber = new AlgorandSubscriber(
    {
      filters: [],
      processDeltas: true,
      watermarkPersistence: {
        get: async () => 0n,
        set: async (watermark) => {
          console.log(`Saved watermark: ${watermark}`)
        },
      },
    },
    algorand.client.algod,
  )

  subscriber.onDelta(async (delta) => {
    console.log(`Received delta for round ${delta.round}`)

    // Walk every account that changed
    for (const address of delta.getChangedAccounts()) {
      const account = delta.getAccount(address)!
      console.log(`  Account ${address}: balance=${account.microAlgos} status=${account.status}`)
    }

    // Walk every app that changed; print global state and any local state per opted-in account
    for (const appId of delta.getChangedAppIds()) {
      const app = delta.getApp(appId)
      if (app) {
        console.log(`  App ${appId} params updated, schema=${JSON.stringify(app.globalStateSchema)}`)
        for (const [key, value] of Object.entries(app.globalState)) {
          if (value.type === 2) {
            console.log(`    global[${key}] = uint(${value.uint})`)
          } else {
            console.log(`    global[${key}] = bytes(${Buffer.from(value.bytes!).toString('hex')})`)
          }
        }
      }
      const perAccount = delta.delta.appResources[appId.toString()]
      for (const [address, resource] of Object.entries(perAccount)) {
        if (resource.localState) {
          console.log(`  App ${appId} local state for ${address}:`, resource.localState.keyValue)
        }
      }
    }

    // Walk every asset that changed; print params and holdings
    for (const assetId of delta.getChangedAssetIds()) {
      const asset = delta.getAsset(assetId)
      if (asset) console.log(`  Asset ${assetId}: ${asset.assetName ?? ''} total=${asset.total}`)
    }

    // Box changes (with previous + next values)
    for (const appIdStr of Object.keys(delta.delta.boxes)) {
      const boxChanges = delta.getBoxChanges(BigInt(appIdStr))
      for (const change of Object.values(boxChanges)) {
        const name = Buffer.from(change.name).toString('utf8')
        const prev = change.previousValue ? Buffer.from(change.previousValue).toString('hex') : 'none'
        const next = change.nextValue ? Buffer.from(change.nextValue).toString('hex') : 'none'
        console.log(`  Box ${appIdStr}/${name}: ${change.action} prev=${prev} next=${next}`)
      }
    }

    // Creatables (apps/assets created or destroyed)
    for (const [id, c] of Object.entries(delta.delta.creatables)) {
      console.log(`  ${c.created ? 'Created' : 'Destroyed'} ${c.type} ${id} by ${c.creator}`)
    }

    // Transaction ids in this round
    const txIds = delta.getTransactionIds()
    if (txIds.length > 0) console.log(`  Txns: ${txIds.join(', ')}`)
  })

  console.log('Starting subscriber...')
  await subscriber.pollOnce()
  console.log('Poll complete')
}

if (require.main === module) {
  main().catch(console.error)
}
