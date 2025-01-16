import {
  assert,
  assertConfig,
  parseBtcAddress,
  parseScriptMode,
  RgbppLockArgs,
  RpcError,
  ScriptMode,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { UdtInfoRepo } from "./repos";

@Injectable()
export class CellService {
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly btcRequesters: AxiosInstance[];

  constructor(
    private readonly configService: ConfigService,
    private readonly udtInfoRepo: UdtInfoRepo,
  ) {
    const isMainnet = configService.get<boolean>("sync.isMainnet");
    const ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.client = isMainnet
      ? new ccc.ClientPublicMainnet({ url: ckbRpcUri })
      : new ccc.ClientPublicTestnet({ url: ckbRpcUri });

    this.rgbppBtcCodeHash = ccc.hexFrom(
      assertConfig(configService, "sync.rgbppBtcCodeHash"),
    );
    this.rgbppBtcHashType = ccc.hashTypeFrom(
      assertConfig(configService, "sync.rgbppBtcHashType"),
    );

    const btcRpcUris = assertConfig<string[]>(configService, "sync.btcRpcUris");
    this.btcRequesters = btcRpcUris.map((baseURL) => axios.create({ baseURL }));
  }

  async scriptMode(script: ccc.ScriptLike): Promise<ScriptMode> {
    return await parseScriptMode(script, this.client, [
      {
        codeHash: this.rgbppBtcCodeHash,
        hashType: this.rgbppBtcHashType,
        mode: ScriptMode.RgbppBtc,
      },
    ]);
  }

  async scriptToAddress(scriptLike: ccc.ScriptLike): Promise<string> {
    if (
      scriptLike.codeHash === this.rgbppBtcCodeHash &&
      scriptLike.hashType === this.rgbppBtcHashType
    ) {
      return parseBtcAddress({
        client: this.client,
        rgbppScript: scriptLike,
        requesters: this.btcRequesters,
      });
    }
    const script = ccc.Script.from(scriptLike);
    return ccc.Address.fromScript(script, this.client).toString();
  }

  async getCellByOutpoint(
    txHash: ccc.HexLike,
    index: number,
  ): Promise<
    | {
        cell: ccc.Cell;
        spender?: ccc.OutPoint;
      }
    | undefined
  > {
    const cell = await this.client.getCell({ txHash, index });
    if (cell) {
      // If the cell is not an asset, skip finding the spender
      if (cell.cellOutput.type === undefined) {
        return {
          cell,
        };
      }
      const liveCell = await this.client.getCellLive({ txHash, index }, true);
      if (liveCell) {
        return {
          cell: liveCell,
        };
      }
      const cellTx = await this.client.getTransaction(cell.outPoint.txHash);
      if (cellTx === undefined) {
        return;
      }
      const spentTxs = this.client.findTransactions(
        {
          script: cell.cellOutput.lock,
          scriptType: "lock",
          scriptSearchMode: "exact",
          filter: {
            script: cell.cellOutput.type,
          },
        },
        "desc",
        10,
      );
      for await (const tx of spentTxs) {
        if (!tx.isInput || tx.blockNumber < (cellTx.blockNumber ?? 0n)) {
          continue;
        }
        const maybeConsumerTx = await this.client.getTransaction(tx.txHash);
        if (
          maybeConsumerTx &&
          maybeConsumerTx.transaction.inputs.some((input) =>
            input.previousOutput.eq(cell.outPoint),
          )
        ) {
          return {
            cell,
            spender: ccc.OutPoint.from({
              txHash: tx.txHash,
              index: tx.cellIndex,
            }),
          };
        }
      }
      console.log("no spender found");
      return {
        cell,
      };
    }
  }

  async getRgbppCellByUtxo(
    btcTxHash: string,
    index: number,
  ): Promise<
    | {
        cell: ccc.Cell;
        spender?: ccc.OutPoint;
      }
    | undefined
  > {
    const encoded = RgbppLockArgs.encode({ txId: btcTxHash, outIndex: index });
    const rgbppCells = this.client.findCellsByLock(
      {
        codeHash: this.rgbppBtcCodeHash,
        hashType: this.rgbppBtcHashType,
        args: encoded,
      },
      null,
      true,
    );
    for await (const cell of rgbppCells) {
      return { cell };
    }
    const rgbppTxs = this.client.findTransactionsByLock(
      {
        codeHash: this.rgbppBtcCodeHash,
        hashType: this.rgbppBtcHashType,
        args: encoded,
      },
      null,
      false,
    );
    let spentCell: ccc.Cell | undefined;
    let spender: ccc.OutPoint | undefined;
    for await (const tx of rgbppTxs) {
      if (tx.isInput) {
        spender = ccc.OutPoint.from({
          txHash: tx.txHash,
          index: tx.cellIndex,
        });
      } else {
        spentCell = await this.client.getCell({
          txHash: tx.txHash,
          index: tx.cellIndex,
        });
      }
    }
    return spentCell ? { cell: spentCell, spender } : undefined;
  }

  // async getPagedTokenCells(
  //   tokenId: string,
  //   address: string,
  //   offset: number,
  //   limit: number,
  // ): Promise<ccc.Cell[]> {
  //   const udtInfo = await this.udtInfoRepo.getTokenInfoByTokenId(tokenId);
  //   if (!udtInfo) {
  //     return [];
  //   }

  //   const lockScript = (await ccc.Address.fromString(address, this.client))
  //     .script;
  //   const typeScript: ccc.ScriptLike = {
  //     codeHash: udtInfo.typeCodeHash,
  //     hashType: udtInfo.typeCodeHash,
  //     args: udtInfo.typeArgs,
  //   };

  //   const searchLimit = 30;
  //   const cells: ccc.Cell[] = [];
  //   let lastCursor: string | undefined;
  //   while (offset > 0) {
  //     const result = await this.client.findCellsPaged(
  //       {
  //         script: lockScript,
  //         scriptType: "lock",
  //         scriptSearchMode: "exact",
  //         filter: {
  //           script: typeScript,
  //         },
  //       },
  //       "asc",
  //       searchLimit,
  //       lastCursor,
  //     );
  //     lastCursor = result.lastCursor;
  //     if (result.cells.length <= offset) {
  //       offset -= result.cells.length;
  //       continue;
  //     } else {
  //       cells.push(...result.cells.slice(offset));
  //       offset = 0;
  //       if (cells.length >= limit) {
  //         break;
  //       }
  //     }
  //     if (result.cells.length < searchLimit) {
  //       break;
  //     }
  //   }
  //   return cells.slice(0, limit);
  // }

  async getPagedTokenCellsByCursor(
    tokenId: string,
    address: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    cells: ccc.Cell[];
    cursor: string;
  }> {
    const udtInfo = assert(
      await this.udtInfoRepo.getTokenInfoByTokenId(tokenId),
      RpcError.TokenNotFound,
    );
    const lockScript = (await ccc.Address.fromString(address, this.client))
      .script;
    const typeScript: ccc.ScriptLike = {
      codeHash: udtInfo.typeCodeHash,
      hashType: udtInfo.typeHashType,
      args: udtInfo.typeArgs,
    };

    const result = await this.client.findCellsPaged(
      {
        script: lockScript,
        scriptType: "lock",
        scriptSearchMode: "exact",
        filter: {
          script: typeScript,
        },
      },
      "asc",
      limit,
      cursor,
    );
    return {
      cells: result.cells,
      cursor: result.lastCursor,
    };
  }
}
