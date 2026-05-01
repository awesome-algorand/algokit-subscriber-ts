import { Config } from '@algorandfoundation/algokit-utils'
import type { AlgodClient } from '@algorandfoundation/algokit-utils/algod-client'
import { Buffer } from 'buffer'
import { chunkArray, range } from './utils'
import {
  AccountDelta,
  AccountState,
  AppLocalState,
  AppParams,
  AppResourceDelta,
  AssetHolding,
  AssetParams,
  AssetResourceDelta,
  BoxDelta,
  CreatableDelta,
  DeltaBlockHeader,
  LedgerDelta,
  LedgerDeltaObserver,
  LedgerTotals,
  TealValue,
  TxidEntry,
  ValueAction,
} from './types/deltas'

/**
 * Retrieves and resolves ledger deltas in bulk (30 at a time) for the given round range.
 *
 * Uses the algod `/v2/deltas/{round}?format=json` endpoint directly so that the full structure
 * (KvMods etc.) is preserved regardless of any typed model in the underlying client.
 *
 * @param context The rounds to retrieve.
 * @param client The algod client.
 * @returns The fully resolved deltas (one per round).
 */
export async function getLedgerDeltasBulk(
  context: { startRound: bigint; maxRound: bigint },
  client: AlgodClient,
): Promise<LedgerDelta[]> {
  const chunks = chunkArray(range(context.startRound, context.maxRound), 30)
  let deltas: LedgerDelta[] = []
  for (const chunk of chunks) {
    Config.logger.info(`Retrieving ${chunk.length} ledger deltas from round ${chunk[0]} via algod`)
    const start = +new Date()
    const chunkDeltas = await Promise.all(
      chunk.map(async (round) => {
        const raw = await fetchRawDelta(client, round)
        return parseRawDelta(round, raw)
      }),
    )
    deltas = deltas.concat(chunkDeltas)
    Config.logger.debug(`Retrieved ${chunk.length} ledger deltas from round ${chunk[0]} via algod in ${(+new Date() - start) / 1000}s`)
  }
  return deltas
}

/** Fetch the raw JSON delta document from algod for a single round. */
async function fetchRawDelta(client: AlgodClient, round: bigint): Promise<Record<string, unknown>> {
  // Prefer the typed httpRequest exposed by algokit-utils' algod client.
  const httpRequest = (client as unknown as { httpRequest?: { request: (opts: unknown) => Promise<unknown> } }).httpRequest
  if (!httpRequest) {
    throw new Error('Algod client does not expose httpRequest; cannot fetch ledger deltas.')
  }
  const result = await httpRequest.request({
    method: 'GET',
    url: `/v2/deltas/${round}`,
    query: { format: 'json' },
  })
  return (result ?? {}) as Record<string, unknown>
}

// ---------- Parsing helpers ----------

function b64ToBytes(value: unknown): Uint8Array | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function bytesToString(bytes: Uint8Array | undefined): string {
  if (!bytes) return ''
  return Buffer.from(bytes).toString('binary')
}

function decodeAddressOrUndef(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  // The `Addr` field in deltas is already a base32 Algorand address.
  return value
}

function asBigInt(value: unknown): bigint {
  if (value === undefined || value === null) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string') return BigInt(value)
  return 0n
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.length > 0) return Number(value)
  return fallback
}

function asBool(value: unknown): boolean {
  return Boolean(value)
}

function readBigUInt64BE(bytes: Uint8Array, offset = 0): bigint {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readBigUInt64BE(offset)
}

/** Parses a TealValue object as returned by algod (`{ tt, ui?, bs? }`). */
function parseTealValue(raw: unknown): TealValue | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { tt?: number; ui?: number | string; bs?: string }
  const tt = r.tt
  if (tt === 1) {
    return { type: 1, bytes: b64ToBytes(r.bs) ?? new Uint8Array() }
  }
  if (tt === 2) {
    return { type: 2, uint: asBigInt(r.ui) }
  }
  return undefined
}

