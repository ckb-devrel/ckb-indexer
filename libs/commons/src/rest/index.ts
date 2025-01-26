import { ccc } from "@ckb-ccc/shell";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum Chain {
  Ckb = "ckb",
  Btc = "btc",
  Doge = "doge",
}

export enum ScriptMode {
  RgbppBtc = "rgbppBtc",
  RgbppDoge = "rgbppDoge",
  RgbppBtcTimelock = "rgbppBtcTimelock",
  RgbppDogeTimelock = "rgbppDogeTimelock",
  SingleUseLock = "singleUseLock",
  OmniLock = "omniLock",
  Udt = "udt",
  Spore = "spore",
  Cluster = "cluster",
  Acp = "acp",
  Secp256k1 = "secp256k1",
  JoyId = "joyId",
  UniqueType = "uniqueType",
  Unknown = "unknown",
}

enum ApiHashType {
  Data = "data",
  Type = "type",
  Data1 = "data1",
  Data2 = "data2",
}

export enum LeapType {
  None = 0,
  FromUtxo = 1,
  ToUtxo = 2,
}

export class NormalizedReturn<T> {
  code: number;
  msg?: string;
  data?: T;
}

export class CellScript {
  @ApiProperty({ type: String })
  codeHash: ccc.Hex;
  @ApiProperty({ enum: ApiHashType })
  hashType: ccc.HashType;
  @ApiProperty({ type: String })
  args: ccc.Hex;
  @ApiPropertyOptional({ enum: ScriptMode })
  codeHashType?: ScriptMode;
}

export class TokenInfo {
  @ApiProperty({ type: String })
  tokenId: ccc.Hex;
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional()
  symbol?: string;
  @ApiPropertyOptional()
  decimal?: number;
  @ApiPropertyOptional()
  owner?: string;
  @ApiProperty({ type: Number })
  totalAmount: ccc.Num;
  @ApiProperty()
  mintable: boolean;
  @ApiProperty({ type: Number })
  holderCount: ccc.Num;
  @ApiProperty({ enum: Chain })
  issueChain: Chain;
  @ApiProperty({ type: String })
  issueTxId: ccc.Hex;
  @ApiProperty({ type: Number })
  issueTxHeight: ccc.Num;
  @ApiProperty()
  issueTime: number;
}

export class TokenBalance {
  @ApiProperty({ type: String })
  tokenId: ccc.Hex;
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional()
  symbol?: string;
  @ApiPropertyOptional()
  decimal?: number;
  @ApiProperty()
  address: string;
  @ApiProperty({ type: Number })
  balance: ccc.Num;
  @ApiProperty({ type: Number })
  height: ccc.Num;
}

export class BlockHeader {
  @ApiProperty({ type: Number })
  height: ccc.Num;
  @ApiProperty({ type: String })
  hash: ccc.Hex;
  @ApiProperty({ type: String })
  preHash: ccc.Hex;
  @ApiProperty()
  timestamp: number;
  @ApiProperty()
  version: number;
}

export class TrackerInfo {
  @ApiProperty({ type: Number })
  trackerBlockHeight: ccc.Num;
  @ApiProperty({ type: String })
  trackerBestBlockHash: ccc.Hex;
  @ApiProperty({ type: Number })
  nodeBlockHeight: ccc.Num;
  @ApiProperty({ type: String })
  nodeBestBlockHash: ccc.Hex;
}

export class ClusterData {
  @ApiProperty()
  name: string;
  @ApiProperty()
  description: string;
  @ApiProperty({ type: String })
  clusterId: ccc.Hex;
}

export class ClusterInfo {
  @ApiProperty()
  name: string;
  @ApiPropertyOptional()
  description?: string;
  @ApiProperty({ type: String })
  clusterId: ccc.Hex;
  @ApiProperty()
  owner: string;
  @ApiProperty()
  creator: string;
  @ApiProperty()
  itemCount: number;
  @ApiProperty()
  holderCount: number;
  @ApiProperty({ enum: Chain })
  issueChain: Chain;
  @ApiProperty({ type: String })
  issueTxId: ccc.Hex;
  @ApiProperty({ type: Number })
  issueTxHeight: ccc.Num;
  @ApiProperty()
  issueTime: number;
  @ApiProperty()
  rgbppTag: boolean;
}

export class SporeData {
  @ApiProperty({ type: String })
  tokenId: ccc.Hex;
  @ApiProperty()
  contentType: string;
  @ApiProperty()
  content: string;
  @ApiPropertyOptional()
  clusterId?: ccc.Hex;
}

