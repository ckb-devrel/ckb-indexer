import {
  ApiError,
  assert,
  asyncMap,
  Chain,
  extractIsomorphicInfo,
  IsomorphicBinding,
  PagedTokenResult,
  RpcError,
  ScriptMode,
  TokenCell,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { CellService } from "./cell.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

@Controller()
export class CellController {
  constructor(private readonly service: CellService) {}

  async cellToTokenCell(
    cell: ccc.Cell,
    spender?: ccc.OutPoint,
  ): Promise<TokenCell> {
    const address = await this.service.scriptToAddress(cell.cellOutput.lock);
    const lockScriptMode = await this.service.scriptMode(cell.cellOutput.lock);
    const isomorphicInfo = extractIsomorphicInfo(cell.cellOutput.lock);
    let isomorphicBinding: IsomorphicBinding | undefined = undefined;
    if (isomorphicInfo) {
      switch (lockScriptMode) {
        case ScriptMode.RgbppBtc: {
          isomorphicBinding = {
            chain: Chain.Btc,
            txHash: ccc.hexFrom(isomorphicInfo.txHash),
            index: Number(isomorphicInfo.index),
          };
          break;
        }
        case ScriptMode.RgbppDoge: {
          isomorphicBinding = {
            chain: Chain.Doge,
            txHash: ccc.hexFrom(isomorphicInfo.txHash),
            index: Number(isomorphicInfo.index),
          };
          break;
        }
      }
    }
    const typeScript = assert(cell.cellOutput.type, RpcError.CellNotAsset);
    const typeScriptType = await this.service.scriptMode(typeScript);
    return {
      txId: cell.outPoint.txHash,
      vout: Number(cell.outPoint.index),
      lockScript: {
        ...cell.cellOutput.lock,
        codeHashType: lockScriptMode,
      },
      typeScript: {
        ...typeScript,
        codeHashType: typeScriptType,
      },
      ownerAddress: address,
      capacity: ccc.numFrom(cell.cellOutput.capacity),
      data: cell.outputData,
      tokenAmount:
        typeScriptType === ScriptMode.Udt
          ? ccc.udtBalanceFrom(cell.outputData)
          : undefined,
      spent: spender !== undefined,
      spenderTx: spender ? spender.txHash : undefined,
      inputIndex: spender ? Number(spender.index) : undefined,
      rgbppBinding: isomorphicBinding,
    };
  }

  @ApiOkResponse({
    type: TokenCell,
    description: "Get an on-chain cell by CKB OutPoint",
  })
  @Get("/cells/by-outpoint/:txHash/:index")
  async getCellByOutpoint(
    @Param("txHash") txHash: string,
    @Param("index") index: number,
  ): Promise<TokenCell | ApiError> {
    try {
      const { cell, spender } = assert(
        await this.service.getCellByOutpoint(txHash, index),
        RpcError.CkbCellNotFound,
      );
      assert(cell.cellOutput.type, RpcError.CellNotAsset);
      return await this.cellToTokenCell(cell, spender);
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }

  @ApiOkResponse({
    type: TokenCell,
    description: "Get an on-chain cell by isomorphic UTXO",
  })
  @Get("/cells/by-isomorphic/:btcTxHash/:index")
  async getIsomorphicCellByUtxo(
    @Param("btcTxHash") btcTxHash: string,
    @Param("index") index: number,
  ): Promise<TokenCell | ApiError> {
    try {
      const { cell, spender } = assert(
        await this.service.getRgbppCellByUtxo(btcTxHash, index),
        RpcError.RgbppCellNotFound,
      );
      assert(cell.cellOutput.type, RpcError.CellNotAsset);
      return await this.cellToTokenCell(cell, spender);
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }

  @ApiOkResponse({
    type: [TokenCell],
    description: "Get paged tokens under a user CKB address",
  })
  @ApiQuery({
    name: "cursor",
    required: false,
  })
  @ApiQuery({
    name: "limit",
    required: false,
  })
  @Get("/cells/:tokenId/:address")
  async getUserTokenCells(
    @Param("tokenId") tokenId: string,
    @Param("address") address: string,
    @Query("limit") limit?: number,
    @Query("cursor") cursor?: string,
  ): Promise<PagedTokenResult> {
    const { cells, cursor: lastCursor } =
      await this.service.getPagedTokenCellsByCursor(
        tokenId,
        address,
        limit ?? 10,
        cursor,
      );
    return {
      cells: await asyncMap(cells, this.cellToTokenCell),
      cursor: lastCursor,
    };
  }
}