function parseTealKeyValue(raw: unknown): Record<string, TealValue> {
  const result: Record<string, TealValue> = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const tv = parseTealValue(value)
    if (tv) result[key] = tv
  }
  return result
}

function parseAppParams(raw: unknown): AppParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const params: AppParams = {
    approvalProgram: b64ToBytes(r.approv) ?? new Uint8Array(),
    clearStateProgram: b64ToBytes(r.clearp) ?? new Uint8Array(),
    globalState: parseTealKeyValue(r.gs),
  }
  const gsch = r.gsch as { nui?: number; nbs?: number } | undefined
  if (gsch) params.globalStateSchema = { numUint: asNumber(gsch.nui), numByteSlice: asNumber(gsch.nbs) }
  const lsch = r.lsch as { nui?: number; nbs?: number } | undefined
  if (lsch) params.localStateSchema = { numUint: asNumber(lsch.nui), numByteSlice: asNumber(lsch.nbs) }
  if (r.epp !== undefined) params.extraProgramPages = asNumber(r.epp)
  if (r.v !== undefined) params.version = asNumber(r.v)
  return params
}

function parseLocalState(raw: unknown): AppLocalState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const ls: AppLocalState = { keyValue: parseTealKeyValue(r.tkv) }
  const sch = r.hsch as { nui?: number; nbs?: number } | undefined
  if (sch) ls.schema = { numUint: asNumber(sch.nui), numByteSlice: asNumber(sch.nbs) }
  return ls
}

function parseAssetParams(raw: unknown): AssetParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const params: AssetParams = {
    total: asBigInt(r.t),
    decimals: asNumber(r.dc),
  }
  if (r.df !== undefined) params.defaultFrozen = asBool(r.df)
  if (typeof r.un === 'string' && r.un) params.unitName = r.un as string
  if (typeof r.an === 'string' && r.an) params.assetName = r.an as string
  if (typeof r.au === 'string' && r.au) params.url = r.au as string
  const am = b64ToBytes(r.am)
  if (am && am.some((b) => b !== 0)) params.metadataHash = am
  if (typeof r.m === 'string' && r.m) params.manager = r.m as string
  if (typeof r.r === 'string' && r.r) params.reserve = r.r as string
  if (typeof r.f === 'string' && r.f) params.freeze = r.f as string
  if (typeof r.c === 'string' && r.c) params.clawback = r.c as string
  return params
}

function parseAssetHolding(raw: unknown): AssetHolding | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { a?: number | string; f?: boolean }
  return { amount: asBigInt(r.a), frozen: asBool(r.f) }
}

function parseAccountState(raw: Record<string, unknown>): AccountState {
  const account: AccountState = {
    address: String(raw.Addr),
    microAlgos: asBigInt(raw.MicroAlgos),
    status: asNumber(raw.Status),
    rewardedMicroAlgos: asBigInt(raw.RewardedMicroAlgos),
    totalAssets: asNumber(raw.TotalAssets),
    totalAssetParams: asNumber(raw.TotalAssetParams),
    totalAppLocalStates: asNumber(raw.TotalAppLocalStates),
    totalAppParams: asNumber(raw.TotalAppParams),
    totalBoxBytes: asNumber(raw.TotalBoxBytes),
    totalBoxes: asNumber(raw.TotalBoxes),
    totalExtraAppPages: asNumber(raw.TotalExtraAppPages),
  }
  // The auth address is a base32 string; only set it if it is non-zero (zero address indicates no rekey).
  const authAddr = decodeAddressOrUndef(raw.AuthAddr)
  // The zero address is the canonical Algorand address for `no rekey`; ignore it.
  const ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
  if (authAddr && authAddr !== ZERO_ADDRESS) {
    account.authAddress = authAddr
  }
  if (raw.IncentiveEligible !== undefined) account.incentiveEligible = asBool(raw.IncentiveEligible)
  if (raw.LastProposed !== undefined) account.lastProposed = asBigInt(raw.LastProposed)
  if (raw.LastHeartbeat !== undefined) account.lastHeartbeat = asBigInt(raw.LastHeartbeat)
  return account
}

