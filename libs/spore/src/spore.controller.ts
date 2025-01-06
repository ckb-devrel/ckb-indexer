import { assert, Chain, ClusterInfo, NFTInfo, RpcError } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get } from "@nestjs/common";
import { SporeService } from "./spore.service";

@Controller()
export class SporeController {
  constructor(private readonly service: SporeService) {}

  @Get("/getSporeClusterById")
  async getSporeClusterById(
    clusterId: string,
    withDesc: boolean,
  ): Promise<ClusterInfo> {
    const cluster = assert(
      await this.service.getCluster(clusterId),
      RpcError.ClusterNotFound,
    );
    const itemsCount = await this.service.getItemsCountOfCluster(clusterId);
    const holdersCount = await this.service.getHoldersCountOfCluster(clusterId);
    const clusterType = await this.service.getClusterMode(cluster.ownerAddress);
    const { height, timestamp } = assert(
      await this.service.getBlockInfoFromTx(cluster.createTxHash),
      RpcError.TxNotFound,
    );
    const rgbppTag = !cluster.ownerAddress.startsWith("ck");
    return {
      name: cluster.name,
      description: withDesc ? cluster.description : "",
      clusterId: ccc.hexFrom(clusterId),
      itemsCount,
      holdersCount,
      owner: cluster.ownerAddress,
      creator: cluster.creatorAddress,
      clusterType,
      issueTxHeight: height,
      issueTxId: ccc.hexFrom(cluster.createTxHash),
      issueTime: timestamp,
      issueChain: rgbppTag ? Chain.Btc : Chain.Ckb,
      rgbppTag,
    };
  }

  @Get("/getSporeById")
  async getSporeById(
    sporeId: string,
    withClusterDesc: boolean,
  ): Promise<NFTInfo> {
    const spore = assert(
      await this.service.getSpore(sporeId),
      RpcError.SporeNotFound,
    );
    const { timestamp } = assert(
      await this.service.getBlockInfoFromTx(spore.createTxHash),
      RpcError.TxNotFound,
    );
    return {
      tokenId: ccc.hexFrom(sporeId),
      clusterId: spore.clusterId ? ccc.hexFrom(spore.clusterId) : undefined,
      clusterInfo: spore.clusterId
        ? await this.getSporeClusterById(spore.clusterId, withClusterDesc)
        : undefined,
      protocol: "spore",
      contentType: spore.contentType,
      content: spore.content,
      creator: spore.creatorAddress,
      owner: spore.ownerAddress,
      dobDetails: spore.dobDecoded,
      createTxId: ccc.hexFrom(spore.createTxHash),
      createTime: timestamp,
    };
  }
}
