import {
  assertConfig,
  parseBtcAddress,
  parseScriptMode,
  RgbppLockArgs,
  ScriptMode,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { UdtBalanceRepo, UdtInfoRepo } from "./repos";

@Injectable()
export class CellService {
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly btcRequester: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtBalanceRepo: UdtBalanceRepo,
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

    const btcRpcUri = assertConfig<string>(configService, "sync.btcRpcUri");
    this.btcRequester = axios.create({
      baseURL: btcRpcUri,
    });
  }

  async scriptMode(script: ccc.ScriptLike): Promise<ScriptMode> {
    return await parseScriptMode(script, this.client, [
      {
        rgbppCodeHash: this.rgbppBtcCodeHash,
        rgbppHashType: this.rgbppBtcHashType,
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
        requester: this.btcRequester,
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
      const liveCell = await this.client.getCellLive({ txHash, index }, true);
      if (liveCell) {
        return {
          cell: liveCell,
        };
      }
      const spentTxs = this.client.findTransactions({
        script: cell.cellOutput.lock,
        scriptType: "lock",
        scriptSearchMode: "exact",
        filter: {
          script: cell.cellOutput.type,
        },
      });
      for await (const tx of spentTxs) {
        if (tx.isInput) {
          return {
            cell,
            spender: ccc.OutPoint.from({
              txHash: tx.txHash,
              index: tx.txIndex,
            }),
          };
        }
      }
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
          index: tx.txIndex,
        });
      } else {
        spentCell = await this.client.getCell({
          txHash: tx.txHash,
          index: tx.txIndex,
        });
      }
    }
    return spentCell ? { cell: spentCell, spender } : undefined;
  }

  async getPagedTokenCells(
    tokenId: string,
    address: string,
    offset: number,
    limit: number,
  ): Promise<ccc.Cell[]> {
    const udtInfo = await this.udtInfoRepo.getTokenInfoByTokenId(tokenId);
    if (!udtInfo) {
      return [];
    }

    const lockScript = (await ccc.Address.fromString(address, this.client))
      .script;
    const typeScript: ccc.ScriptLike = {
      codeHash: udtInfo.typeCodeHash,
      hashType: udtInfo.typeCodeHash,
      args: udtInfo.typeArgs,
    };

    const searchLimit = 30;
    const cells: ccc.Cell[] = [];
    let lastCursor: string | undefined;
    while (offset > 0) {
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
        searchLimit,
        lastCursor,
      );
      lastCursor = result.lastCursor;
      if (result.cells.length <= offset) {
        offset -= result.cells.length;
        continue;
      } else {
        cells.push(...result.cells.slice(offset));
        offset = 0;
        if (cells.length >= limit) {
          break;
        }
      }
      if (result.cells.length < searchLimit) {
        break;
      }
    }
    return cells.slice(0, limit);
  }

  async getPagedTokenCellsByCursor(
    tokenId: string,
    address: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    cells: ccc.Cell[];
    cursor: string;
  }> {
    const udtInfo = await this.udtInfoRepo.getTokenInfoByTokenId(tokenId);
    if (!udtInfo) {
      return {
        cells: [],
        cursor: "",
      };
    }

    const lockScript = (await ccc.Address.fromString(address, this.client))
      .script;
    const typeScript: ccc.ScriptLike = {
      codeHash: udtInfo.typeCodeHash,
      hashType: udtInfo.typeCodeHash,
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
