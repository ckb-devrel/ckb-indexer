import {
  assert,
  asyncMap,
  RgbppLockArgs,
  RpcError,
  ScriptMode,
  TokenCell,
} from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { CellService } from "./cell.service";

@Controller()
export class CellController {
  constructor(private readonly service: CellService) {}

  async cellToTokenCell(
    cell: ccc.Cell,
    spender?: ccc.OutPoint,
  ): Promise<TokenCell> {
    const address = await this.service.scriptToAddress(cell.cellOutput.lock);
    const btc = (() => {
      try {
        return RgbppLockArgs.decode(cell.cellOutput.lock.args);
      } catch (err) {
        return undefined;
      }
    })();
    const typeScript = assert(cell.cellOutput.type, RpcError.CellNotAsset);
    const typeScriptType = await this.service.scriptMode(typeScript);
    return {
      txId: cell.outPoint.txHash,
      vout: Number(cell.outPoint.index),
      lockScript: {
        ...cell.cellOutput.lock,
        codeHashType: await this.service.scriptMode(cell.cellOutput.lock),
      },
      typeScript: {
        ...typeScript,
        codeHashType: typeScriptType,
      },
      ownerAddress: address,
      capacity: ccc.numFrom(cell.cellOutput.capacity),
      data: cell.outputData,
      tokenAmount:
        typeScriptType === ScriptMode.Xudt
          ? ccc.udtBalanceFrom(cell.outputData)
          : undefined,
      spent: spender !== undefined,
      spenderTx: spender ? spender.txHash : undefined,
      inputIndex: spender ? Number(spender.index) : undefined,
      isomorphicBtcTx: btc ? ccc.hexFrom(btc.txId) : undefined,
      isomorphicBtcTxVout: btc ? btc.outIndex : undefined,
    };
  }

  @ApiOkResponse({
    type: TokenCell,
    description: "Get an on-chain cell by CKB OutPoint",
  })
  @Get("/getCellByOutpoint")
  async getCellByOutpoint(
    @Param("txHash") txHash: string,
    @Param("index") index: number,
  ): Promise<TokenCell> {
    const { cell, spender } = assert(
      await this.service.getCellByOutpoint(txHash, index),
      RpcError.CkbCellNotFound,
    );
    assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return await this.cellToTokenCell(cell, spender);
  }

  @ApiOkResponse({
    type: TokenCell,
    description: "Get an on-chain cell by isomorphic UTXO",
  })
  @Get("/getIsomorphicCellByUtxo")
  async getIsomorphicCellByUtxo(
    @Param("btcTxHash") btcTxHash: string,
    @Param("index") index: number,
  ): Promise<TokenCell> {
    const { cell, spender } = assert(
      await this.service.getRgbppCellByUtxo(btcTxHash, index),
      RpcError.RgbppCellNotFound,
    );
    assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return await this.cellToTokenCell(cell, spender);
  }

  @ApiOkResponse({
    type: [TokenCell],
    description: "Get paged tokens under a user CKB address",
  })
  @Get("/getUserTokenCells")
  async getUserTokenCells(
    @Param("tokenId") tokenId: string,
    @Param("address") address: string,
    @Param("offset") offset: number,
    @Param("limit") limit: number,
  ): Promise<TokenCell[]> {
    const pagedCells = await this.service.getPagedTokenCells(
      tokenId,
      address,
      offset,
      limit,
    );
    return await asyncMap(pagedCells, this.cellToTokenCell);
  }
}
