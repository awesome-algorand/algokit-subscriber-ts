/**
 * Types for the Algorand ledger state delta endpoint (`/v2/deltas/{round}`).
 *
 * The endpoint returns a fully resolved snapshot of all state changes for a round:
 *  - account balance/state changes
 *  - per-account app local state and per-app global state changes (and app params)
 *  - per-account asset holdings and per-asset asset params
 *  - creatables (newly created or destroyed apps/assets)
 *  - box (KV) changes with previous and next values
 *  - transaction ids (with intra-block index)
 *  - block header info and ledger totals
 */

/** TealValue type tag — 1 = bytes, 2 = uint. */
export type TealValueType = 1 | 2

/** A decoded TEAL value as stored in global / local state. */
export interface TealValue {
  /** The type: 1 = bytes, 2 = uint. */
  type: TealValueType
  /** The uint value (when `type` is 2). */
  uint?: bigint
  /** The bytes value (when `type` is 1). */
  bytes?: Uint8Array
}

/** A change action for a key/value pair. */
export type ValueAction = 'set' | 'delete'

/** A delta for a single TEAL state value (global or local). */
export interface TealValueDelta {
  /** Whether the value was set or deleted. */
  action: ValueAction
  /** The next value, when the action is `set`. */
  nextValue?: TealValue
}

/** A delta for a single box / KV entry. */
export interface BoxDelta {
  /** Whether the box was set or deleted. */
  action: ValueAction
  /** Decoded box name bytes. */
  name: Uint8Array
  /** Box name as base64 (also used as the key in `boxes[appId]`). */
  nameBase64: string
  /** The next raw bytes value (undefined when deleted). */
  nextValue?: Uint8Array
  /** The previous raw bytes value (undefined when newly created). */
  previousValue?: Uint8Array
}

/** Application schema (max counts of state values). */
export interface AppStateSchema {
  /** Max number of uint values. */
  numUint: number
  /** Max number of byte values. */
  numByteSlice: number
}

/** Application parameters (after the round). */
export interface AppParams {
  /** Approval program bytes. */
  approvalProgram: Uint8Array
  /** Clear state program bytes. */
  clearStateProgram: Uint8Array
  /** Global state schema. */
  globalStateSchema?: AppStateSchema
  /** Local state schema. */
  localStateSchema?: AppStateSchema
  /** Number of extra program pages. */
  extraProgramPages?: number
  /** Decoded global state map (key string -> TealValue). */
  globalState: Record<string, TealValue>
  /** Version (for upgradable apps). */
  version?: number
}

/** Per-account app local state (after the round). */
export interface AppLocalState {
  /** Schema of local state. */
  schema?: AppStateSchema
  /** Decoded key-value map of local state. */
  keyValue: Record<string, TealValue>
}

/** A delta for an app from the perspective of an account (creator or opted-in). */
export interface AppResourceDelta {
  /** App ID. */
  appId: bigint
  /** Account address this resource is associated with. */
  address: string
  /** Whether the app params were deleted (i.e. app was destroyed). */
  paramsDeleted: boolean
  /** App params if this account is the creator and the params changed. */
  params?: AppParams
  /** Whether the local state was deleted (i.e. account closed out / cleared state). */
  localStateDeleted: boolean
  /** Local state, if this account has opted-in and local state changed. */
  localState?: AppLocalState
}

/** Asset parameters (after the round). */
export interface AssetParams {
  /** Total supply. */
  total: bigint
  /** Decimal places. */
  decimals: number
  /** Whether the asset is frozen by default. */
  defaultFrozen?: boolean
  /** Asset unit name. */
  unitName?: string
  /** Asset name. */
  assetName?: string
  /** Asset URL. */
  url?: string
  /** Metadata hash. */
  metadataHash?: Uint8Array
  /** Manager address. */
  manager?: string
  /** Reserve address. */
  reserve?: string
  /** Freeze address. */
  freeze?: string
  /** Clawback address. */
  clawback?: string
}

/** Per-account asset holding (after the round). */
export interface AssetHolding {
  /** Held amount. */
  amount: bigint
  /** Whether the holding is frozen. */
  frozen: boolean
}

/** A delta for an asset from the perspective of an account. */
export interface AssetResourceDelta {
  /** Asset ID. */
  assetId: bigint
  /** Account address this resource is associated with. */
  address: string
  /** Whether the asset params were deleted (i.e. asset was destroyed). */
  paramsDeleted: boolean
  /** Asset params if this account is the creator and the params changed. */
  params?: AssetParams
  /** Whether the holding was deleted (i.e. account closed out / opted-out). */
  holdingDeleted: boolean
  /** Holding, if this account holds the asset. */
  holding?: AssetHolding
}

/** Account state (after the round). */
export interface AccountState {
  /** Address. */
  address: string
  /** Balance in microAlgos. */
  microAlgos: bigint
  /** Account status (0 = offline, 1 = online, 2 = not participating). */
  status: number
  /** Auth address (rekey target). */
  authAddress?: string
  /** Reward microAlgos earned (lifetime). */
  rewardedMicroAlgos: bigint
  /** Number of assets opted into. */
  totalAssets: number
  /** Number of asset params (assets created). */
  totalAssetParams: number
  /** Number of app local states (apps opted in to). */
  totalAppLocalStates: number
  /** Number of app params (apps created). */
  totalAppParams: number
  /** Total box bytes. */
  totalBoxBytes: number
  /** Total number of boxes. */
  totalBoxes: number
  /** Total extra app pages. */
  totalExtraAppPages: number
  /** Whether the account is incentive eligible. */
  incentiveEligible?: boolean
  /** Last proposed round. */
  lastProposed?: bigint
  /** Last heartbeat round. */
  lastHeartbeat?: bigint
}

