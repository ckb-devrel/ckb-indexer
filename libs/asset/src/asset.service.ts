import {
  assertConfig,
  mintableScriptMode,
  parseBtcAddress,
  parseScriptMode,
  ScriptMode,
} from "@app/commons";
import { Cluster, Spore, UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { cccA } from "@ckb-ccc/shell/advanced";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AxiosInstance } from "axios";
import { Worker } from "worker_threads";
import { ClusterRepo, SporeRepo, UdtInfoRepo } from "./repos";

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly rgbppBtcTimelockCodeHash: ccc.Hex;
  private readonly rgbppBtcTimelockHashType: ccc.HashType;
  private readonly udtTypes: {
    codeHash: ccc.HexLike;
    hashType: ccc.HashTypeLike;
  }[];
  private readonly workers: Worker[];

  constructor(
    private readonly configService: ConfigService,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly sporeRepo: SporeRepo,
    private readonly clusterRepo: ClusterRepo,
    @Inject("BTC_REQUESTERS") private readonly btcRequesters: AxiosInstance[],
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
    this.rgbppBtcTimelockCodeHash = ccc.hexFrom(
      assertConfig(configService, "sync.rgbppBtcTimelockCodeHash"),
    );
    this.rgbppBtcTimelockHashType = ccc.hashTypeFrom(
      assertConfig(configService, "sync.rgbppBtcTimelockHashType"),
    );

    const udtTypes =
      configService.get<
        { codeHash: ccc.HexLike; hashType: ccc.HashTypeLike }[]
      >("sync.udtTypes") ?? [];
    this.udtTypes = udtTypes.map((t) => ccc.Script.from({ ...t, args: "" }));

    this.workers = Array.from(
      new Array(10),
      () =>
        new Worker("./dist/workers/getOutpoint.js", {
          workerData: {
            isMainnet: this.configService.get<boolean>("sync.isMainnet"),
            rpcUri: this.configService.get<string>("sync.ckbRpcUri"),
            rpcTimeout: this.configService.get<number>("sync.ckbRpcTimeout"),
            maxConcurrent: this.configService.get<number>("sync.maxConcurrent"),
          },
        }),
    );
  }

  async scriptMode(script: ccc.ScriptLike): Promise<ScriptMode> {
    const extension = this.udtTypes.map((t) => ({
      codeHash: ccc.hexFrom(t.codeHash),
      hashType: ccc.hashTypeFrom(t.hashType),
      mode: ScriptMode.Udt,
    }));
    extension.push({
      codeHash: this.rgbppBtcCodeHash,
      hashType: this.rgbppBtcHashType,
      mode: ScriptMode.RgbppBtc,
    });
    extension.push({
      codeHash: this.rgbppBtcTimelockCodeHash,
      hashType: this.rgbppBtcTimelockHashType,
      mode: ScriptMode.RgbppBtcTimelock,
    });
    return await parseScriptMode(script, this.client, extension);
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
        logger: this.logger,
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
    // If the cell is not an asset, skip finding the spender
    if (cell.cellOutput.type === undefined) {
      return;
    }
    const liveCell = await this.client.getCellLive(cell.outPoint);
    if (liveCell) {
      return;
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
    let cells: ccc.Cell[] = [];
    if (tx.inputs.length < 20) {
      const promises = tx.inputs.map((input) =>
        this.client.getCell(input.previousOutput),
      );
      cells = (await Promise.all(promises)).filter(
        (cell): cell is ccc.Cell => cell !== undefined,
      );
    } else {
      const worker = this.workers.shift();
      if (worker) {
        const pureCells = await new Promise<ccc.CellLike[]>(
          (resolve, reject) => {
            worker.postMessage(tx.inputs.map((input) => input.previousOutput));
            worker.once("message", resolve);
            worker.once("error", reject);
          },
        );
        cells = pureCells.map((cell) => ccc.Cell.from(cell));
      } else {
        for (const input of tx.inputs) {
          const cell = await this.client.getCell(input.previousOutput);
          if (cell) {
            cells.push(cell);
          }
        }
      }
    }

    return cells.map((cell, index) => ({
      cell,
      spender: {
        txHash: tx.hash(),
        index,
      },
    }));
  }

  extractCellsFromTxOutputs(tx: ccc.Transaction): {
    cell: ccc.Cell;
    spenderTx?: ccc.Hex;
  }[] {
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
    return cells.map((cell) => {
      return {
        cell,
        spenderTx: undefined, //await this.checkCellConsumed(cell),
      };
    });
  }

  async getTokenFromCell(
    cell: ccc.Cell,
    lockMode: ScriptMode,
    typeMode: ScriptMode,
  ): Promise<
    | {
        tokenInfo: UdtInfo;
        mintable: boolean;
        balance: ccc.Num;
      }
    | undefined
  > {
    if (typeMode !== ScriptMode.Udt || !cell.cellOutput.type) {
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
    const tokenAmount =
      cell.outputData.length >= 16 ? ccc.udtBalanceFrom(cell.outputData) : 0n;
    return {
      tokenInfo,
      mintable: mintableScriptMode(lockMode),
      balance: tokenAmount,
    };
  }

  async getUniqueInfoFromCell(cell: ccc.Cell): Promise<UdtInfo | undefined> {
    if (!cell.cellOutput.type) {
      return;
    }
    const mode = await this.scriptMode(cell.cellOutput.type);
    if (mode !== ScriptMode.UniqueType) {
      return;
    }
    const outputData = ccc.bytesFrom(cell.outputData);
    // | decimals | name len |  ... name ...  | symbol len |  ... symbol ...  |
    // | 1 bytes  | 1 bytes  | name len bytes | 1 bytes    | symbol len bytes |
    if (outputData.length < 1) {
      return;
    }
    const decimals = Number(ccc.numFromBytes(outputData.slice(0, 1)));

    const udtInfo = this.udtInfoRepo.create({
      decimals,
    });

    if (outputData.length < 2) {
      return udtInfo;
    }
    const nameLen = Number(ccc.numFromBytes(outputData.slice(1, 2)));
    if (outputData.length < 2 + nameLen) {
      return udtInfo;
    }
    udtInfo.name = ccc.bytesTo(outputData.slice(2, 2 + nameLen), "utf8");

    if (outputData.length < 3 + nameLen) {
      return udtInfo;
    }
    const symbolLen = Number(
      ccc.numFromBytes(outputData.slice(2 + nameLen, 3 + nameLen)),
    );
    if (outputData.length < 3 + nameLen + symbolLen) {
      return udtInfo;
    }
    udtInfo.symbol = ccc.bytesTo(
      outputData.slice(3 + nameLen, 3 + nameLen + symbolLen),
      "utf8",
    );
    return udtInfo;
  }

  async getClusterInfoFromCell(
    cell: ccc.Cell,
    typeMode: ScriptMode,
  ): Promise<Cluster | undefined> {
    if (typeMode !== ScriptMode.Cluster || !cell.cellOutput.type) {
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

  async getSporeFromCell(
    cell: ccc.Cell,
    typeMode: ScriptMode,
  ): Promise<Spore | undefined> {
    if (typeMode !== ScriptMode.Spore || !cell.cellOutput.type) {
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
