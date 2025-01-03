import {
  assertConfig,
  formatSortableInt,
  parseAddress,
  parseScriptMode,
  ScriptMode,
  withTransaction,
} from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { dob } from "@ckb-ccc/spore";
import {
  unpackToRawClusterData,
  unpackToRawSporeData,
} from "@ckb-ccc/spore/advanced";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { EntityManager } from "typeorm";
import { ClusterRepo } from "./repos/cluster.repo";
import { SporeRepo } from "./repos/spore.repo";

@Injectable()
export class SporeParserBuilder {
  public readonly logger = new Logger(SporeParserBuilder.name);
  public readonly client: ccc.Client;
  public readonly decoderUri: string;

  public readonly btcRequester: AxiosInstance;
  public readonly rgbppBtcCodeHash: ccc.Hex;
  public readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    configService: ConfigService,
    public readonly entityManager: EntityManager,
  ) {
    const isMainnet = configService.get<boolean>("sync.isMainnet");
    const ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.client = isMainnet
      ? new ccc.ClientPublicMainnet({ url: ckbRpcUri })
      : new ccc.ClientPublicTestnet({ url: ckbRpcUri });

    this.decoderUri = assertConfig(configService, "sync.dobDecoderUri");
    this.btcRequester = axios.create({
      baseURL: assertConfig(configService, "sync.btcRpcUri"),
    });
    this.rgbppBtcCodeHash = ccc.hexFrom(
      assertConfig(configService, "sync.rgbppBtcCodeHash"),
    );
    this.rgbppBtcHashType = ccc.hashTypeFrom(
      assertConfig(configService, "sync.rgbppBtcHashType"),
    );
  }

  build(blockHeight: ccc.NumLike): SporeParser {
    return new SporeParser(this, ccc.numFrom(blockHeight));
  }
}

interface Flow {
  asset: {
    script: ccc.Script;
    data: ccc.Hex;
  };
  mint?: {
    to: string;
  };
  transfer?: {
    from: string;
    to: string;
  };
  burn?: {
    from: string;
  };
}

class SporeParser {
  constructor(
    public readonly context: SporeParserBuilder,
    public readonly blockHeight: ccc.Num,
  ) {}

  async scriptToAddress(
    scriptLike: ccc.ScriptLike,
  ): Promise<{ address: string; btc?: { txId: string; outIndex: number } }> {
    return await parseAddress(scriptLike, {
      btcRequester: this.context.btcRequester,
      rgbppBtcCodeHash: this.context.rgbppBtcCodeHash,
      rgbppBtcHashType: this.context.rgbppBtcHashType,
    });
  }

  async checkScriptMode(
    script: ccc.Script | undefined,
    expectedMode: ScriptMode,
  ): Promise<boolean> {
    if (!script) {
      return false;
    }
    const mode = await parseScriptMode(script, this.context.client);
    return mode === expectedMode;
  }

  async analyzeFlow(
    tx: ccc.Transaction,
    mode: ScriptMode,
  ): Promise<Record<string, Flow>> {
    const flows: Record<string, Flow> = {};
    for (const input of tx.inputs) {
      if (!this.checkScriptMode(input.cellOutput?.type, mode)) {
        continue;
      }
      const { address } = await this.scriptToAddress(input.cellOutput!.lock);
      const sporeOrClusterId = input.cellOutput!.type!.args;
      flows[sporeOrClusterId] = {
        asset: {
          script: input.cellOutput!.type!,
          data: input.outputData!,
        },
        burn: {
          from: address,
        },
      };
    }
    for (const [index, output] of tx.outputs.entries()) {
      if (!this.checkScriptMode(output.type, mode)) {
        continue;
      }
      const { address } = await this.scriptToAddress(output.lock);
      const sporeOrClusterId = output.type!.args;
      const burnSpore = flows[sporeOrClusterId];
      if (burnSpore) {
        flows[sporeOrClusterId] = {
          asset: burnSpore.asset,
          transfer: {
            from: burnSpore.burn!.from,
            to: address,
          },
        };
      } else {
        flows[sporeOrClusterId] = {
          asset: {
            script: output.type!,
            data: tx.outputsData[index],
          },
          mint: {
            to: address,
          },
        };
      }
    }
    return flows;
  }

  async parseSporeData(
    sporeId: ccc.Hex,
    data: ccc.Hex,
  ): Promise<{
    contentType: string;
    content: string;
    clusterId?: ccc.Hex;
    dobDecoded?: string;
  }> {
    const sporeData = unpackToRawSporeData(ccc.bytesFrom(data));
    const decoded = {
      contentType: sporeData.contentType,
      content: ccc.hexFrom(sporeData.content),
      clusterId: sporeData.clusterId
        ? ccc.hexFrom(sporeData.clusterId)
        : undefined,
    };
    try {
      const dobDecoded = await dob.decodeDobBySporeId(
        sporeId,
        this.context.decoderUri,
      );
      Object.assign(decoded, { dobDecoded: JSON.stringify(dobDecoded) });
    } catch (error) {
      this.context.logger.error(`Spore DOB decode failed: ${error}`);
    }
    return decoded;
  }