/** A delta for a single account. */
export interface AccountDelta {
  /** Address. */
  address: string
  /** New account state (after the round). */
  account: AccountState
}

/** A creatable created or destroyed in this round. */
export interface CreatableDelta {
  /** Numeric ID. */
  id: bigint
  /** 0 = asset, 1 = app. */
  type: 'app' | 'asset'
  /** Whether the creatable was created (true) or destroyed (false). */
  created: boolean
  /** Creator address. */
  creator: string
}

/** Block header information from the delta. */
export interface DeltaBlockHeader {
  /** Round number. */
  round: bigint
  /** Block timestamp (unix seconds). */
  timestamp: number
  /** Genesis ID. */
  genesisId?: string
  /** Protocol upgrade. */
  protocol?: string
  /** Fee sink. */
  feeSink?: string
  /** Rewards pool. */
  rewardsPool?: string
  /** Raw header (any additional fields). */
  raw: Record<string, unknown>
}

/** Ledger totals after the round. */
export interface LedgerTotals {
  /** Online totals. */
  online: { microAlgos: bigint; rewards: bigint }
  /** Offline totals. */
  offline: { microAlgos: bigint; rewards: bigint }
  /** Not-participating totals. */
  notParticipating: { microAlgos: bigint; rewards?: bigint }
}

/** A transaction id contained in this round. */
export interface TxidEntry {
  /** Base32 transaction id. */
  txid: string
  /** Index of the transaction within the block. */
  intra: number
  /** Last valid round. */
  lastValid: bigint
}

/** A fully resolved ledger delta for a single round. */
export interface LedgerDelta {
  /** Round number. */
  round: bigint
  /** Block header info. */
  header: DeltaBlockHeader
  /** Ledger totals after the round. */
  totals?: LedgerTotals
  /** Per-account state, keyed by address. */
  accounts: Record<string, AccountDelta>
  /** Per-app, per-account resource changes (keyed by appId then address). */
  appResources: Record<string, Record<string, AppResourceDelta>>
  /** Per-asset, per-account resource changes (keyed by assetId then address). */
  assetResources: Record<string, Record<string, AssetResourceDelta>>
  /** Box (KV) changes for apps, keyed by appId then base64(name). */
  boxes: Record<string, Record<string, BoxDelta>>
  /** Other (non-box) KV mods, keyed by base64(key). */
  kvMods: Record<string, { previousValue?: Uint8Array; nextValue?: Uint8Array; action: ValueAction }>
  /** Creatables created or destroyed, keyed by creatable id. */
  creatables: Record<string, CreatableDelta>
  /** Transaction ids contained in this round, keyed by base32 txid. */
  txids: Record<string, TxidEntry>
  /** The previous round's timestamp. */
  previousTimestamp?: number
  /** The unparsed raw delta, in case advanced consumers need extra fields. */
  raw: Record<string, unknown>
}

/** A helper class to interact with a {@link LedgerDelta}. */
export interface LedgerDeltaObserver {
  /** The fully resolved ledger delta. */
  delta: LedgerDelta
  /** The round number. */
  round: bigint
  /**
   * Get the global state changes for an app in this round.
   * Returns a map from key string to a delta containing the new value (only the new value is exposed,
   * because the algod ledger delta endpoint returns the resolved post-round state for global state).
   */
  getGlobalState(appId: bigint | number): Record<string, TealValue>
  /**
   * Get the local state for an app + account in this round.
   */
  getLocalState(appId: bigint | number, address: string): Record<string, TealValue> | undefined
  /**
   * Get the box changes for an app in this round (with previous and next values).
   */
  getBoxChanges(appId: bigint | number): Record<string, BoxDelta>
  /**
   * Get the new account state for an address.
   */
  getAccount(address: string): AccountState | undefined
  /**
   * Get the new app params if changed in this round.
   */
  getApp(appId: bigint | number): AppParams | undefined
  /**
   * Get the new asset params if changed in this round.
   */
  getAsset(assetId: bigint | number): AssetParams | undefined
  /**
   * Get an asset holding for `address` if changed in this round.
   */
  getAssetHolding(assetId: bigint | number, address: string): AssetHolding | undefined
  /**
   * Whether the given app was created in this round.
   */
  isAppCreated(appId: bigint | number): boolean
  /**
   * Whether the given app was destroyed in this round.
   */
  isAppDestroyed(appId: bigint | number): boolean
  /**
   * Whether the given asset was created in this round.
   */
  isAssetCreated(assetId: bigint | number): boolean
  /**
   * Whether the given asset was destroyed in this round.
   */
  isAssetDestroyed(assetId: bigint | number): boolean
  /**
   * Get the list of base32 transaction ids in this round.
   */
  getTransactionIds(): string[]
  /**
   * Returns the list of app ids that had any change in this round (creator-side params or any opted-in account local state).
   */
  getChangedAppIds(): bigint[]
  /**
   * Returns the list of asset ids that had any change in this round.
   */
  getChangedAssetIds(): bigint[]
  /**
   * Returns the list of account addresses that had any change in this round.
   */
  getChangedAccounts(): string[]
}
