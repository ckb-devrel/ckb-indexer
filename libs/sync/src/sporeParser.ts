import {
  assertConfig,
  formatSortableInt,
  parseBtcAddress,
  parseScriptMode,
  ScriptMode,
  withTransaction,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { cccA } from "@ckb-ccc/shell/advanced";
import { spore } from "@ckb-ccc/spore";
import { Inject, Injectable, Logger } from "@nestjs/common";
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

  public readonly rgbppBtcCodeHash: ccc.Hex;
  public readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    configService: ConfigService,
    public readonly entityManager: EntityManager,
    public readonly sporeRepo: SporeRepo,
    @Inject("BTC_REQUESTERS") private readonly btcRequesters: AxiosInstance[],
  ) {
    const isMainnet = configService.get<boolean>("sync.isMainnet");
    const ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.client = isMainnet
      ? new ccc.ClientPublicMainnet({ url: ckbRpcUri })
      : new ccc.ClientPublicTestnet({ url: ckbRpcUri });

    this.decoderUri = assertConfig(configService, "sync.decoderServerUri");
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

  async getDobDecodedBySporeId(sporeId: ccc.Hex): Promise<string | undefined> {
    return await this.sporeRepo.getDobBySporeId(sporeId);
  }
}

interface SporeDetail {
  content: string;
  contentType: string;
  clusterId?: string;
  dobDecoded?: string;
}

interface ClusterDetial {
  name: string;
  description: string;
}

interface Flow {
  asset: {
    ownerScript: ccc.Script;
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
      const expectedMode = await parseScriptMode(
        cellOutput.type,
        this.context.client,
      );
      if (expectedMode !== mode) {
        continue;
      }
      const address = await this.context.scriptToAddress(cellOutput.lock);
      const sporeOrClusterId = cellOutput.type.args;
      flows[sporeOrClusterId] = {
        asset: {
          ownerScript: cellOutput.lock,
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
      const expectedMode = await parseScriptMode(
        output.type,
        this.context.client,
      );
      if (expectedMode !== mode) {
        continue;
      }
      const address = await this.context.scriptToAddress(output.lock);
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
            ownerScript: output.lock,
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
        try {
          flow.asset.spore = await this.parseSporeData(
            ccc.hexFrom(id),
            flow.asset.data,
          );
        } catch (err) {
          this.context.logger.warn(`Invalid spore data id ${ccc.hexFrom(id)}`);
        }
      } else {
        try {
          flow.asset.cluster = this.parseClusterData(flow.asset.data);
        } catch (err) {
          this.context.logger.warn(
            `Invalid cluster data id ${ccc.hexFrom(id)}`,
          );
        }
      }
      flows[id] = flow;
    }

    return flows;
  }

  async parseSporeData(sporeId: ccc.Hex, data: ccc.Hex): Promise<SporeDetail> {
    const sporeData = cccA.sporeA.unpackToRawSporeData(data);
    const decoded = {
      contentType: sporeData.contentType,
      content: ccc.hexFrom(sporeData.content),
      clusterId: sporeData.clusterId
        ? ccc.hexFrom(sporeData.clusterId)
        : undefined,
    };
    if (decoded.clusterId) {
      const cluster = await ccc.spore.findCluster(
        this.context.client,
        decoded.clusterId,
      );
      if (cluster === undefined) {
        throw new Error(
          `Spore data broken, cluster not found: ${decoded.clusterId}`,
        );
      }
      try {
        let dobDecoded = await this.context.getDobDecodedBySporeId(sporeId);
        if (dobDecoded === undefined) {
          const dobRenderOutput = await spore.dob.decodeDobByRawData(
            data,
            cluster.cell.outputData,
            this.context.decoderUri,
          );
          dobDecoded = JSON.stringify(dobRenderOutput);
        }
        Object.assign(decoded, { dobDecoded });
      } catch (error) {
        this.context.logger.warn(`Spore ${sporeId}: ${error}`);
      }
    }
    return decoded;
  }

  parseClusterData(data: ccc.Hex): ClusterDetial {
    return cccA.sporeA.unpackToRawClusterData(data);
  }