function parseAppResource(raw: Record<string, unknown>): AppResourceDelta {
  const params = raw.Params as { Deleted?: boolean; Params?: unknown } | undefined
  const state = raw.State as { Deleted?: boolean; LocalState?: unknown } | undefined
  return {
    appId: asBigInt(raw.Aidx),
    address: String(raw.Addr),
    paramsDeleted: asBool(params?.Deleted),
    params: parseAppParams(params?.Params),
    localStateDeleted: asBool(state?.Deleted),
    localState: parseLocalState(state?.LocalState),
  }
}

function parseAssetResource(raw: Record<string, unknown>): AssetResourceDelta {
  const params = raw.Params as { Deleted?: boolean; Params?: unknown } | undefined
  const holding = raw.Holding as { Deleted?: boolean; Holding?: unknown } | undefined
  return {
    assetId: asBigInt(raw.Aidx),
    address: String(raw.Addr),
    paramsDeleted: asBool(params?.Deleted),
    params: parseAssetParams(params?.Params),
    holdingDeleted: asBool(holding?.Deleted),
    holding: parseAssetHolding(holding?.Holding),
  }
}

function parseHeader(round: bigint, raw: unknown): DeltaBlockHeader {
  const h = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>
  return {
    round: h.rnd !== undefined ? asBigInt(h.rnd) : round,
    timestamp: asNumber(h.ts),
    genesisId: typeof h.gen === 'string' ? (h.gen as string) : undefined,
    protocol: typeof h.proto === 'string' ? (h.proto as string) : undefined,
    feeSink: typeof h.fees === 'string' ? (h.fees as string) : undefined,
    rewardsPool: typeof h.rwd === 'string' ? (h.rwd as string) : undefined,
    raw: h,
  }
}

function parseTotals(raw: unknown): LedgerTotals | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, { mon?: number | string; rwd?: number | string }>
  return {
    online: { microAlgos: asBigInt(r.online?.mon), rewards: asBigInt(r.online?.rwd) },
    offline: { microAlgos: asBigInt(r.offline?.mon), rewards: asBigInt(r.offline?.rwd) },
    notParticipating: {
      microAlgos: asBigInt(r.notpart?.mon),
      rewards: r.notpart?.rwd !== undefined ? asBigInt(r.notpart.rwd) : undefined,
    },
  }
}

function parseTxids(raw: unknown): Record<string, TxidEntry> {
  const result: Record<string, TxidEntry> = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [key, value] of Object.entries(raw as Record<string, { Intra?: number; LastValid?: number | string }>)) {
    // The key is the base64 of the SHA512/256 digest of the transaction; algorand displays txids as base32 of that digest.
    const bytes = b64ToBytes(key)
    if (!bytes) continue
    const txid = base32NoPad(bytes)
    result[txid] = {
      txid,
      intra: asNumber(value?.Intra),
      lastValid: asBigInt(value?.LastValid),
    }
  }
  return result
}

/** Encodes bytes as RFC4648 base32 without padding (Algorand-style). */
function base32NoPad(bytes: Uint8Array): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return output
}

function parseCreatables(raw: unknown): Record<string, CreatableDelta> {
  const result: Record<string, CreatableDelta> = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [id, value] of Object.entries(raw as Record<string, { Created?: boolean; Creator?: string; Ctype?: number }>)) {
    result[id] = {
      id: BigInt(id),
      type: value?.Ctype === 1 ? 'app' : 'asset',
      created: asBool(value?.Created),
      creator: String(value?.Creator ?? ''),
    }
  }
  return result
}

/**
 * Parse the KvMods structure into typed boxes (with `bx:` prefix) and other KV mods.
 *
 * The algod ledger delta endpoint returns KvMods keys as raw binary bytes encoded as Latin-1
 * JSON strings (not base64). The encoding for a box KV entry is:
 *   `bx:` (3 bytes ASCII) + appID (8 bytes BE) + boxName (variable bytes).
 *
 * Other KV (non-box) entries are returned unchanged keyed by their base64 representation.
 */
