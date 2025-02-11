import {
  ApiError,
  assert,
  asyncMap,
  Chain,
  extractIsomorphicInfo,
  IsomorphicBinding,
  LeapType,
  PagedTokenResult,
  RpcError,
  RpcResponse,
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

  async parseIsomorphicBinding(
    cell: ccc.Cell,
  ): Promise<IsomorphicBinding | undefined> {
    let isomorphicBinding: IsomorphicBinding | undefined = undefined;
    const lockScriptMode = await this.service.scriptMode(cell.cellOutput.lock);
    const tx = assert(
      await this.service.getTxByCell(cell),
      RpcError.TxNotFound,
    );
    // rgbpp lock related modes
    for (const { mode, chain } of [
      { mode: ScriptMode.RgbppBtc, chain: Chain.Btc },
      { mode: ScriptMode.RgbppDoge, chain: Chain.Doge },
    ]) {
      if (lockScriptMode === mode) {
        const isomorphicInfo = assert(
          extractIsomorphicInfo(cell.cellOutput.lock),
          RpcError.IsomorphicBindingNotFound,
        );
        const rgbppMode = await this.service.getScriptByModeFromTxInputs(
          tx,
          mode,
        );
        isomorphicBinding = {
          chain,
          txHash: ccc.hexFrom(isomorphicInfo.txHash),
          vout: Number(isomorphicInfo.index),
          leapType: rgbppMode ? LeapType.None : LeapType.ToUtxo,
        };
        break;
      }
    }
    // rgbpp timelock related modes
    for (const { mode, premode, chain } of [
      {
        mode: ScriptMode.RgbppBtcTimelock,
        premode: ScriptMode.RgbppBtc,
        chain: Chain.Btc,
      },
      {
        mode: ScriptMode.RgbppDogeTimelock,
        premode: ScriptMode.RgbppDoge,
        chain: Chain.Doge,
      },
    ]) {
      if (lockScriptMode === mode) {
        const rgbppScript = assert(
          await this.service.getScriptByModeFromTxInputs(tx, premode),
          RpcError.RgbppCellNotFound,
        );
        const isomorphicInfo = assert(
          extractIsomorphicInfo(rgbppScript),
          RpcError.IsomorphicBindingNotFound,
        );
        isomorphicBinding = {
          chain,
          txHash: ccc.hexFrom(isomorphicInfo.txHash),
          vout: Number(isomorphicInfo.index),
          leapType: LeapType.FromUtxo,
        };
        break;
      }
    }
    return isomorphicBinding;
  }

  async cellToTokenCell(
    cell: ccc.Cell,
    spender?: ccc.OutPoint,
  ): Promise<TokenCell> {
    const address = await this.service.scriptToAddress(cell.cellOutput.lock);
    const lockScriptMode = await this.service.scriptMode(cell.cellOutput.lock);
    const isomorphicBinding = await this.parseIsomorphicBinding(cell);
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
  @ApiQuery({
    name: "containSpender",
    required: false,
    description:
      "Whether to include the spender information of the cell, default is false (optional)",
  })
  @Get("/cells/by-outpoint/:txHash/:index")
  async getCellByOutpoint(
    @Param("txHash") txHash: string,
    @Param("index") index: number,
    @Query("containSpender") containSpender?: boolean,
  ): Promise<RpcResponse<TokenCell>> {
    try {
      const { cell, spender } = assert(
        await this.service.getCellByOutpoint(
          txHash,
          index,
          containSpender ?? false,
        ),
        RpcError.CkbCellNotFound,
      );
      assert(cell.cellOutput.type, RpcError.CellNotAsset);
      return {
        code: 0,
        data: await this.cellToTokenCell(cell, spender),
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
    type: TokenCell,
    description: "Get an on-chain cell by isomorphic UTXO",
  })
  @Get("/cells/by-isomorphic/:btcTxHash/:index")
  async getIsomorphicCellByUtxo(
    @Param("btcTxHash") btcTxHash: string,
    @Param("index") index: number,
  ): Promise<RpcResponse<TokenCell>> {
    try {
      const { cell, spender } = assert(
        await this.service.getRgbppCellByUtxo(btcTxHash, index),
        RpcError.RgbppCellNotFound,
      );
      assert(cell.cellOutput.type, RpcError.CellNotAsset);
      return {
        code: 0,
        data: await this.cellToTokenCell(cell, spender),
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
    type: [PagedTokenResult],
    description: "Get paged tokens under a user CKB address",
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    description: "The cursor of the last cell returned (optional)",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description:
      "The maximum number of tokens to return, or 10 as default value (optional)",
  })
  @Get("/cells/:tokenId/:address")
  async getUserTokenCells(
    @Param("tokenId") tokenId: string,
    @Param("address") address: string,
    @Query("limit") limit: number,
    @Query("cursor") cursor?: string,
  ): Promise<RpcResponse<PagedTokenResult>> {
    const { cells, cursor: lastCursor } =
      await this.service.getPagedTokenCellsByCursor(
        tokenId,
        address,
        isNaN(limit) ? 10 : limit,
        cursor,
      );
    return {
      code: 0,
      data: {
        cells: await asyncMap(cells, (cell) => {
          return this.cellToTokenCell(cell);
        }),
        cursor: lastCursor,
      },
    };
  }
}