  async handleSporeFlow(
    txHash: ccc.Hex,
    sporeId: ccc.Hex,
    flow: Flow,
    sporeRepo: SporeRepo,
    clusterRepo: ClusterRepo,
  ) {
    const { asset, mint, transfer, burn } = flow;
    if (!flow.asset.spore) {
      return;
    }
    const prevSpore = await sporeRepo.findOne({
      where: { sporeId },
      order: { updatedAtHeight: "DESC" },
    });

    if (mint) {
      if (prevSpore) {
        throw new Error(
          `Spore already exists when minting ${sporeId}, at tx ${txHash}`,
        );
      }
      let creatorAddress = mint.to;
      if (asset.spore?.clusterId !== undefined) {
        const cluster = await clusterRepo.findOne({
          where: { clusterId: asset.spore?.clusterId },
          order: { updatedAtHeight: "DESC" },
        });
        if (cluster === null) {
          this.context.logger.warn(
            `Cluster not found when minting spore ${sporeId} at tx ${txHash}`,
          );
        } else {
          creatorAddress = cluster.ownerAddress;
        }
      }
      const spore = sporeRepo.create({
        sporeId,
        ...asset.spore,
        creatorAddress,
        ownerAddress: mint.to,
        createTxHash: txHash,
        updatedAtHeight: formatSortableInt(this.blockHeight),
      });
      await sporeRepo.save(spore);
      this.context.logger.log(`Mint Spore ${sporeId} at tx ${txHash}`);
    }

    if (transfer) {
      if (prevSpore && prevSpore.ownerAddress !== transfer.from) {
        throw new Error(
          `Spore owner mismatch when transferring ${sporeId}, expected: ${prevSpore.ownerAddress}, actual: ${transfer.from}, at tx ${txHash}`,
        );
      }
      if (!prevSpore) {
        this.context.logger.warn(
          `Spore not found when transferring ${sporeId} at tx ${txHash}`,
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
    }

    if (burn) {
      if (prevSpore && prevSpore.ownerAddress !== burn.from) {
        throw new Error(
          `Spore owner mismatch when burning ${sporeId}, expected: ${prevSpore.ownerAddress}, actual: ${burn.from}, at tx ${txHash}`,
        );
      }
      if (!prevSpore) {
        this.context.logger.warn(
          `Spore not found when burning ${sporeId} at tx ${txHash}`,
        );
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
    }
  }

  async handleClusterFlow(
    txHash: ccc.Hex,
    clusterId: ccc.Hex,
    flow: Flow,
    clusterRepo: ClusterRepo,
  ) {
    const { asset, mint, transfer, burn } = flow;
    if (!flow.asset.cluster) {
      return;
    }
    const prevCluster = await clusterRepo.findOne({
      where: { clusterId },
      order: { updatedAtHeight: "DESC" },
    });

    if (mint) {
      if (prevCluster) {
        throw new Error(`Cluster already exists when minting: ${clusterId}`);
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
      this.context.logger.log(
        `Mint Cluster ${asset.cluster?.name}(${clusterId}) at tx ${txHash}`,
      );
    }

    if (transfer) {
      if (prevCluster && prevCluster.ownerAddress !== transfer.from) {
        throw new Error(
          `Cluster owner mismatch when transferring: ${clusterId}, expected: ${prevCluster.ownerAddress}, actual: ${transfer.from}`,
        );
      }
      if (!prevCluster) {
        this.context.logger.warn(
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
    }

    if (burn) {
      throw new Error(
        `Cluster burn is not supported: ${clusterId}, at tx ${txHash}`,
      );
    }
  }

  async analyzeTxFlow(tx: ccc.Transaction): Promise<{
    sporeFlows: Record<string, Flow>;
    clusterFlows: Record<string, Flow>;
  }> {
    const sporeFlows = await this.analyzeFlow(tx, ScriptMode.Spore);
    const clusterFlows = await this.analyzeFlow(tx, ScriptMode.Cluster);
    return { sporeFlows, clusterFlows };
  }

  async handleFlows(
    entityManager: EntityManager,
    tx: ccc.Transaction,
    flows: {
      sporeFlows: Record<string, Flow>;
      clusterFlows: Record<string, Flow>;
    },
  ) {
    await withTransaction(
      this.context.entityManager,
      entityManager,
      async (entityManager) => {
        const sporeRepo = new SporeRepo(entityManager);
        const clusterRepo = new ClusterRepo(entityManager);

        for (const [sporeId, flow] of Object.entries(flows.sporeFlows)) {
          await this.handleSporeFlow(
            tx.hash(),
            ccc.hexFrom(sporeId),
            flow,
            sporeRepo,
            clusterRepo,
          );
        }

        for (const [clusterId, flow] of Object.entries(flows.clusterFlows)) {
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
