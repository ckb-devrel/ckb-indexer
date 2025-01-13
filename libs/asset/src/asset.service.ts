import {
  assertConfig,
  parseBtcAddress,
  parseScriptMode,
  ScriptMode,
} from "@app/commons";
import { Cluster, Spore, UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { cccA } from "@ckb-ccc/shell/advanced";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { ClusterRepo, SporeRepo, UdtInfoRepo } from "./repos";

@Injectable()
export class AssetService {
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly btcRequester: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly sporeRepo: SporeRepo,
    private readonly clusterRepo: ClusterRepo,
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

  async getTransactionWithBlockByTxHash(txHash: string): Promise<
    | {
        tx: ccc.Transaction;
        blockHash?: ccc.Hex;
        blockNumber?: ccc.Num;
      }
    | undefined
  > {
    const response = await this.client.getTransaction(txHash);
    return response
      ? {
          tx: response.transaction,
          blockHash: response.blockHash,
          blockNumber: response.blockNumber,
        }
      : undefined;
  }

  async getBlockByBlockHash(
    blockHash: string,
  ): Promise<ccc.ClientBlock | undefined> {
    return await this.client.getBlockByHash(blockHash);
  }

  async checkCellConsumed(cell: ccc.Cell): Promise<ccc.Hex | undefined> {
    const liveCell = await this.client.getCellLive(cell.outPoint);
    if (liveCell) {
      return;
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
      if (!tx.isInput) {
        continue;
      }
      const maybeConsumerTx = await this.client.getTransaction(tx.txHash);
      if (
        maybeConsumerTx &&
        maybeConsumerTx.transaction.inputs.some(
          (input) => input.previousOutput === cell.outPoint,
        )
      ) {
        return tx.txHash;
      }
    }
  }

  async extractCellsFromTxInputs(tx: ccc.Transaction): Promise<
    {
      cell: ccc.Cell;
      spender?: ccc.OutPointLike;
    }[]
  > {
    const cells: ccc.Cell[] = [];
    for (const input of tx.inputs) {
      const cell = await this.client.getCell(input.previousOutput);
      if (cell) {
        cells.push(cell);
      }
    }
    return cells.map((cell, index) => {
      return {
        cell,
        spender: {
          txHash: tx.hash(),
          index,
        },
      };
    });
  }

  async extractCellsFromTxOutputs(tx: ccc.Transaction): Promise<
    {
      cell: ccc.Cell;
      spenderTx?: ccc.Hex;
    }[]
  > {
    const cells: ccc.Cell[] = [];
    for (const [index, output] of tx.outputs.entries()) {
      cells.push(
        ccc.Cell.from({
          outPoint: {
            txHash: tx.hash(),
            index: ccc.numFrom(index),
          },
          cellOutput: output,
          outputData: tx.outputsData[index],
        }),
      );
    }
    return await Promise.all(
      cells.map(async (cell) => {
        return {
          cell,
          spenderTx: await this.checkCellConsumed(cell),
        };
      }),
    );
  }

  async getTokenFromCell(cell: ccc.Cell): Promise<
    | {
        tokenInfo: UdtInfo;
        balance: ccc.Num;
      }
    | undefined
  > {
    if (!cell.cellOutput.type) {
      return;
    }
    const mode = await this.scriptMode(cell.cellOutput.type);
    if (mode !== ScriptMode.Xudt) {
      return;
    }
    const tokenHash = cell.cellOutput.type.hash();
    const tokenInfo =
      (await this.udtInfoRepo.getTokenInfo(tokenHash)) ??
      this.udtInfoRepo.create({
        hash: tokenHash,
        typeCodeHash: cell.cellOutput.type.codeHash,
        typeHashType: cell.cellOutput.type.hashType,
        typeArgs: cell.cellOutput.type.args,
      });
    const tokenAmount = ccc.udtBalanceFrom(cell.outputData);
    return {
      tokenInfo,
      balance: tokenAmount,
    };
  }

  async getClusterInfoFromCell(cell: ccc.Cell): Promise<Cluster | undefined> {
    if (!cell.cellOutput.type) {
      return;
    }
    const mode = await this.scriptMode(cell.cellOutput.type);
    if (mode !== ScriptMode.Cluster) {
      return;
    }
    const clusterId = cell.cellOutput.type.args;
    return (
      (await this.clusterRepo.getCluster(clusterId)) ??
      this.clusterRepo.create({
        clusterId,
        ...cccA.sporeA.unpackToRawClusterData(cell.outputData),
      })
    );
  }

  async getSporeFromCell(cell: ccc.Cell): Promise<Spore | undefined> {
    if (!cell.cellOutput.type) {
      return;
    }
    const mode = await this.scriptMode(cell.cellOutput.type);
    if (mode !== ScriptMode.Spore) {
      return;
    }
    const sporeId = cell.cellOutput.type.args;
    const spore = await this.sporeRepo.getSpore(sporeId);
    if (spore) {
      return spore;
    } else {
      const sporeData = cccA.sporeA.unpackToRawSporeData(cell.outputData);
      return this.sporeRepo.create({
        sporeId,
        contentType: sporeData.contentType,
        content: ccc.hexFrom(sporeData.content),
        clusterId: sporeData.clusterId
          ? ccc.hexFrom(sporeData.clusterId)
          : undefined,
      });
    }
  }
}
