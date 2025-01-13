import { assert, Chain, ClusterInfo, NFTInfo, RpcError } from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { SporeService } from "./spore.service";

@Controller()
export class SporeController {
  constructor(private readonly service: SporeService) {}

  @ApiOkResponse({
    type: ClusterInfo,
    description: "Get an on-chain cluster by the clusterId",
  })
  @Get("/clusters/:clusterId")
  async getSporeClusterById(
    @Param("clusterId") clusterId: string,
    @Query("withDesc") withDesc?: boolean,
  ): Promise<ClusterInfo> {
    const cluster = assert(
      await this.service.getCluster(clusterId),
      RpcError.ClusterNotFound,
    );
    const itemsCount = await this.service.getItemsCountOfCluster(clusterId);
    const holdersCount = await this.service.getHoldersCountOfCluster(clusterId);
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
      issueTxHeight: height,
      issueTxId: ccc.hexFrom(cluster.createTxHash),
      issueTime: timestamp,
      issueChain: rgbppTag ? Chain.Btc : Chain.Ckb,
      rgbppTag,
    };
  }

  @ApiOkResponse({
    type: NFTInfo,
    description: "Get an on-chain spore by the sporeId",
  })
  @Get("/spores/:sporeId")
  // @Get("/spores/:sporeId?withClusterDesc=:withClusterDesc")
  async getSporeById(
    @Param("sporeId") sporeId: string,
    @Query("withClusterDesc") withClusterDesc?: boolean,
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
