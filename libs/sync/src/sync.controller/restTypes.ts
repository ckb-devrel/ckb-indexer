import { ccc } from "@ckb-ccc/core";

export enum RpcError {
  TokenNotFound,
  TxNotFound,
  BlockNotFound,
}

export const RpcErrorMessage: Record<RpcError, string> = {
  [RpcError.TokenNotFound]: "Token not found",
  [RpcError.TxNotFound]: "Tx not found",
  [RpcError.BlockNotFound]: "Block not found",
};

export enum Chain {
  Ckb = "ckb",
  Btc = "btc",
}

export interface CellScript {
  codeHash: ccc.Hex;
  hashType: ccc.HashType;
  args: ccc.Hex;
  codeHashType?: "xUDT" | "Spore";
}

export interface TokenData {
  tokenId: ccc.Hex;
  name?: string;
  symbol?: string;
  decimal?: ccc.Num;
  owner?: string;
}

export interface TokenInfo {
  tokenId: ccc.Hex;
  name?: string;
  symbol?: string;
  decimal?: number;
  owner?: string;
  totalAmount?: ccc.Num;
  supplyLimit: ccc.Num;
  mintable: boolean;
  holderCount: ccc.Num;
  rgbppTag: boolean;
  issueChain: Chain;
  issueTxId: ccc.Hex;
  issueTxHeight: ccc.Num;
  issueTime: ccc.Num;
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
  vout: ccc.Num;
  lockScript: CellScript;
  typeScript: CellScript;
  ownerAddress: string;
  capacity: ccc.Num;
  data: ccc.Hex;
  spent: boolean;
  spenderTx?: ccc.Hex;
  isomorphicBtcTx?: ccc.Hex;
  isomorphicBtcTxVout?: ccc.Num;
}

export interface BlockHeader {
  number: ccc.Num;
  hash: ccc.Hex;
  preHash: ccc.Hex;
  timestamp: ccc.Num;
  version: ccc.Num;
}

export interface TrackerInfo {
  trackerBlockHeight: ccc.Num;
  trackerBestBlockHash: ccc.Hex;
  nodeBlockHeight: ccc.Num;
  nodeBestBlockHash: ccc.Hex;
  latestBlockHeight: ccc.Num;
}

export interface ClusterData {
  name: string;
  description: string;
  clusterId: ccc.Hex;
}

export interface ClusterInfo {
  name: string;
  description: string;
  clusterType: "public" | "private";
  clusterId: ccc.Hex;
  owner: string;
  itemsCount: ccc.Num;
  holderCount: ccc.Num;
  issueChain: Chain;
  issueTxId: ccc.Hex;
  issueTxHeight: ccc.Num;
  issueTime: ccc.Num;
  rgbppTag: boolean;
}

export interface NFTData {
  tokenId: ccc.Hex;
  clusterId: ccc.Hex;
  contentType: string;
  content: string;
}

export interface NFTInfo {
  tokenId: ccc.Hex;
  clusterId: ccc.Hex;
  protocol: "spore";
  clusterInfo: ClusterInfo;
  contentType: string;
  content: string;
  creator: string;
  owner: string;
  dobDetails: string;
  createTxId: ccc.Hex;
  createTime: ccc.Num;
}

export interface AssetTxData {
  txId: ccc.Hex;
  blockHash: ccc.Hex;
  blockHeight: ccc.Num;
  tokenInfos: TokenData[];
  clusterInfos: ClusterData[];
  sporeInfos: NFTData[];
  inputs: TokenCell[];
  outputs: TokenCell[];
}
