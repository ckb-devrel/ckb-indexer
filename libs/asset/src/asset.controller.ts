import {
  ApiError,
  assert,
  asyncMap,
  Chain,
  EventType,
  extractIsomorphicInfo,
  IsomorphicBinding,
  LeapType,
  RpcError,
  RpcResponse,
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

interface CellWithSpender {
  cell: ccc.Cell;
  spender?: ccc.OutPointLike;
}

@Controller()
export class AssetController {
  constructor(private readonly service: AssetService) {}

  async cellDetailWithoutAssets(
    cell: ccc.Cell,
    index: number,
    eventType: EventType,
    lockMode: ScriptMode,
    typeMode: ScriptMode,
  ): Promise<TxAssetCellDetail> {
    const isomorphicInfo = extractIsomorphicInfo(cell.cellOutput.lock);
    let isomorphicBinding: IsomorphicBinding | undefined = undefined;
    if (isomorphicInfo) {
      switch (lockMode) {
        case ScriptMode.RgbppBtc:
          {
            isomorphicBinding = {
              chain: Chain.Btc,
              txHash: ccc.hexFrom(isomorphicInfo.txHash),
              vout: Number(isomorphicInfo.index),
              leapType: LeapType.None, // default is none
            };
          }
          break;
        case ScriptMode.RgbppDoge: {
          isomorphicBinding = {
            chain: Chain.Doge,
            txHash: ccc.hexFrom(isomorphicInfo.txHash),
            vout: Number(isomorphicInfo.index),
            leapType: LeapType.None, // default is none
          };
        }
      }
    }
    const cellAsset: TxAssetCellDetail = {
      index,
      capacity: cell.cellOutput.capacity,
      eventType,
      address: await this.service.scriptToAddress(cell.cellOutput.lock),
      typeCodeName: typeMode,
      rgbppBinding: isomorphicBinding,
    };
    return cellAsset;
  }

  async extractCellAssetFromCell(
    cell: ccc.Cell,
    index: number,
    eventType: EventType,
  ): Promise<TxAssetCellDetail> {
    const typeScript = assert(cell.cellOutput.type, RpcError.CellNotAsset);
    const lockMode = await this.service.scriptMode(cell.cellOutput.lock);
    const typeMode = await this.service.scriptMode(typeScript);

    const cellAsset = await this.cellDetailWithoutAssets(
      cell,
      index,
      eventType,
      lockMode,
      typeMode,
    );

    const token = await this.service.getTokenFromCell(cell, lockMode, typeMode);
    if (token) {
      const { tokenInfo, balance, mintable } = token;
      cellAsset.tokenData = {
        tokenId: ccc.hexFrom(tokenInfo.hash),
        mintable,
        name: tokenInfo.name ?? undefined,
        symbol: tokenInfo.symbol ?? undefined,
        decimal: tokenInfo.decimals ?? undefined,
        amount: balance,
      };
    }

    const cluster = await this.service.getClusterInfoFromCell(cell, typeMode);
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

    const spore = await this.service.getSporeFromCell(cell, typeMode);
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
    txHash: ccc.Hex,
    inputCells: CellWithSpender[],
    outputCells: CellWithSpender[],
    blockHash?: ccc.Hex,
    blockHeight?: ccc.Num,
  ): Promise<TxAssetCellData> {
    const txAssetData: TxAssetCellData = {
      txId: txHash,
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
          mintable: boolean;
          indices: Array<number>;
        };
      }
    > = {};

    // extract and parse inputs
    await Promise.all(
      inputCells.map(async (input, index) => {
        if (input.cell.cellOutput.type === undefined) {
          return;
        }
        const cellAsset = await this.extractCellAssetFromCell(
          input.cell,
          index,
          EventType.Burn,
        );
        if (cellAsset.typeCodeName === ScriptMode.Unknown) {
          return;
        }
        if (cellAsset.tokenData) {
          const tokenId = cellAsset.tokenData.tokenId;
          if (tokenGroups[tokenId]) {
            tokenGroups[tokenId].input.totalBalance +=
              cellAsset.tokenData.amount;
            tokenGroups[tokenId].input.indices.push(txAssetData.inputs.length);
          } else {
            tokenGroups[tokenId] = {
              input: {
                totalBalance: cellAsset.tokenData.amount,
                indices: [txAssetData.inputs.length],
              },
              output: {
                totalBalance: ccc.numFrom(0),
                mintable: cellAsset.tokenData.mintable,
                indices: [],
              },
            };
          }
        }
        txAssetData.inputs.push(cellAsset);
      }),
    );

    // extract and parse outputs
    await Promise.all(
      outputCells.map(async (output, index) => {
        if (output.cell.cellOutput.type === undefined) {
          return;
        }
        const cellAsset = await this.extractCellAssetFromCell(
          output.cell,
          index,
          EventType.Mint,
        );
        if (cellAsset.typeCodeName === ScriptMode.Unknown) {
          return;
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
            tokenGroups[tokenId].output.indices.push(
              txAssetData.outputs.length,
            );
          } else {
            tokenGroups[tokenId] = {
              input: {
                totalBalance: ccc.numFrom(0),
                indices: [],
              },
              output: {
                totalBalance: cellAsset.tokenData.amount,
                mintable: cellAsset.tokenData.mintable,
                indices: [txAssetData.outputs.length],
              },
            };
          }
        }
        txAssetData.outputs.push(cellAsset);
      }),
    );

    // re-manage token events based on the calculation of token diffs
    Object.values(tokenGroups).forEach((group) => {
      if (group.input.totalBalance === 0n || group.output.totalBalance === 0n) {
        return;
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
        return;
      }
      if (group.input.totalBalance === group.output.totalBalance) {
        group.input.indices.forEach(
          (index) => (txAssetData.inputs[index].eventType = EventType.Transfer),
        );
        group.output.indices.forEach(
          (index) =>
            (txAssetData.outputs[index].eventType = EventType.Transfer),
        );
        return;
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
        return;
      }
    });

    // filter and append token metadata which uses unique type as identifier
    const groupKeys = Object.keys(tokenGroups);
    if (groupKeys.length > 0) {
      const firstTokenId = groupKeys[0];
      await Promise.all(
        txAssetData.outputs.map(async (output, index) => {
          if (output.typeCodeName === ScriptMode.UniqueType) {
            const tokenMetadata = await this.service.getUniqueInfoFromCell(
              outputCells[index].cell,
            );
            if (tokenMetadata) {
              const tokenId = ccc.hexFrom(firstTokenId);
              txAssetData.outputs[index].tokenData = {
                tokenId,
                mintable: tokenGroups[tokenId].output.mintable,
                name: tokenMetadata.name ?? undefined,
                symbol: tokenMetadata.symbol ?? undefined,
                decimal: tokenMetadata.decimals ?? undefined,
                amount: tokenGroups[tokenId].output.totalBalance,
              };
              txAssetData.outputs[index].eventType = EventType.Issue;
            }
          }
        }),
      );
    }

    return this.filterAndChangeLeapTypes(txAssetData);
  }

  filterAndChangeLeapTypes(txAssetData: TxAssetCellData): TxAssetCellData {
    for (const rgbppChain of [Chain.Btc, Chain.Doge]) {
      const hasRgbppModeInInputs = txAssetData.inputs.some(
        (input) => input.rgbppBinding?.chain === rgbppChain,
      );
      const hasRgbppModeInOutputs = txAssetData.outputs.some(
        (output) => output.rgbppBinding?.chain === rgbppChain,
      );
      if (hasRgbppModeInInputs && !hasRgbppModeInOutputs) {
        for (let i = 0; i < txAssetData.inputs.length; i++) {
          if (txAssetData.inputs[i].rgbppBinding?.chain === rgbppChain) {
            txAssetData.inputs[i].rgbppBinding!.leapType = LeapType.FromUtxo;
          }
        }
      }
      if (!hasRgbppModeInInputs && hasRgbppModeInOutputs) {
        for (let i = 0; i < txAssetData.outputs.length; i++) {
          if (txAssetData.outputs[i].rgbppBinding?.chain === rgbppChain) {
            txAssetData.outputs[i].rgbppBinding!.leapType = LeapType.ToUtxo;
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
  ): Promise<RpcResponse<TxAssetCellData>> {
    try {
      const { tx, blockHash, blockNumber } = assert(
        await this.service.getTransactionWithBlockByTxHash(txHash),
        RpcError.TxNotFound,
      );
      const inputCells = await this.service.extractCellsFromTxInputs(
        tx,
        ccc.hexFrom(txHash),
      );
      const outputCells = this.service.extractCellsFromTxOutputs(
        tx,
        ccc.hexFrom(txHash),
      );
      return {
        code: 0,
        data: await this.extractTxAssetFromTx(
          ccc.hexFrom(txHash),
          inputCells,
          outputCells,
          blockHash,
          blockNumber,
        ),
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
  ): Promise<RpcResponse<TxAssetCellData[]>> {
    try {
      const block = assert(
        await this.service.getBlockByBlockHash(blockHash),
        RpcError.BlockNotFound,
      );
      const txAssetCellDataList: TxAssetCellData[] = [];
      await asyncMap(block.transactions, async (tx) => {
        const txHash = tx.hash();
        const inputCells = await this.service.extractCellsFromTxInputs(
          tx,
          txHash,
        );
        const outputCells = this.service.extractCellsFromTxOutputs(tx, txHash);
        const txAssetCellData = await this.extractTxAssetFromTx(
          txHash,
          inputCells,
          outputCells,
          block.header.hash,
          block.header.number,
        );
        if (
          txAssetCellData.inputs.length > 0 ||
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
