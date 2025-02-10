import {
  ApiError,
  assert,
  asyncMap,
  Chain,
  NormalizedReturn,
  parseSortableInt,
  RpcError,
  ScriptMode,
  TokenBalance,
  TokenHolders,
  TokenInfo,
} from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { UdtService } from "./udt.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

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
      balance: parseSortableInt(udtBalance.balance),
      height: parseSortableInt(udtBalance.updatedAtHeight),
    };
  }

  @ApiOkResponse({
    type: TokenInfo,
    description: "Get the information of a token by the tokenId",
  })
  @Get("/tokens/:tokenId")
  async getTokenInfo(
    @Param("tokenId") tokenId: string,
  ): Promise<NormalizedReturn<TokenInfo>> {
    try {
      const { udtInfo, tx, block } = assert(
        await this.service.getTokenInfo(tokenId, true),
        RpcError.TokenNotFound,
      );
      const issueTx = assert(tx, RpcError.TxNotFound);
      const issueBlock = assert(block, RpcError.BlockNotFound);
      const holderCount = await this.service.getTokenHoldersCount(tokenId);
      const lockScriptModes = await asyncMap(
        issueTx.outputs,
        async (output) => {
          return await this.service.scriptMode(output.lock);
        },
      );
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
      const unmintable = lockScriptModes.some(
        (mode) =>
          mode === ScriptMode.RgbppBtc ||
          mode === ScriptMode.RgbppDoge ||
          mode === ScriptMode.SingleUseLock,
      );
      return {
        code: 0,
        data: {
          tokenId: ccc.hexFrom(udtInfo.hash),
          name: udtInfo.name ?? undefined,
          symbol: udtInfo.symbol ?? undefined,
          decimal: udtInfo.decimals ?? undefined,
          owner: udtInfo.owner ?? undefined,
          totalAmount: parseSortableInt(udtInfo.totalSupply),
          mintable: !unmintable,
          holderCount: ccc.numFrom(holderCount),
          issueChain,
          issueTxId: ccc.hexFrom(udtInfo.firstIssuanceTxHash),
          issueTxHeight: parseSortableInt(issueBlock.height),
          issueTime: issueBlock.timestamp,
        },
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return {
          code: -1,
          msg: e.message,
        };
      }
      throw e;
    }
  }

  @ApiOkResponse({
    type: [TokenBalance],
    description:
      "Get detailed token balances of an address, filtered by tokenId if provided",
  })
  @ApiQuery({
    name: "tokenId",
    required: false,
    description: "The ID of the token to filter balances (optional)",
  })
  @ApiQuery({
    name: "height",
    required: false,
    description: "The height of the block to query (optional)",
  })
  @Get("/tokens/balances/:address")
  async getTokenBalances(
    @Param("address") address: string,
    @Query("tokenId") tokenId?: string,
    @Query("height") height?: number,
  ): Promise<NormalizedReturn<TokenBalance[]>> {
    const udtBalances = await this.service.getTokenBalanceByAddress(
      address,
      tokenId,
      height ? ccc.numFrom(height) : undefined,
    );
    if (udtBalances.length === 0) {
      return {
        code: -1,
        msg: "No token balances found",
      };
    }
    return {
      code: 0,
      data: await asyncMap(
        udtBalances,
        this.udtBalanceToTokenBalance.bind(this),
      ),
    };
  }

  @ApiOkResponse({
    type: [TokenBalance],
    description:
      "Get detailed token balances under a token id, filtered by addresses",
  })
  @ApiQuery({
    name: "height",
    required: false,
    description: "The height of the block to query (optional)",
  })
  @Get("/tokens/balances/:tokenId/:addresses")
  async batchGetTokenBalances(
    @Param("tokenId") tokenId: string,
    @Param("addresses") addresses: string,
    @Query("height") height?: number,
  ): Promise<NormalizedReturn<TokenBalance[]>> {
    const udtBalances = await this.service.getTokenBalanceByTokenId(
      tokenId,
      addresses.split(","),
      height ? ccc.numFrom(height) : undefined,
    );
    if (udtBalances.length === 0) {
      return {
        code: -1,
        msg: "No token balances found",
      };
    }
    return {
      code: 0,
      data: await asyncMap(
        udtBalances,
        this.udtBalanceToTokenBalance.bind(this),
      ),
    };
  }

  @ApiOkResponse({
    type: TokenHolders,
    description: "Filter all token holders by tokenId",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    description: "The offset of the first holder to return (optional)",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description:
      "The maximum number of holders to return, or 10 as default value (optional)",
  })
  @Get("/tokens/:tokenId/holders")
  async getTokenHolders(
    @Param("tokenId") tokenId: string,
    @Query("offset") offset: number,
    @Query("limit") limit: number,
  ): Promise<NormalizedReturn<TokenHolders>> {
    const udtBalances = await this.service.getTokenAllBalances(
      tokenId,
      isNaN(offset) ? 0 : offset,
      isNaN(limit) ? 10 : limit,
    );
    if (udtBalances.length === 0) {
      return {
        code: -1,
        msg: "No token balances found",
      };
    }
    const udtBalanceTotal = await this.service.getTokenHoldersCount(tokenId);
    return {
      code: 0,
      data: {
        total: udtBalanceTotal,
        list: await asyncMap(
          udtBalances,
          this.udtBalanceToTokenBalance.bind(this),
        ),
      },
    };
  }
}