function parseKvMods(raw: unknown): {
  boxes: Record<string, Record<string, BoxDelta>>
  kvMods: Record<string, { previousValue?: Uint8Array; nextValue?: Uint8Array; action: ValueAction }>
} {
  const boxes: Record<string, Record<string, BoxDelta>> = {}
  const kvMods: Record<string, { previousValue?: Uint8Array; nextValue?: Uint8Array; action: ValueAction }> = {}
  if (!raw || typeof raw !== 'object') return { boxes, kvMods }
  for (const [rawKey, modRaw] of Object.entries(raw as Record<string, unknown>)) {
    const mod = (modRaw ?? {}) as { Data?: string | null; OldData?: string | null }
    // The key string contains raw bytes (Latin-1) – preserve byte values.
    const keyBytes = Uint8Array.from(rawKey, (c) => c.charCodeAt(0) & 0xff)
    const nextValue = mod.Data === null || mod.Data === undefined ? undefined : b64ToBytes(mod.Data)
    const previousValue = mod.OldData === null || mod.OldData === undefined ? undefined : b64ToBytes(mod.OldData)
    const action: ValueAction = nextValue === undefined ? 'delete' : 'set'

    if (keyBytes.length >= 11 && keyBytes[0] === 0x62 /* 'b' */ && keyBytes[1] === 0x78 /* 'x' */ && keyBytes[2] === 0x3a /* ':' */) {
      const appId = readBigUInt64BE(keyBytes, 3)
      const boxName = keyBytes.slice(11)
      const nameBase64 = Buffer.from(boxName).toString('base64')
      const appKey = appId.toString()
      if (!boxes[appKey]) boxes[appKey] = {}
      boxes[appKey][nameBase64] = {
        action,
        name: boxName,
        nameBase64,
        nextValue,
        previousValue,
      }
    } else {
      const keyB64 = Buffer.from(keyBytes).toString('base64')
      kvMods[keyB64] = { previousValue, nextValue, action }
    }
  }
  return { boxes, kvMods }
}

/** Parse a raw delta JSON document from algod into a typed {@link LedgerDelta}. */
export function parseRawDelta(round: bigint, rawDelta: Record<string, unknown>): LedgerDelta {
  const accounts: Record<string, AccountDelta> = {}
  const appResources: Record<string, Record<string, AppResourceDelta>> = {}
  const assetResources: Record<string, Record<string, AssetResourceDelta>> = {}

  const acctsContainer = (rawDelta.Accts ?? {}) as Record<string, unknown>

  // Account state
  for (const acctRaw of (acctsContainer.Accts ?? []) as Record<string, unknown>[]) {
    const acct = parseAccountState(acctRaw)
    accounts[acct.address] = { address: acct.address, account: acct }
  }

  // App resources (per account)
  for (const r of (acctsContainer.AppResources ?? []) as Record<string, unknown>[]) {
    const resource = parseAppResource(r)
    const key = resource.appId.toString()
    if (!appResources[key]) appResources[key] = {}
    appResources[key][resource.address] = resource
  }

  // Asset resources (per account)
  for (const r of (acctsContainer.AssetResources ?? []) as Record<string, unknown>[]) {
    const resource = parseAssetResource(r)
    const key = resource.assetId.toString()
    if (!assetResources[key]) assetResources[key] = {}
    assetResources[key][resource.address] = resource
  }

  const { boxes, kvMods } = parseKvMods(rawDelta.KvMods)
  const creatables = parseCreatables(rawDelta.Creatables)
  const txids = parseTxids(rawDelta.Txids)
  const header = parseHeader(round, rawDelta.Hdr)
  const totals = parseTotals(rawDelta.Totals)

  return {
    round,
    header,
    totals,
    accounts,
    appResources,
    assetResources,
    boxes,
    kvMods,
    creatables,
    txids,
    previousTimestamp: rawDelta.PrevTimestamp !== undefined ? asNumber(rawDelta.PrevTimestamp) : undefined,
    raw: rawDelta,
  }
}

