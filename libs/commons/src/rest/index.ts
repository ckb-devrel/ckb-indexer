import { ccc } from "@ckb-ccc/core";

export enum Chain {
  Ckb = "ckb",
  Btc = "btc",
}

export enum ScriptMode {
  Rgbpp,
  SingleUseLock,
  Xudt,
  Spore,
  Cluster,
  Acp,
  Secp256k1,
  JoyId,
  Unknown,
}

export interface CellScript {
  codeHash: ccc.Hex;
  hashType: ccc.HashType;
  args: ccc.Hex;
  codeHashType?: ScriptMode;
}

export interface TokenData {
  tokenId: ccc.Hex;
  name?: string;
  symbol?: string;
  decimal?: number;
  owner?: string;
}

export interface TokenInfo {
  tokenId: ccc.Hex;
  name?: string;
  symbol?: string;
  decimal?: number;
  owner?: string;
  totalAmount: ccc.Num;
  mintable: boolean;
  holderCount: ccc.Num;
  rgbppTag: boolean;
  issueChain: Chain;
  issueTxId: ccc.Hex;
  issueTxHeight: ccc.Num;
  issueTime: number;
}

export interface TokenBalance {
  tokenId: ccc.Hex;
  name?: string;
  symbol?: string;
  decimal?: number;
  address: string;
  balance: ccc.Num;
}

export interface TokenCell {
  txId: ccc.Hex;
  vout: number;
  lockScript: CellScript;
  typeScript: CellScript;
  ownerAddress: string;
  capacity: ccc.Num;
  data: ccc.Hex;
  spent: boolean;
  spenderTx?: ccc.Hex;
  inputIndex?: number;
  isomorphicBtcTx?: ccc.Hex;
  isomorphicBtcTxVout?: number;
}

export interface BlockHeader {
  height: ccc.Num;
  hash: ccc.Hex;
  preHash: ccc.Hex;
  timestamp: number;
  version: number;
}

export interface TrackerInfo {
  trackerBlockHeight: ccc.Num;
  trackerBestBlockHash: ccc.Hex;
  nodeBlockHeight: ccc.Num;
  nodeBestBlockHash: ccc.Hex;
}

export interface ClusterData {
  name: string;
  description: string;
  clusterId: ccc.Hex;
}

export interface ClusterInfo {
  name: string;
  description?: string;
  clusterType: "public" | "private";
  clusterId: ccc.Hex;
  owner: string;
  creator: string;
  itemsCount: number;
  holdersCount: number;
  issueChain: Chain;
  issueTxId: ccc.Hex;
  issueTxHeight: ccc.Num;
  issueTime: number;
  rgbppTag: boolean;
}

export interface SporeData {
  tokenId: ccc.Hex;
  contentType: string;
  content: string;
  clusterId?: ccc.Hex;
}

export interface NFTInfo {
  tokenId: ccc.Hex;
  clusterId?: ccc.Hex;
  protocol: "spore";
  clusterInfo?: ClusterInfo;
  contentType: string;
  content: string;
  creator: string;
  owner?: string;
  dobDetails?: string;
  createTxId: ccc.Hex;
  createTime: number;
}

export interface AssetTxData {
  txId: ccc.Hex;
  blockHash?: ccc.Hex;
  blockHeight?: ccc.Num;
  tokenInfos: TokenData[];
  clusterInfos: ClusterData[];
  sporeInfos: SporeData[];
  inputs: TokenCell[];
  outputs: TokenCell[];
}

export enum EventType {
  Mint,
  Transfer,
  MintAndTransfer,
  Burn,
  BurnAndTransfer,
}

export interface TxAssetCellData {
  txId: ccc.Hex;
  blockHash?: ccc.Hex;
  blockHeight?: ccc.Num;
  inputs: TxAssetCellDetail[];
  outputs: TxAssetCellDetail[];
}

export interface TxAssetCellDetail {
  index: number;
  capacity: ccc.Num;
  eventType: EventType;
  address: string;
  typeScriptType: ScriptMode;
  tokenData?: TokenData;
  nftData?: NftData;
  isomorphicBtcTx?: ccc.Hex;
  isomorphicBtcTxVout?: number;
}

export interface NftData {
  tokenId: ccc.Hex;
  contentType?: string;
  content?: string;
  clusterName?: string;
  clusterDescription?: string;
}
