import {
  assertConfig,
  headerToRepoBlock,
  RgbppLockArgs,
  ScriptMode,
} from "@app/commons";
import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { Axios } from "axios";
import { BlockRepo } from "./repos/block.repo";

@Injectable()
export class BlockService {
  private readonly logger = new Logger(BlockService.name);
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly btcRequester: Axios;

  constructor(
    private readonly configService: ConfigService,
    private readonly blockRepo: BlockRepo,
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

  async parseScriptMode(script: ccc.ScriptLike): Promise<ScriptMode> {
    if (
      script.codeHash === this.rgbppBtcCodeHash &&
      script.hashType === this.rgbppBtcHashType
    ) {
      return ScriptMode.Rgbpp;
    }
    const singleUseLock = await this.client.getKnownScript(
      ccc.KnownScript.SingleUseLock,
    );
    if (
      script.codeHash === singleUseLock.codeHash &&
      script.hashType === singleUseLock.hashType
    ) {
      return ScriptMode.SingleUseLock;
    }
    const xudtType = await this.client.getKnownScript(ccc.KnownScript.XUdt);
    if (
      script.codeHash === xudtType.codeHash &&
      script.hashType === xudtType.hashType
    ) {
      return ScriptMode.Xudt;
    }
    // todo: add spore script
    return ScriptMode.Unknown;
  }

  async scriptToAddress(scriptLike: ccc.ScriptLike): Promise<{
    address: string;
    btc?: {
      txId: string;
      outIndex: number;
    };
  }> {
    const script = ccc.Script.from(scriptLike);

    if (
      script.codeHash === this.rgbppBtcCodeHash &&
      script.hashType === this.rgbppBtcHashType
    ) {
      const decoded = (() => {
        try {
          return RgbppLockArgs.decode(script.args);
        } catch (err) {
          this.logger.warn(
            `Failed to decode rgbpp lock args ${script.args}: ${err.message}`,
          );
        }
      })();

      if (decoded) {
        const { outIndex, txId } = decoded;
        const { data } = await this.btcRequester.post("/", {
          method: "getrawtransaction",
          params: [txId.slice(2), true],
        });

        if (data?.result?.vout?.[outIndex]?.scriptPubKey?.address == null) {
          this.logger.warn(`Failed to get btc rgbpp utxo ${txId}:${outIndex}`);
        } else {
          return {
            address: data?.result?.vout?.[outIndex]?.scriptPubKey?.address,
            btc: decoded,
          };
        }
      }
    }

    return { address: ccc.Address.fromScript(script, this.client).toString() };
  }

  async getCellByOutpoint(
    txHash: ccc.HexLike,
    index: number,
  ): Promise<
    | {
        cell: ccc.Cell;
        spentTx?: ccc.Hex;
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
            spentTx: tx.txHash,
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
        spentTx?: ccc.Hex;
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
    let spentTx: ccc.Hex | undefined;
    for await (const tx of rgbppTxs) {
      if (tx.isInput) {
        spentTx = tx.txHash;
      } else {
        spentCell = await this.client.getCell({
          txHash: tx.txHash,
          index: tx.txIndex,
        });
      }
    }
    return spentCell ? { cell: spentCell, spentTx } : undefined;
  }

  async getBlockHeader(params: {
    blockNumber?: number;
    fromDb: boolean;
  }): Promise<Block | undefined> {
    const { blockNumber, fromDb } = params;
    if (blockNumber) {
      if (fromDb) {
        return await this.blockRepo.getBlockByNumber(ccc.numFrom(blockNumber));
      } else {
        const header = await this.client.getHeaderByNumber(blockNumber);
        return headerToRepoBlock(header);
      }
    } else {
      if (fromDb) {
        return await this.blockRepo.getTipBlock();
      } else {
        const header = await this.client.getTipHeader();
        return headerToRepoBlock(header);
      }
    }
  }
}
