import {
  assert,
  AssetTxData,
  asyncMap,
  EventType,
  extractIsomorphicInfo,
  RgbppLockArgs,
  RpcError,
  ScriptMode,
  TokenCell,
  TxAssetCellData,
  TxAssetCellDetail,
} from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get } from "@nestjs/common";
import { AssetService } from "./asset.service";

@Controller()
export class AssetController {
  constructor(private readonly service: AssetService) {}

  async cellToTokenCell(params: {
    cell: ccc.Cell;
    spender?: ccc.OutPointLike;
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
      spenderTx: spender ? ccc.hexFrom(spender.txHash) : undefined,
      inputIndex: spender ? Number(spender.index) : undefined,
      isomorphicBtcTx: btc ? ccc.hexFrom(btc.txId) : undefined,
      isomorphicBtcTxVout: btc ? btc.outIndex : undefined,
    };
  }

  async extractTxDataFromTx(
    tx: ccc.Transaction,
    blockHash?: ccc.Hex,
    blockHeight?: ccc.Num,
  ): Promise<AssetTxData> {
    const assetTxData: AssetTxData = {
      txId: tx.hash(),
      blockHash,
      blockHeight,
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
      // token data
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

      // cluster data
      const clusterInfo = await this.service.getClusterInfoFromCell(cell);
      if (clusterInfo) {
        assetTxData.clusterInfos.push({
          clusterId: ccc.hexFrom(clusterInfo.clusterId),
          name: clusterInfo.name,
          description: clusterInfo.description,
        });
      }

      // spore data
      const sporeInfo = await this.service.getSporeInfoFromCell(cell);
      if (sporeInfo) {
        assetTxData.sporeInfos.push({
          tokenId: ccc.hexFrom(sporeInfo.sporeId),
          content: sporeInfo.content,
          contentType: sporeInfo.contentType,
          clusterId: sporeInfo.clusterId
            ? ccc.hexFrom(sporeInfo.clusterId)
            : undefined,
        });
      }
    }

    return assetTxData;
  }

  async extractCellAssetFromCell(
    cell: ccc.Cell,
    index: number,
    eventType: EventType,
  ): Promise<TxAssetCellDetail> {
    const scriptMode = await this.service.scriptMode(cell.cellOutput.lock);
    const isomorphicInfo =
      scriptMode === ScriptMode.Rgbpp
        ? extractIsomorphicInfo(cell.cellOutput.lock)
        : undefined;
    const cellAsset: TxAssetCellDetail = {
      index,
      capacity: cell.cellOutput.capacity,
      eventType,
      address: await this.service.scriptToAddress(cell.cellOutput.lock),
      typeScriptType: scriptMode,
      isomorphicBtcTx: isomorphicInfo?.txHash
        ? ccc.hexFrom(isomorphicInfo.txHash)
        : undefined,
      isomorphicBtcTxVout: isomorphicInfo?.index
        ? Number(isomorphicInfo.index)
        : undefined,
    };

    const token = await this.service.getTokenInfoFromCell(cell);
    if (token) {
      cellAsset.tokenData = {
        tokenId: ccc.hexFrom(token.hash),
        name: token.name ?? undefined,
        symbol: token.symbol ?? undefined,
        decimal: token.decimals ?? undefined,
        owner: token.owner ?? undefined,
      };
    }

    const cluster = await this.service.getClusterInfoFromCell(cell);
    if (cluster) {
      cellAsset.nftData = {
        tokenId: ccc.hexFrom(cluster.clusterId),
        clusterName: cluster.name,
        clusterDescription: cluster.description,
      };
    }

    const spore = await this.service.getSporeInfoFromCell(cell);
    if (spore) {
      cellAsset.nftData = {
        tokenId: ccc.hexFrom(spore.sporeId),
        content: spore.content,
        contentType: spore.contentType,
      };
    }

    return cellAsset;
  }

  async extractTxAssetFromTx(
    tx: ccc.Transaction,
    blockHash?: ccc.Hex,
    blockHeight?: ccc.Num,
  ): Promise<TxAssetCellData> {
    const txAssetData: TxAssetCellData = {
      txId: tx.hash(),
      blockHash,
      blockHeight,
      inputs: [],
      outputs: [],
    };

    const inputCells = await this.service.extractCellsFromTxInputs(tx);
    for (const [index, input] of inputCells.entries()) {
      const cellAsset = await this.extractCellAssetFromCell(
        input.cell,
        index,
        EventType.Burn,
      );
      txAssetData.inputs.push(cellAsset);
    }

    const outputCells = await this.service.extractCellsFromTxOutputs(tx);
    for (const [index, output] of outputCells.entries()) {
      const cellAsset = await this.extractCellAssetFromCell(
        output.cell,
        index,
        EventType.Mint,
      );
      txAssetData.inputs.push(cellAsset);
    }

    // TODO: rebalance event types

    return txAssetData;
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
