import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Buffer } from 'buffer'
import { AlgorandSubscriber } from '../../src/subscriber'
import { LedgerDeltaObserver } from '../../src/types/deltas'

describe('Ledger deltas', () => {
  const localnet = algorandFixture()

  beforeEach(localnet.beforeEach, 10e6)
  afterEach(() => {
    vitest.clearAllMocks()
  })

  const buildSubscriber = (algorand: any, fromRound: bigint) =>
    new AlgorandSubscriber(
      {
        filters: [],
        processDeltas: true,
        watermarkPersistence: {
          get: async () => fromRound - 1n,
          set: async () => {},
        },
      },
      algorand.client.algod,
    )

  it('resolves global state, app params, account state, creatables and txids on app create', async () => {
    const { algorand, generateAccount } = localnet.context
    const sender = await generateAccount({ initialFunds: (10).algos() })
    algorand.setSignerFromAccount(sender)

    const createResult = await algorand.send.appCreate({
      sender: sender.addr,
      approvalProgram: '#pragma version 10\npushbytes "key"\npushint 123\napp_global_put\nint 1\nreturn',
      clearStateProgram: '#pragma version 10\nint 1\nreturn',
      schema: { globalInts: 1, globalByteSlices: 0, localInts: 0, localByteSlices: 0 },
    })

    const appId = createResult.appId!
    const round = BigInt(createResult.confirmation.confirmedRound!)

    let captured: LedgerDeltaObserver | undefined
    const subscriber = buildSubscriber(algorand, round)
    subscriber.onDelta(async (delta) => {
      if (delta.round === round) captured = delta
    })
    await subscriber.pollOnce()

    expect(captured).toBeDefined()
    const c = captured!

    // Round + header
    expect(c.round).toBe(round)
    expect(c.delta.header.round).toBe(round)
    expect(c.delta.header.timestamp).toBeGreaterThan(0)

    // Creatable: app was created in this round
    expect(c.isAppCreated(appId)).toBe(true)
    expect(c.isAppDestroyed(appId)).toBe(false)
    expect(c.delta.creatables[appId.toString()].creator).toBe(sender.addr.toString())

    // App params resolved with global state
    const app = c.getApp(appId)
    expect(app).toBeDefined()
    expect(app!.approvalProgram.length).toBeGreaterThan(0)
    expect(app!.clearStateProgram.length).toBeGreaterThan(0)
    expect(app!.globalStateSchema).toEqual({ numUint: 1, numByteSlice: 0 })

    // Global state helper resolves the data
    const gs = c.getGlobalState(appId)
    expect(gs.key).toBeDefined()
    expect(gs.key.type).toBe(2)
    expect(gs.key.uint).toBe(123n)

    // Account state
    const account = c.getAccount(sender.addr.toString())
    expect(account).toBeDefined()
    expect(account!.totalAppParams).toBeGreaterThanOrEqual(1)

    // Tx ids — at least one txn (the app create) recorded
    const txids = c.getTransactionIds()
    expect(txids.length).toBeGreaterThanOrEqual(1)
    expect(txids).toContain(createResult.txIds[0])

    // Helpers list changed entities
    expect(c.getChangedAppIds().map((id) => id.toString())).toContain(appId.toString())
    expect(c.getChangedAccounts()).toContain(sender.addr.toString())
  })

  it('resolves box changes (with previous and next values)', async () => {
    const { algorand, generateAccount } = localnet.context
    const sender = await generateAccount({ initialFunds: (10).algos() })
    algorand.setSignerFromAccount(sender)

    // Approval program performs box_put only on NoOp (after creation), allowing us to fund the app first.
    const approvalProgram = [
      '#pragma version 10',
      'txn ApplicationID',
      'int 0',
      '==',
      'bnz creating',
      'pushbytes "b"',
      'pushbytes "v1"',
      'box_put',
      'creating:',
      'int 1',
      'return',
    ].join('\n')
    const createResult = await algorand.send.appCreate({
      sender: sender.addr,
      approvalProgram,
      clearStateProgram: '#pragma version 10\nint 1\nreturn',
    })
    const appId = createResult.appId!
    const appAddr = (await algorand.app.getById(appId)).appAddress
    await algorand.send.payment({ sender: sender.addr, receiver: appAddr, amount: (1).algo() })

    const writeResult = await algorand.send.appCall({
      sender: sender.addr,
      appId,
      boxReferences: [{ appId, name: 'b' }],
    } as any)

    const round = BigInt(writeResult.confirmation.confirmedRound!)

    let captured: LedgerDeltaObserver | undefined
    const subscriber = buildSubscriber(algorand, round)
    subscriber.onDelta(async (delta) => {
      if (delta.round === round) captured = delta
    })
    await subscriber.pollOnce()

    expect(captured).toBeDefined()
    const boxChanges = captured!.getBoxChanges(appId)
    const boxNameB64 = Buffer.from('b').toString('base64')
    expect(boxChanges[boxNameB64]).toBeDefined()
    expect(boxChanges[boxNameB64].action).toBe('set')
    expect(Buffer.from(boxChanges[boxNameB64].name).toString()).toBe('b')
    expect(Buffer.from(boxChanges[boxNameB64].nextValue!).toString()).toBe('v1')
    // No previous value (this is first set)
    expect(boxChanges[boxNameB64].previousValue).toBeUndefined()
  })

  it('resolves asset creation', async () => {
    const { algorand, generateAccount } = localnet.context
    const sender = await generateAccount({ initialFunds: (10).algos() })
    algorand.setSignerFromAccount(sender)

    const createResult = await algorand.send.assetCreate({
      sender: sender.addr,
      total: 1000n,
      decimals: 0,
      assetName: 'TEST',
      unitName: 'T',
    })
    const assetId = createResult.assetId!
    const round = BigInt(createResult.confirmation.confirmedRound!)

    let captured: LedgerDeltaObserver | undefined
    const subscriber = buildSubscriber(algorand, round)
    subscriber.onDelta(async (delta) => {
      if (delta.round === round) captured = delta
    })
    await subscriber.pollOnce()

    expect(captured).toBeDefined()
    expect(captured!.isAssetCreated(assetId)).toBe(true)
    const asset = captured!.getAsset(assetId)
    expect(asset).toBeDefined()
    expect(asset!.total).toBe(1000n)
    expect(asset!.decimals).toBe(0)
    expect(asset!.assetName).toBe('TEST')
    expect(asset!.unitName).toBe('T')

    // Holding for the creator
    const holding = captured!.getAssetHolding(assetId, sender.addr.toString())
    expect(holding).toBeDefined()
    expect(holding!.amount).toBe(1000n)

    expect(captured!.getChangedAssetIds().map((id) => id.toString())).toContain(assetId.toString())
  })
})
