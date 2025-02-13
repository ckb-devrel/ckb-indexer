import {
  ApiError,
  assert,
  asyncMap,
  Chain,
  examineAddress,
  examineTokenId,
  parseSortableInt,
  RpcError,
  RpcResponse,
  ScriptMode,
  TokenBalance,
  TokenHolders,
  TokenInfo,
  UdtCelldep,
  UdtDepType,
} from "@app/commons";
import { UdtBalance, UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
} from "@nestjs/swagger";
import { UdtService } from "./udt.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

class BatchGetTokenBalancesDto {
  @ApiProperty({ description: "Token ID" })
  tokenId: string;

  @ApiProperty({
    isArray: true,
    description: "Array of addresses",
    type: String,
  })
  addresses: string[];

  @ApiPropertyOptional({
    description: "The height of the block to query",
  })
  height?: number;
}

@Controller()
export class UdtController {
  constructor(private readonly service: UdtService) {}

  udtBalanceToTokenBalance(
    udtBalance: UdtBalance,
    udtInfo: UdtInfo,
  ): TokenBalance {
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

  celldepToUdtCelldep(celldep: ccc.CellDep): UdtCelldep {
    return {
      outPoint: {
        txHash: ccc.hexFrom(celldep.outPoint.txHash),
        index: celldep.outPoint.index,
      },
      depType:
        celldep.depType === "code" ? UdtDepType.Code : UdtDepType.DepGroup,
    };
  }

  @ApiOkResponse({
    type: TokenInfo,
    description: "Get the information of a token by the tokenId",
  })
  @Get("/tokens/:tokenId")
  async getTokenInfo(
    @Param("tokenId") tokenId: string,
  ): Promise<RpcResponse<TokenInfo>> {
    try {
      assert(examineTokenId(tokenId), RpcError.InvalidTokenId);
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
      const celldep = await this.service.getUdtCelldep(
        udtInfo.typeCodeHash,
        udtInfo.typeHashType,
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
          celldep: celldep ? this.celldepToUdtCelldep(celldep) : undefined,
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
  ): Promise<RpcResponse<TokenBalance[]>> {
    try {
      assert(examineAddress(address), RpcError.InvalidAddress);
      assert(tokenId ? examineTokenId(tokenId) : true, RpcError.InvalidTokenId);
      const udtBalances = await this.service.getTokenBalanceByAddress(
        address,
        tokenId,
        height ? ccc.numFrom(height) : undefined,
      );
      const data: TokenBalance[] = [];
      const udtInfos: Record<string, UdtInfo> = {};
      for (const udtBalance of udtBalances) {
        let udtInfo = udtInfos[udtBalance.tokenHash];
        if (udtInfo === undefined) {
          const { udtInfo: newUdtInfo } = assert(
            await this.service.getTokenInfo(udtBalance.tokenHash),
            RpcError.TokenNotFound,
          );
          udtInfo = newUdtInfo;
          udtInfos[udtBalance.tokenHash] = udtInfo;
        }
        const token = this.udtBalanceToTokenBalance(udtBalance, udtInfo);
        data.push(token);
      }
      // Always response with 0 if tokenId is provided but no balance found
      if (tokenId && data.length === 0) {
        const { udtInfo } = assert(
          await this.service.getTokenInfo(tokenId),
          RpcError.TokenNotFound,
        );
        data.push({
          tokenId: ccc.hexFrom(tokenId),
          name: udtInfo.name ?? undefined,
          symbol: udtInfo.symbol ?? undefined,
          decimal: udtInfo.decimals ?? undefined,
          address,
          balance: 0n,
          height: await this.service.getTipBlockNumber(),
        });
      }
      return {
        code: 0,
        data,
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
      "Get detailed token balances under a token id, filtered by addresses",
  })
  @Post("/tokens/balances")
  async batchGetTokenBalances(
    @Body() dto: BatchGetTokenBalancesDto,
  ): Promise<RpcResponse<TokenBalance[]>> {
    try {
      assert(examineTokenId(dto.tokenId), RpcError.InvalidTokenId);
      assert(
        dto.addresses.every((address) => examineAddress(address)),
        RpcError.InvalidAddress,
      );
      const udtBalances = await this.service.getTokenBalanceByTokenId(
        dto.tokenId,
        dto.addresses,
        dto.height ? ccc.numFrom(dto.height) : undefined,
      );
      const { udtInfo } = assert(
        await this.service.getTokenInfo(dto.tokenId),
        RpcError.TokenNotFound,
      );
      const tokens = udtBalances.map((value) =>
        this.udtBalanceToTokenBalance(value, udtInfo),
      );
      // Mark missing addresses as 0 balance
      const tipBlockNumber = await this.service.getTipBlockNumber();
      dto.addresses.forEach((address) => {
        if (!tokens.some((value) => value.address === address)) {
          tokens.push({
            tokenId: ccc.hexFrom(udtInfo.hash),
            name: udtInfo.name ?? undefined,
            symbol: udtInfo.symbol ?? undefined,
            decimal: udtInfo.decimals ?? undefined,
            address,
            balance: 0n,
            height: tipBlockNumber,
          });
        }
      });
      return {
        code: 0,
        data: tokens,
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
  ): Promise<RpcResponse<TokenHolders>> {
    try {
      assert(examineTokenId(tokenId), RpcError.InvalidTokenId);
      const udtBalances = await this.service.getTokenAllBalances(
        tokenId,
        isNaN(offset) ? 0 : offset,
        isNaN(limit) ? 10 : limit,
      );
      const udtBalanceTotal = await this.service.getTokenHoldersCount(tokenId);
      const { udtInfo } = assert(
        await this.service.getTokenInfo(tokenId),
        RpcError.TokenNotFound,
      );
      return {
        code: 0,
        data: {
          total: udtBalanceTotal,
          list: udtBalances.map((value) =>
            this.udtBalanceToTokenBalance(value, udtInfo),
          ),
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
}
