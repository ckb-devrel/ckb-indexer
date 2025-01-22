import {
  ApiError,
  assert,
  asyncMap,
  Chain,
  EventType,
  extractIsomorphicInfo,
  IsomorphicBinding,
  NormalizedReturn,
  RpcError,
  ScriptMode,
  TxAssetCellData,
  TxAssetCellDetail,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AssetService } from "./asset.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

@Controller()
export class AssetController {
  constructor(private readonly service: AssetService) {}

  async cellDetialWithoutAssets(
    cell: ccc.Cell,
    index: number,
    eventType: EventType,
  ): Promise<TxAssetCellDetail> {
    const typeScript = assert(cell.cellOutput.type, RpcError.CellNotAsset);
    const scriptMode = await this.service.scriptMode(cell.cellOutput.lock);
    const isomorphicInfo = extractIsomorphicInfo(cell.cellOutput.lock);
    let isomorphicBinding: IsomorphicBinding | undefined = undefined;
    if (isomorphicInfo) {
      switch (scriptMode) {
        case ScriptMode.RgbppBtc:
          {
            isomorphicBinding = {
              chain: Chain.Btc,
              txHash: ccc.hexFrom(isomorphicInfo.txHash),
              vout: Number(isomorphicInfo.index),
            };
          }
          break;
        case ScriptMode.RgbppDoge: {
          isomorphicBinding = {
            chain: Chain.Doge,
            txHash: ccc.hexFrom(isomorphicInfo.txHash),
            vout: Number(isomorphicInfo.index),
          };
        }
      }
    }
    const cellAsset: TxAssetCellDetail = {
      index,
      capacity: cell.cellOutput.capacity,
      eventType,
      address: await this.service.scriptToAddress(cell.cellOutput.lock),
      typeCodeName: await this.service.scriptMode(typeScript),
      rgbppBinding: isomorphicBinding,
    };
    return cellAsset;
  }

