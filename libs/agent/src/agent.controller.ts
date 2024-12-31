import { assert, BlockHeader, RpcError, TokenCell } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get } from "@nestjs/common";
import { AgentService } from "./agent.service";

@Controller()
export class AgentController {
  constructor(private readonly service: AgentService) {}

  async cellToTokenCell(
    cell: ccc.Cell,
    spenderTx?: ccc.Hex,
  ): Promise<TokenCell> {
    const { address, btc } = await this.service.scriptToAddress(
      cell.cellOutput.lock,
    );
    return {
      txId: cell.outPoint.txHash,
      vout: Number(cell.outPoint.index),
      lockScript: {
        ...cell.cellOutput.lock,
        codeHashType: await this.service.parseScriptMode(cell.cellOutput.lock),
      },
      typeScript: {
        ...cell.cellOutput.type!,
        codeHashType: await this.service.parseScriptMode(cell.cellOutput.type!),
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

  @Get("/getCellByOutpoint")
  async getCellByOutpoint(txHash: string, index: number): Promise<TokenCell> {
    const { cell, spentTx } = assert(
      await this.service.getCellByOutpoint(txHash, index),
      RpcError.CkbCellNotFound,
    );
    assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return await this.cellToTokenCell(cell, spentTx);
  }

  @Get("/getLatestBlock")
  async getLatestBlock(): Promise<BlockHeader> {
    const tipHeader = assert(
      await this.service.getBlockHeader({
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
    const blockHeader = assert(
      await this.service.getBlockHeader({
        blockNumber,
        fromDb: false,
      }),
      RpcError.BlockNotFound,
    );
    return {
      preHash: blockHeader.parentHash,
      ...blockHeader,
    };
  }

  @Get("/getIsomorphicCellByUtxo")
  async getIsomorphicCellByUtxo(
    btcTxHash: string,
    index: number,
  ): Promise<TokenCell> {
    const { cell, spentTx } = assert(
      await this.service.getRgbppCellByUtxo(btcTxHash, index),
      RpcError.RgbppCellNotFound,
    );
    assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return await this.cellToTokenCell(cell, spentTx);
  }
}
