import {
  assert,
  AssetTxData,
  asyncMap,
  RgbppLockArgs,
  RpcError,
  TokenCell,
  TxAssetCellData,
} from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get } from "@nestjs/common";
import { AssetService } from "./asset.service";

@Controller()
export class AssetController {
  constructor(private readonly service: AssetService) {}

  async cellToTokenCell(params: {
    cell: ccc.Cell;
    spender?: {
      spenderTx: ccc.Hex;
      spenderVout: number;
    };
  }): Promise<TokenCell> {
    const { cell, spender } = params;
    const address = await this.service.scriptToAddress(cell.cellOutput.lock);
    const btc = (() => {
      try {
        return RgbppLockArgs.decode(cell.cellOutput.lock.args);
      } catch (err) {
        return undefined;
      }
    })();
    const typeScript = assert(cell.cellOutput.type, RpcError.CellNotAsset);
    return {
      txId: cell.outPoint.txHash,
      vout: Number(cell.outPoint.index),
      lockScript: {
        ...cell.cellOutput.lock,
        codeHashType: await this.service.scriptMode(cell.cellOutput.lock),
      },
      typeScript: {
        ...typeScript,
        codeHashType: await this.service.scriptMode(typeScript),
      },
      ownerAddress: address,
      capacity: ccc.numFrom(cell.cellOutput.capacity),
      data: cell.outputData,
      spent: spender !== undefined,
      spenderTx: spender?.spenderTx,
      inputIndex: spender?.spenderVout,
      isomorphicBtcTx: btc ? ccc.hexFrom(btc.txId) : undefined,
      isomorphicBtcTxVout: btc ? btc.outIndex : undefined,
    };
  }

  async extractTxDataFromTx(
    tx: ccc.Transaction,
    blockHash?: ccc.Hex,
    blockNumber?: ccc.Num,
  ): Promise<AssetTxData> {
    const assetTxData: AssetTxData = {
      txId: tx.hash(),
      blockHash: blockHash ? ccc.hexFrom(blockHash) : undefined,
      blockHeight: blockNumber ? ccc.numFrom(blockNumber) : undefined,
      tokenInfos: [],
      clusterInfos: [],
      sporeInfos: [],
      inputs: [],
      outputs: [],
    };
    const cells: ccc.Cell[] = [];

    const inputCells = await this.service.extractCellsFromTxInputs(tx);
    for (const input of inputCells) {
      cells.push(input.cell);
      const tokenCell = await this.cellToTokenCell(input);
      assetTxData.inputs.push(tokenCell);
    }

    const outputCells = await this.service.extractCellsFromTxOutputs(tx);
    for (const output of outputCells) {
      cells.push(output.cell);
      const tokenCell = await this.cellToTokenCell(output);
      assetTxData.outputs.push(tokenCell);
    }

    for (const cell of cells) {
      const udtInfo = await this.service.getTokenInfoFromCell(cell);
      if (udtInfo) {
        assetTxData.tokenInfos.push({
          tokenId: ccc.hexFrom(udtInfo.hash),
          name: udtInfo.name ?? undefined,
          symbol: udtInfo.symbol ?? undefined,
          decimal: udtInfo.decimals ?? undefined,
          owner: udtInfo.owner ?? undefined,
        });
      }

      // TODO
    }

    return assetTxData;
  }

  async extractTxAssetFromTx(
    tx: ccc.Transaction,
    blockHash?: ccc.Hex,
    blockNumber?: ccc.Num,
  ): Promise<TxAssetCellData> {
    throw new Error("Not implemented");
  }

  @Get("/queryAssetTxDataByTxHash")
  async queryAssetTxDataByTxHash(txHash: string): Promise<AssetTxData> {
    const { tx, blockHash, blockNumber } = assert(
      await this.service.getTransactionWithBlockByTxHash(txHash),
      RpcError.TxNotFound,
    );
    return await this.extractTxDataFromTx(tx, blockHash, blockNumber);
  }

  @Get("/queryAssetTxDataListByBlockHash")
  async queryAssetTxDataListByBlockHash(
    blockHash: string,
  ): Promise<AssetTxData[]> {
    const block = assert(
      await this.service.getBlockByBlockHash(blockHash),
      RpcError.BlockNotFound,
    );
    const assetTxDataList: AssetTxData[] = [];
    await asyncMap(block.transactions, async (tx) => {
      const assetTxData = await this.extractTxDataFromTx(
        tx,
        block.header.hash,
        block.header.number,
      );
      assetTxDataList.push(assetTxData);
    });
    return assetTxDataList;
  }

  @Get("/queryTxAssetCellDataByTxHash")
  async queryTxAssetCellDataByTxHash(txHash: string): Promise<TxAssetCellData> {
    const { tx, blockHash, blockNumber } = assert(
      await this.service.getTransactionWithBlockByTxHash(txHash),
      RpcError.TxNotFound,
    );
    return await this.extractTxAssetFromTx(tx, blockHash, blockNumber);
  }

  @Get("/queryTxAssetCellDataListByBlockHash")
  async queryTxAssetCellDataListByBlockHash(
    blockHash: string,
  ): Promise<TxAssetCellData[]> {
    const block = assert(
      await this.service.getBlockByBlockHash(blockHash),
      RpcError.BlockNotFound,
    );
    const txAssetCellDataList: TxAssetCellData[] = [];
    await asyncMap(block.transactions, async (tx) => {
      const txAssetCellData = await this.extractTxAssetFromTx(
        tx,
        block.header.hash,
        block.header.number,
      );
      txAssetCellDataList.push(txAssetCellData);
    });
    return txAssetCellDataList;
  }
}
