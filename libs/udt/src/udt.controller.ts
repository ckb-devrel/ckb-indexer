import {
  assert,
  asyncMap,
  asyncSome,
  Chain,
  parseSortableInt,
  RpcError,
  ScriptMode,
  TokenBalance,
  TokenInfo,
} from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get, Query } from "@nestjs/common";
import { UdtService } from "./udt.service";

@Controller()
export class UdtController {
  constructor(private readonly service: UdtService) {}

  async udtBalanceToTokenBalance(
    udtBalance: UdtBalance,
  ): Promise<TokenBalance> {
    const { udtInfo } = assert(
      await this.service.getTokenInfo(udtBalance.tokenHash),
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

  @Get("/getTokenInfo")
  async getTokenInfo(
    @Query()
    tokenId: string,
  ): Promise<TokenInfo> {
    const { udtInfo, tx, block } = assert(
      await this.service.getTokenInfo(tokenId, true),
      RpcError.TokenNotFound,
    );
    const issueTx = assert(tx, RpcError.TxNotFound);
    const issueBlock = assert(block, RpcError.BlockNotFound);
    const holderCount = await this.service.getTokenHoldersCount(tokenId);
    const rgbppIssue = await asyncSome(issueTx.outputs, async (output) => {
      return (await this.service.scriptMode(output.lock)) === ScriptMode.Rgbpp;
    });
    const oneTimeIssue = await asyncSome(issueTx.outputs, async (output) => {
      return (
        (await this.service.scriptMode(output.lock)) ===
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
      issueTxHeight: parseSortableInt(issueBlock.height),
      issueTime: issueBlock.timestamp,
    };
  }

  @Get("/getTokenBalances")
  async getTokenBalances(
    address: string,
    tokenId?: string,
  ): Promise<TokenBalance[]> {
    const udtBalances = await this.service.getTokenBalance(address, tokenId);
    return await asyncMap(udtBalances, this.udtBalanceToTokenBalance);
  }

  @Get("/getTokenHolders")
  async getTokenHolders(tokenId: string): Promise<TokenBalance[]> {
    const udtBalances = await this.service.getTokenAllBalances(tokenId);
    return await asyncMap(udtBalances, this.udtBalanceToTokenBalance);
  }
}
