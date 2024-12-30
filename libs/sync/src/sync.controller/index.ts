import { assert, asyncMap, asyncSome, RpcError } from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get, Query } from "@nestjs/common";
import { ScriptMode, SyncAgent } from "../sync.agent";
import {
  BlockHeader,
  Chain,
  TokenBalance,
  TokenCell,
  TokenInfo,
  TrackerInfo,
} from "./restTypes";

@Controller()
export class SyncController {
  constructor(private readonly syncAgent: SyncAgent) {}

  async udtBalanceToTokenBalance(
    udtBalance: UdtBalance,
  ): Promise<TokenBalance> {
    const { udtInfo } = assert(
      await this.syncAgent.getTokenInfo(udtBalance.tokenHash),
      RpcError.TokenNotFound,
    );
    return {
      tokenId: ccc.hexFrom(udtBalance.tokenHash),
      name: udtInfo.name ?? undefined,
      symbol: udtInfo.symbol ?? undefined,
      decimal: udtInfo.decimals ?? undefined,
      address: udtBalance.address,
      balance: ccc.numFrom(udtBalance.balance),
    };
  }

  async cellToTokenCell(
    cell: ccc.Cell,
    spenderTx?: ccc.Hex,
  ): Promise<TokenCell> {
    const { address, btc } = await this.syncAgent.scriptToAddress(
      cell.cellOutput.lock,
    );
    return {
      txId: cell.outPoint.txHash,
      vout: Number(cell.outPoint.index),
      lockScript: {
        ...cell.cellOutput.lock,
        codeHashType: await this.syncAgent.parseScriptMode(
          cell.cellOutput.lock,
        ),
      },
      typeScript: {
        ...cell.cellOutput.type!,
        codeHashType: await this.syncAgent.parseScriptMode(
          cell.cellOutput.type!,
        ),
      },
      ownerAddress: address,
      capacity: ccc.numFrom(cell.cellOutput.capacity),
      data: cell.outputData,
      spent: spenderTx !== undefined,
      spenderTx,
      isomorphicBtcTx: btc ? ccc.hexFrom(btc.txId) : undefined,
      isomorphicBtcTxVout: btc ? btc.outIndex : undefined,
    };
  }

  @Get("/getTrackerInfo")
  async getTrackerInfo(): Promise<TrackerInfo> {
    const dbTip = assert(
      await this.syncAgent.getBlockHeader({
        fromDb: false,
      }),
      RpcError.BlockNotFound,
    );
    const nodeTip = assert(
      await this.syncAgent.getBlockHeader({
        fromDb: true,
      }),
      RpcError.BlockNotFound,
    );
    return {
      trackerBlockHeight: dbTip.height,
      trackerBestBlockHash: dbTip.hash,
      nodeBlockHeight: nodeTip.height,
      nodeBestBlockHash: nodeTip.hash,
    };
  }

  @Get("/getTokenInfo")
  async getTokenInfo(
    @Query()
    tokenId: string,
  ): Promise<TokenInfo> {
    const { udtInfo, tx, block } = assert(
      await this.syncAgent.getTokenInfo(tokenId, true),
      RpcError.TokenNotFound,
    );
    const issueTx = assert(tx, RpcError.TxNotFound);
    const issueBlock = assert(block, RpcError.BlockNotFound);
    const holderCount = await this.syncAgent.getTokenHoldersCount(tokenId);
    const rgbppIssue = await asyncSome(issueTx.outputs, async (output) => {
      return (
        (await this.syncAgent.parseScriptMode(output.lock)) === ScriptMode.Rgbpp
      );
    });
    const oneTimeIssue = await asyncSome(issueTx.outputs, async (output) => {
      return (
        (await this.syncAgent.parseScriptMode(output.lock)) ===
        ScriptMode.SingleUseLock
      );
    });
    return {
      tokenId: ccc.hexFrom(udtInfo.hash),
      name: udtInfo.name ?? undefined,
      symbol: udtInfo.symbol ?? undefined,
      decimal: udtInfo.decimals ?? undefined,
      owner: udtInfo.owner ?? undefined,
      totalAmount: ccc.numFrom(udtInfo.totalSupply),
      mintable: !rgbppIssue && !oneTimeIssue,
      holderCount: ccc.numFrom(holderCount),
      rgbppTag: rgbppIssue,
      issueChain: rgbppIssue ? Chain.Btc : Chain.Ckb,
      issueTxId: ccc.hexFrom(udtInfo.firstIssuanceTxHash),
      issueTxHeight: issueBlock.height,
      issueTime: issueBlock.timestamp,
    };
  }

  @Get("/getTokenBalances")
  async getTokenBalances(
    address: string,
    tokenId?: string,
  ): Promise<TokenBalance[]> {
    const udtBalances = await this.syncAgent.getTokenBalance(address, tokenId);
    return await asyncMap(udtBalances, this.udtBalanceToTokenBalance);
  }

  @Get("/getCellByOutpoint")
  async getCellByOutpoint(txHash: string, index: number): Promise<TokenCell> {
    const { cell, spentTx } = assert(
      await this.syncAgent.getCellByOutpoint(txHash, index),
      RpcError.CkbCellNotFound,
    );
    assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return await this.cellToTokenCell(cell, spentTx);
  }

  @Get("/getLatestBlock")
  async getLatestBlock(): Promise<BlockHeader> {
    const tipHeader = assert(
      await this.syncAgent.getBlockHeader({
        fromDb: false,
      }),
      RpcError.BlockNotFound,
    );
    return {
      preHash: tipHeader.parentHash,
      ...tipHeader,
    };
  }

  @Get("/getBlockHeaderByNumber")
  async getBlockHeaderByNumber(blockNumber: number): Promise<BlockHeader> {
    const blockHeader = await this.syncAgent.getBlockHeader({
      blockNumber,
      fromDb: false,
    });
    assert(blockHeader, RpcError.BlockNotFound);
    return {
      preHash: blockHeader!.parentHash,
      ...blockHeader!,
    };
  }

  @Get("/getTokenHolders")
  async getTokenHolders(tokenId: string): Promise<TokenBalance[]> {
    const udtBalances = await this.syncAgent.getTokenAllBalances(tokenId);
    return await asyncMap(udtBalances, this.udtBalanceToTokenBalance);
  }

  @Get("/getIsomorphicCellByUtxo")
  async getIsomorphicCellByUtxo(
    btcTxHash: string,
    index: number,
  ): Promise<TokenCell> {
    const { cell, spentTx } = assert(
      await this.syncAgent.getRgbppCellByUtxo(btcTxHash, index),
      RpcError.RgbppCellNotFound,
    );
    assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return await this.cellToTokenCell(cell, spentTx);
  }
}