export class NFTInfo {
  @ApiProperty({ type: String })
  tokenId: ccc.Hex;
  @ApiPropertyOptional({ type: String })
  clusterId?: ccc.Hex;
  @ApiPropertyOptional({ type: ClusterInfo })
  clusterInfo?: ClusterInfo;
  @ApiProperty()
  contentType: string;
  @ApiProperty()
  content: string;
  @ApiProperty()
  creator: string;
  @ApiPropertyOptional()
  owner?: string;
  @ApiPropertyOptional()
  dobDetails?: string;
  @ApiProperty({ type: String })
  createTxId: ccc.Hex;
  @ApiProperty()
  createTime: number;
}

export enum EventType {
  Issue = "issue",
  Mint = "mint",
  Transfer = "transfer",
  MintAndTransfer = "mint&transfer",
  Burn = "burn",
  BurnAndTransfer = "burn&transfer",
}

export class NFTData {
  @ApiPropertyOptional({ type: String })
  tokenId?: ccc.Hex;
  @ApiPropertyOptional()
  contentType?: string;
  @ApiPropertyOptional()
  content?: string;
  @ApiPropertyOptional({ type: String })
  clusterId?: ccc.Hex;
  @ApiPropertyOptional()
  clusterName?: string;
  @ApiPropertyOptional()
  clusterDescription?: string;
}

export class TokenData {
  @ApiProperty({ type: String })
  tokenId: ccc.Hex;
  @ApiProperty({ type: Number })
  amount: ccc.Num;
  @ApiProperty()
  mintable: boolean;
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional()
  symbol?: string;
  @ApiPropertyOptional()
  decimal?: number;
}

export class IsomorphicBinding {
  @ApiProperty({ enum: Chain })
  chain: Chain;
  @ApiProperty({ type: String })
  txHash: ccc.Hex;
  @ApiProperty({ type: Number })
  vout: number;
  @ApiProperty({ enum: LeapType })
  leapType: LeapType;
}

export class TxAssetCellDetail {
  @ApiProperty()
  index: number;
  @ApiProperty({ type: Number })
  capacity: ccc.Num;
  @ApiProperty({ enum: EventType })
  eventType: EventType;
  @ApiProperty()
  address: string;
  @ApiProperty({ enum: ScriptMode })
  typeCodeName: ScriptMode;
  @ApiPropertyOptional({ type: TokenData })
  tokenData?: TokenData;
  @ApiPropertyOptional({ type: NFTData })
  nftData?: NFTData;
  @ApiPropertyOptional({ type: IsomorphicBinding })
  rgbppBinding?: IsomorphicBinding;
}

export class TxAssetCellData {
  @ApiProperty({ type: String })
  txId: ccc.Hex;
  @ApiPropertyOptional({ type: String })
  blockHash?: ccc.Hex;
  @ApiPropertyOptional({ type: Number })
  blockHeight?: ccc.Num;
  @ApiProperty({ type: TxAssetCellDetail, isArray: true })
  inputs: TxAssetCellDetail[];
  @ApiProperty({ type: TxAssetCellDetail, isArray: true })
  outputs: TxAssetCellDetail[];
}

export class TokenCell {
  @ApiProperty({ type: String })
  txId: ccc.Hex;
  @ApiProperty()
  vout: number;
  @ApiProperty({ type: CellScript })
  lockScript: CellScript;
  @ApiProperty({ type: CellScript })
  typeScript: CellScript;
  @ApiProperty()
  ownerAddress: string;
  @ApiProperty({ type: Number })
  capacity: ccc.Num;
  @ApiProperty({ type: String })
  data: ccc.Hex;
  @ApiPropertyOptional({ type: Number })
  tokenAmount?: ccc.Num;
  @ApiProperty()
  spent: boolean;
  @ApiPropertyOptional({ type: String })
  spenderTx?: ccc.Hex;
  @ApiPropertyOptional()
  inputIndex?: number;
  @ApiPropertyOptional({ type: IsomorphicBinding })
  rgbppBinding?: IsomorphicBinding;
}

export class PagedTokenResult {
  @ApiProperty({ type: TokenCell, isArray: true })
  cells: TokenCell[];
  @ApiProperty()
  cursor: string;
}

export class TokenHolders {
  @ApiProperty()
  total: number;
  @ApiProperty({ type: TokenBalance, isArray: true })
  balances: TokenBalance[];
}