  parseClusterData(data: ccc.Hex): {
    name: string;
    description: string;
  } {
    return unpackToRawClusterData(ccc.bytesFrom(data));
  }

  async handleSporeFlow(
    txHash: ccc.Hex,
    sporeId: ccc.Hex,
    flow: Flow,
    sporeRepo: SporeRepo,
  ) {
    const { asset, mint, transfer, burn } = flow;
    const prevSpore = await sporeRepo.findOneBy({ sporeId });
    if (mint) {
      if (prevSpore) {
        throw new Error(`Spore already exists when minting: ${sporeId}`);
      }
      const sporeData = await this.parseSporeData(sporeId, asset.data);
      const spore = sporeRepo.create({
        sporeId,
        ...sporeData,
        creatorAddress: mint.to,
        ownerAddress: mint.to,
        createTxHash: txHash,
        updatedAtHeight: formatSortableInt(this.blockHeight),
      });
      await sporeRepo.save(spore);
    }
    if (transfer) {
      if (!prevSpore) {
        throw new Error(`Spore not found when transferring: ${sporeId}`);
      }
      if (prevSpore.ownerAddress !== transfer.from) {
        throw new Error(
          `Spore owner mismatch when transferring: ${sporeId}, expected: ${prevSpore.ownerAddress}, actual: ${transfer.from}`,
        );
      }
      const spore = sporeRepo.create({
        ...prevSpore,
        ownerAddress: transfer.to,
        updateFromId: prevSpore.id,
        updatedAtHeight: formatSortableInt(this.blockHeight),
        id:
          prevSpore.updatedAtHeight === formatSortableInt(this.blockHeight)
            ? prevSpore.id
            : undefined,
      });
      await sporeRepo.save(spore);
    }
    if (burn) {
      if (!prevSpore) {
        throw new Error(`Spore not found when burning: ${sporeId}`);
      }
      if (prevSpore.ownerAddress !== burn.from) {
        throw new Error(
          `Spore owner mismatch when burning: ${sporeId}, expected: ${prevSpore.ownerAddress}, actual: ${burn.from}`,
        );
      }
      const spore = sporeRepo.create({
        ...prevSpore,
        ownerAddress: undefined,
        updateFromId: prevSpore.id,
        updatedAtHeight: formatSortableInt(this.blockHeight),
        id:
          prevSpore.updatedAtHeight === formatSortableInt(this.blockHeight)
            ? prevSpore.id
            : undefined,
      });
      await sporeRepo.save(spore);
    }
  }

  async handleClusterFlow(
    txHash: ccc.Hex,
    clusterId: ccc.Hex,
    flow: Flow,
    clusterRepo: ClusterRepo,
  ) {
    const { asset, mint, transfer, burn } = flow;
    const prevCluster = await clusterRepo.findOneBy({ clusterId });
    if (mint) {
      if (prevCluster) {
        throw new Error(`Cluster already exists when minting: ${clusterId}`);
      }
      const clusterData = this.parseClusterData(asset.data);
      const cluster = clusterRepo.create({
        clusterId,
        ...clusterData,
        creatorAddress: mint.to,
        ownerAddress: mint.to,
        createTxHash: txHash,
        updatedAtHeight: formatSortableInt(this.blockHeight),
      });
      await clusterRepo.save(cluster);
    }
    if (transfer) {
      if (!prevCluster) {
        throw new Error(`Cluster not found when transferring: ${clusterId}`);
      }
      if (prevCluster.ownerAddress !== transfer.from) {
        throw new Error(
          `Cluster owner mismatch when transferring: ${clusterId}, expected: ${prevCluster.ownerAddress}, actual: ${transfer.from}`,
        );
      }
      const cluster = clusterRepo.create({
        ...prevCluster,
        ownerAddress: transfer.to,
        updateFromId: prevCluster.id,
        updatedAtHeight: formatSortableInt(this.blockHeight),
        id:
          prevCluster.updatedAtHeight === formatSortableInt(this.blockHeight)
            ? prevCluster.id
            : undefined,
      });
      await clusterRepo.save(cluster);
    }
    if (burn) {
      throw new Error(`Cluster burn is not supported: ${clusterId}`);
    }
  }

  async sporeInfoHandleTx(entityManager: EntityManager, tx: ccc.Transaction) {
    const sporeFlows = await this.analyzeFlow(tx, ScriptMode.Spore);
    const clusterFlows = await this.analyzeFlow(tx, ScriptMode.Cluster);
    withTransaction(
      this.context.entityManager,
      entityManager,
      async (entityManager) => {
        const sporeRepo = new SporeRepo(entityManager);
        for (const [sporeId, flow] of Object.entries(sporeFlows)) {
          await this.handleSporeFlow(
            tx.hash(),
            ccc.hexFrom(sporeId),
            flow,
            sporeRepo,
          );
        }
        const clusterRepo = new ClusterRepo(entityManager);
        for (const [clusterId, flow] of Object.entries(clusterFlows)) {
          await this.handleClusterFlow(
            tx.hash(),
            ccc.hexFrom(clusterId),
            flow,
            clusterRepo,
          );
        }
      },
    );
  }
}