// ---------- Observer ----------

/**
 * A helper class that wraps a {@link LedgerDelta} and provides convenience methods
 * for accessing common pieces of state.
 */
export class LedgerDeltaObserverImpl implements LedgerDeltaObserver {
  constructor(public readonly delta: LedgerDelta) {}

  get round(): bigint {
    return this.delta.round
  }

  /** @inheritdoc */
  getGlobalState(appId: bigint | number): Record<string, TealValue> {
    const key = BigInt(appId).toString()
    const perAccount = this.delta.appResources[key]
    if (!perAccount) return {}
    // The creator's app resource entry is the one with `params` populated.
    for (const resource of Object.values(perAccount)) {
      if (resource.params && !resource.paramsDeleted) {
        return resource.params.globalState
      }
    }
    return {}
  }

  /** @inheritdoc */
  getLocalState(appId: bigint | number, address: string): Record<string, TealValue> | undefined {
    const key = BigInt(appId).toString()
    const resource = this.delta.appResources[key]?.[address]
    if (!resource || resource.localStateDeleted) return undefined
    return resource.localState?.keyValue
  }

  /** @inheritdoc */
  getBoxChanges(appId: bigint | number): Record<string, BoxDelta> {
    const key = BigInt(appId).toString()
    return this.delta.boxes[key] ?? {}
  }

  /** @inheritdoc */
  getAccount(address: string): AccountState | undefined {
    return this.delta.accounts[address]?.account
  }

  /** @inheritdoc */
  getApp(appId: bigint | number): AppParams | undefined {
    const key = BigInt(appId).toString()
    const perAccount = this.delta.appResources[key]
    if (!perAccount) return undefined
    for (const resource of Object.values(perAccount)) {
      if (resource.params && !resource.paramsDeleted) return resource.params
    }
    return undefined
  }

  /** @inheritdoc */
  getAsset(assetId: bigint | number): AssetParams | undefined {
    const key = BigInt(assetId).toString()
    const perAccount = this.delta.assetResources[key]
    if (!perAccount) return undefined
    for (const resource of Object.values(perAccount)) {
      if (resource.params && !resource.paramsDeleted) return resource.params
    }
    return undefined
  }

  /** @inheritdoc */
  getAssetHolding(assetId: bigint | number, address: string): AssetHolding | undefined {
    const key = BigInt(assetId).toString()
    const resource = this.delta.assetResources[key]?.[address]
    if (!resource || resource.holdingDeleted) return undefined
    return resource.holding
  }

  /** @inheritdoc */
  isAppCreated(appId: bigint | number): boolean {
    const c = this.delta.creatables[BigInt(appId).toString()]
    return !!c && c.type === 'app' && c.created
  }

  /** @inheritdoc */
  isAppDestroyed(appId: bigint | number): boolean {
    const c = this.delta.creatables[BigInt(appId).toString()]
    return !!c && c.type === 'app' && !c.created
  }

  /** @inheritdoc */
  isAssetCreated(assetId: bigint | number): boolean {
    const c = this.delta.creatables[BigInt(assetId).toString()]
    return !!c && c.type === 'asset' && c.created
  }

  /** @inheritdoc */
  isAssetDestroyed(assetId: bigint | number): boolean {
    const c = this.delta.creatables[BigInt(assetId).toString()]
    return !!c && c.type === 'asset' && !c.created
  }

  /** @inheritdoc */
  getTransactionIds(): string[] {
    return Object.keys(this.delta.txids)
  }

  /** @inheritdoc */
  getChangedAppIds(): bigint[] {
    return Object.keys(this.delta.appResources).map((k) => BigInt(k))
  }

  /** @inheritdoc */
  getChangedAssetIds(): bigint[] {
    return Object.keys(this.delta.assetResources).map((k) => BigInt(k))
  }

  /** @inheritdoc */
  getChangedAccounts(): string[] {
    return Object.keys(this.delta.accounts)
  }
}
