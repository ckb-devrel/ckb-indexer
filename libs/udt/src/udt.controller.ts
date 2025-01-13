import {
  assert,
  asyncMap,
  Chain,
  parseSortableInt,
  RpcError,
  ScriptMode,
  TokenBalance,
  TokenInfo,
} from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
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

  @ApiOkResponse({
    type: TokenInfo,
    description: "Get the information of a token by the tokenId",
  })
  @Get("/tokens/:tokenId")
  async getTokenInfo(@Param("tokenId") tokenId: string): Promise<TokenInfo> {
    const { udtInfo, tx, block } = assert(
      await this.service.getTokenInfo(tokenId, true),
      RpcError.TokenNotFound,
    );
    const issueTx = assert(tx, RpcError.TxNotFound);
    const issueBlock = assert(block, RpcError.BlockNotFound);
    const holderCount = await this.service.getTokenHoldersCount(tokenId);
    const lockScriptModes = await asyncMap(issueTx.outputs, async (output) => {
      return await this.service.scriptMode(output.lock);
    });
    let issueChain = Chain.Ckb;
    for (const mode of lockScriptModes) {
      if (mode === ScriptMode.RgbppBtc) {
        issueChain = Chain.Btc;
        break;
      }
      if (mode === ScriptMode.RgbppDoge) {
        issueChain = Chain.Doge;
        break;
      }
    }
    const mintable = lockScriptModes.some(
      (mode) =>
        mode !== ScriptMode.RgbppBtc &&
        mode !== ScriptMode.RgbppDoge &&
        mode !== ScriptMode.SingleUseLock,
    );
    return {
      tokenId: ccc.hexFrom(udtInfo.hash),
      name: udtInfo.name ?? undefined,
      symbol: udtInfo.symbol ?? undefined,
      decimal: udtInfo.decimals ?? undefined,
      owner: udtInfo.owner ?? undefined,
      totalAmount: ccc.numFrom(udtInfo.totalSupply),
      mintable,
      holderCount: ccc.numFrom(holderCount),
      issueChain,
      issueTxId: ccc.hexFrom(udtInfo.firstIssuanceTxHash),
      issueTxHeight: parseSortableInt(issueBlock.height),
      issueTime: issueBlock.timestamp,
    };
  }

  @ApiOkResponse({
    type: [TokenBalance],
    description:
      "Get detailed token balances of an address, filtered by tokenId if provided",
  })
  @Get("/tokens/balances/:address/:tokenId?")
  async getTokenBalances(
    @Param("address") address: string,
    @Param("tokenId") tokenId?: string,
  ): Promise<TokenBalance[]> {
    const udtBalances = await this.service.getTokenBalance(address, tokenId);
    return await asyncMap(udtBalances, this.udtBalanceToTokenBalance);
  }

  @ApiOkResponse({
    type: [TokenBalance],
    description: "Filter all token holders by tokenId",
  })
  @Get("/tokens/holders/:tokenId")
  async getTokenHolders(
    @Param("tokenId") tokenId: string,
  ): Promise<TokenBalance[]> {
    const udtBalances = await this.service.getTokenAllBalances(tokenId);
    return await asyncMap(udtBalances, this.udtBalanceToTokenBalance);
  }
}
