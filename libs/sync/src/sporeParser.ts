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

    this.decoderUri = assertConfig(configService, "sync.decoderServerUri");
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

interface SporeDetail {
  content: string;
  contentType: string;
  clusterId?: ccc.Hex;
  dobDecoded?: string;
}

interface ClusterDetial {
  name: string;
  description: string;
}

interface Flow {
  asset: {
    script: ccc.Script;
    data: ccc.Hex;
    spore?: SporeDetail;
    cluster?: ClusterDetial;
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
    try {
      return await parseAddress(scriptLike, this.context.client, {
        btcRequester: this.context.btcRequester,
        rgbppBtcCodeHash: this.context.rgbppBtcCodeHash,
        rgbppBtcHashType: this.context.rgbppBtcHashType,
      });
    } catch (error) {
      this.context.logger.error(`Failed to parse address: ${error}`);
      return {
        address: ccc.Address.fromScript(
          scriptLike,
          this.context.client,
        ).toString(),
      };
    }
  }

  async analyzeFlow(
    tx: ccc.Transaction,
    mode: ScriptMode,
  ): Promise<Record<string, Flow>> {
    const flows: Record<string, Flow> = {};

    // Collect all spore or cluster in the inputs
    for (const input of tx.inputs) {
      const { cellOutput, outputData } = input;
      if (!cellOutput || !outputData || !cellOutput.type) {
        continue;
      }
      const expectedMode = await parseScriptMode(cellOutput.type, this.context.client);
      if (expectedMode !== mode) {
        continue;
      }
      const { address } = await this.scriptToAddress(cellOutput.lock);
      const sporeOrClusterId = cellOutput.type.args;
      flows[sporeOrClusterId] = {
        asset: {
          script: cellOutput.type,
          data: outputData,
        },
        burn: {
          from: address,
        },
      };
    }

    // Collect and update all spore or cluster from the outputs
    for (const [index, output] of tx.outputs.entries()) {
      if (!output.type) {
        continue;
      }
      const expectedMode = await parseScriptMode(output.type, this.context.client);
      if (expectedMode !== mode) {
        continue;
      }
      const { address } = await this.scriptToAddress(output.lock);
      const sporeOrClusterId = output.type.args;
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
            script: output.type,
            data: tx.outputsData[index],
          },
          mint: {
            to: address,
          },
        };
      }
    }

    // Parse spore or cluster data before the persistence
    for (const [id, flow] of Object.entries(flows)) {
      if (mode === ScriptMode.Spore) {
        flow.asset.spore = await this.parseSporeData(
          ccc.hexFrom(id),
          flow.asset.data,
        );
      } else {
        flow.asset.cluster = this.parseClusterData(flow.asset.data);
      }
      flows[id] = flow;
    }

    return flows;
  }

  async parseSporeData(sporeId: ccc.Hex, data: ccc.Hex): Promise<SporeDetail> {
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

  parseClusterData(data: ccc.Hex): ClusterDetial {
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
        this.context.logger.error(
          `Spore already exists when minting: ${sporeId}`,
        );
        await sporeRepo.delete(prevSpore);
      }
      const spore = sporeRepo.create({
        sporeId,
        ...asset.spore,
        creatorAddress: mint.to,
        ownerAddress: mint.to,
        createTxHash: txHash,
        updatedAtHeight: formatSortableInt(this.blockHeight),
      });
      await sporeRepo.save(spore);
      this.context.logger.log(`Mint Spore ${sporeId} at tx ${txHash}`);
    }

    if (transfer) {
      if (prevSpore && prevSpore.ownerAddress !== transfer.from) {
        this.context.logger.error(
          `Spore owner mismatch when transferring: ${sporeId}, expected: ${prevSpore.ownerAddress}, actual: ${transfer.from}`,
        );
        await sporeRepo.delete(prevSpore);
      }
      if (!prevSpore) {
        this.context.logger.error(
          `Spore not found when transferring: ${sporeId}`,
        );
      }
      const spore = sporeRepo.create({
        ...(prevSpore ?? {
          sporeId,
          ...asset.spore,
          creatorAddress: transfer.from,
          createTxHash: txHash,
        }),
        ownerAddress: transfer.to,
        updatedAtHeight: formatSortableInt(this.blockHeight),
        id:
          prevSpore?.updatedAtHeight === formatSortableInt(this.blockHeight)
            ? prevSpore.id
            : undefined,
      });
      await sporeRepo.save(spore);
      this.context.logger.log(`Transfer Spore ${sporeId} at tx ${txHash}`);
    }

    if (burn) {
      if (prevSpore && prevSpore.ownerAddress !== burn.from) {
        this.context.logger.error(
          `Spore owner mismatch when burning: ${sporeId}, expected: ${prevSpore.ownerAddress}, actual: ${burn.from}`,
        );
        await sporeRepo.delete(prevSpore);
      }
      if (!prevSpore) {
        this.context.logger.error(`Spore not found when burning: ${sporeId}`);
      }
      const spore = sporeRepo.create({
        ...(prevSpore ?? {
          sporeId,
          ...asset.spore,
          creatorAddress: burn.from,
          createTxHash: txHash,
        }),
        ownerAddress: undefined,
        updatedAtHeight: formatSortableInt(this.blockHeight),
        id:
          prevSpore?.updatedAtHeight === formatSortableInt(this.blockHeight)
            ? prevSpore.id
            : undefined,
      });
      await sporeRepo.save(spore);
      this.context.logger.log(`Burn Spore ${sporeId} at tx ${txHash}`);
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
        this.context.logger.error(
          `Cluster already exists when minting: ${clusterId}`,
        );
        await clusterRepo.delete(prevCluster);
      }
      const cluster = clusterRepo.create({
        clusterId,
        ...asset.cluster,
        creatorAddress: mint.to,
        ownerAddress: mint.to,
        createTxHash: txHash,
        updatedAtHeight: formatSortableInt(this.blockHeight),
      });
      await clusterRepo.save(cluster);
      this.context.logger.log(`Mint Cluster ${clusterId} at tx ${txHash}`);
    }

    if (transfer) {
      if (prevCluster && prevCluster.ownerAddress !== transfer.from) {
        this.context.logger.error(
          `Cluster owner mismatch when transferring: ${clusterId}, expected: ${prevCluster.ownerAddress}, actual: ${transfer.from}`,
        );
        await clusterRepo.delete(prevCluster);
      }
      if (!prevCluster) {
        this.context.logger.error(
          `Cluster not found when transferring: ${clusterId}`,
        );
      }
      const cluster = clusterRepo.create({
        ...(prevCluster ?? {
          clusterId,
          ...asset.cluster,
          creatorAddress: transfer.from,
          createTxHash: txHash,
        }),
        ownerAddress: transfer.to,
        updatedAtHeight: formatSortableInt(this.blockHeight),
        id:
          prevCluster?.updatedAtHeight === formatSortableInt(this.blockHeight)
            ? prevCluster.id
            : undefined,
      });
      await clusterRepo.save(cluster);
      this.context.logger.log(`Transfer Cluster ${clusterId} at tx ${txHash}`);
    }

    if (burn) {
      this.context.logger.error(`Cluster burn is not supported: ${clusterId}`);
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
        const clusterRepo = new ClusterRepo(entityManager);

        for (const [sporeId, flow] of Object.entries(sporeFlows)) {
          await this.handleSporeFlow(
            tx.hash(),
            ccc.hexFrom(sporeId),
            flow,
            sporeRepo,
          );
        }

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