  async extractCellAssetFromCell(
    cell: ccc.Cell,
    index: number,
    eventType: EventType,
  ): Promise<TxAssetCellDetail> {
    const cellAsset = await this.cellDetialWithoutAssets(
      cell,
      index,
      eventType,
    );

    const token = await this.service.getTokenFromCell(cell);
    if (token) {
      const { tokenInfo, balance } = token;
      cellAsset.tokenData = {
        tokenId: ccc.hexFrom(tokenInfo.hash),
        name: tokenInfo.name ?? undefined,
        symbol: tokenInfo.symbol ?? undefined,
        decimal: tokenInfo.decimals ?? undefined,
        amount: balance,
      };
    }

    const cluster = await this.service.getClusterInfoFromCell(cell);
    if (cluster) {
      cellAsset.nftData = {
        clusterId: ccc.hexFrom(cluster.clusterId),
        clusterName: cluster.name,
        clusterDescription: cluster.description,
      };
      // cluster mint event should be replaced with issue event
      if (eventType === EventType.Mint) {
        cellAsset.eventType = EventType.Issue;
      }
    }

    const spore = await this.service.getSporeFromCell(cell);
    if (spore) {
      cellAsset.nftData = {
        tokenId: ccc.hexFrom(spore.sporeId),
        clusterId: spore.clusterId ? ccc.hexFrom(spore.clusterId) : undefined,
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

    const tokenGroups: Record<
      ccc.Hex,
      {
        input: {
          totalBalance: ccc.Num;
          indices: Array<number>;
        };
        output: {
          totalBalance: ccc.Num;
          indices: Array<number>;
        };
      }
    > = {};

    // extract and parse inputs
    const inputCells = await this.service.extractCellsFromTxInputs(tx);
    for (const [index, input] of inputCells.entries()) {
      if (input.cell.cellOutput.type === undefined) {
        continue;
      }
      const cellAsset = await this.extractCellAssetFromCell(
        input.cell,
        index,
        EventType.Burn,
      );
      if (cellAsset.typeCodeName === ScriptMode.Unknown) {
        continue;
      }
      if (cellAsset.tokenData) {
        const tokenId = cellAsset.tokenData.tokenId;
        if (tokenGroups[tokenId]) {
          tokenGroups[tokenId].input.totalBalance += cellAsset.tokenData.amount;
          tokenGroups[tokenId].input.indices.push(txAssetData.inputs.length);
        } else {
          tokenGroups[tokenId] = {
            input: {
              totalBalance: cellAsset.tokenData.amount,
              indices: [txAssetData.inputs.length],
            },
            output: {
              totalBalance: ccc.numFrom(0),
              indices: [],
            },
          };
        }
      }
      txAssetData.inputs.push(cellAsset);
    }

    // extract and parse outputs
    const outputCells = await this.service.extractCellsFromTxOutputs(tx);
    for (const [index, output] of outputCells.entries()) {
      if (output.cell.cellOutput.type === undefined) {
        continue;
      }
      const cellAsset = await this.extractCellAssetFromCell(
        output.cell,
        index,
        EventType.Mint,
      );
      if (cellAsset.typeCodeName === ScriptMode.Unknown) {
        continue;
      }
      if (cellAsset.nftData) {
        const nftIndex = txAssetData.inputs.findIndex(
          (input) =>
            input.nftData?.tokenId === cellAsset.nftData?.tokenId &&
            input.nftData?.clusterId === cellAsset.nftData?.clusterId,
        );
        if (nftIndex >= 0) {
          txAssetData.inputs[nftIndex].eventType = EventType.Transfer;
          cellAsset.eventType = EventType.Transfer;
        }
      }
      if (cellAsset.tokenData) {
        const tokenId = cellAsset.tokenData.tokenId;
        if (tokenGroups[tokenId]) {
          tokenGroups[tokenId].output.totalBalance +=
            cellAsset.tokenData.amount;
          tokenGroups[tokenId].output.indices.push(txAssetData.outputs.length);
        } else {
          tokenGroups[tokenId] = {
            input: {
              totalBalance: ccc.numFrom(0),
              indices: [],
            },
            output: {
              totalBalance: cellAsset.tokenData.amount,
              indices: [txAssetData.outputs.length],
            },
          };
        }
      }
      txAssetData.outputs.push(cellAsset);
    }

    // re-manage token events based on the calculation of token diffs
    for (const group of Object.values(tokenGroups)) {
      if (group.input.totalBalance === 0n || group.output.totalBalance === 0n) {
        continue;
      }
      if (group.input.totalBalance > group.output.totalBalance) {
        group.input.indices.forEach(
          (index) =>
            (txAssetData.inputs[index].eventType = EventType.BurnAndTransfer),
        );
        group.output.indices.forEach(
          (index) =>
            (txAssetData.outputs[index].eventType = EventType.BurnAndTransfer),
        );
        continue;
      }
      if (group.input.totalBalance === group.output.totalBalance) {
        group.input.indices.forEach(
          (index) => (txAssetData.inputs[index].eventType = EventType.Transfer),
        );
        group.output.indices.forEach(
          (index) =>
            (txAssetData.outputs[index].eventType = EventType.Transfer),
        );
        continue;
      }
      if (group.input.totalBalance < group.output.totalBalance) {
        group.input.indices.forEach(
          (index) =>
            (txAssetData.inputs[index].eventType = EventType.MintAndTransfer),
        );
        group.output.indices.forEach(
          (index) =>
            (txAssetData.outputs[index].eventType = EventType.MintAndTransfer),
        );
        continue;
      }
    }

    // filter and append token metadata which uses unique type as identifier
    const groupKeys = Object.keys(tokenGroups);
    if (groupKeys.length > 0) {
      const firstTokenId = groupKeys[0];
      for (const [index, output] of txAssetData.outputs.entries()) {
        if (output.typeCodeName === ScriptMode.UniqueType) {
          const tokenMetadata = await this.service.getUniqueInfoFromCell(
            outputCells[index].cell,
          );
          if (tokenMetadata) {
            const tokenId = ccc.hexFrom(firstTokenId);
            txAssetData.outputs[index].tokenData = {
              tokenId,
              name: tokenMetadata.name ?? undefined,
              symbol: tokenMetadata.symbol ?? undefined,
              decimal: tokenMetadata.decimals ?? undefined,
              amount: tokenGroups[tokenId].output.totalBalance,
            };
            txAssetData.outputs[index].eventType = EventType.Issue;
          }
        }
      }
    }

    return txAssetData;
  }

  @ApiOkResponse({
    type: TxAssetCellData,
    description:
      "Query a list of assets in the cell from a transaction by TxHash",
  })
  @Get("/assetCells/by-transaction/:txHash")
  async queryTxAssetCellDataByTxHash(
    @Param("txHash") txHash: string,
  ): Promise<NormalizedReturn<TxAssetCellData>> {
    try {
      const { tx, blockHash, blockNumber } = assert(
        await this.service.getTransactionWithBlockByTxHash(txHash),
        RpcError.TxNotFound,
      );
      return {
        code: 0,
        data: await this.extractTxAssetFromTx(tx, blockHash, blockNumber),
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
    type: TxAssetCellData,
    description: "Query a list of assets in the cell from a block by BlockHash",
  })
  @Get("/assetCells/by-block/:blockHash")
  async queryTxAssetCellDataListByBlockHash(
    @Param("blockHash") blockHash: string,
  ): Promise<NormalizedReturn<TxAssetCellData[]>> {
    try {
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
        if (
          txAssetCellData.inputs.length > 0 &&
          txAssetCellData.outputs.length > 0
        ) {
          txAssetCellDataList.push(txAssetCellData);
        }
      });
      return {
        code: 0,
        data: txAssetCellDataList,
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
