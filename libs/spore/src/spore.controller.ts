import {
  ApiError,
  assert,
  Chain,
  ClusterInfo,
  NFTInfo,
  RpcError,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { SporeService } from "./spore.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

@Controller()
export class SporeController {
  constructor(private readonly service: SporeService) {}

  @ApiOkResponse({
    type: ClusterInfo,
    description: "Get an on-chain cluster by the clusterId",
  })
  @ApiQuery({
    name: "withDesc",
    required: false,
  })
  @Get("/clusters/:clusterId")
  async getSporeClusterById(
    @Param("clusterId") clusterId: string,
    @Query("withDesc") withDesc?: boolean,
  ): Promise<ClusterInfo | ApiError> {
    try {
      const cluster = assert(
        await this.service.getCluster(clusterId),
        RpcError.ClusterNotFound,
      );
      const itemsCount = await this.service.getItemsCountOfCluster(clusterId);
      const holdersCount =
        await this.service.getHoldersCountOfCluster(clusterId);
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
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }

  @ApiOkResponse({
    type: NFTInfo,
    description: "Get an on-chain spore by the sporeId",
  })
  @ApiQuery({
    name: "withClusterDesc",
    required: false,
  })
  @Get("/spores/:sporeId")
  async getSporeById(
    @Param("sporeId") sporeId: string,
    @Query("withClusterDesc") withClusterDesc?: boolean,
  ): Promise<NFTInfo | ApiError> {
    try {
      const spore = assert(
        await this.service.getSpore(sporeId),
        RpcError.SporeNotFound,
      );
      const { timestamp } = assert(
        await this.service.getBlockInfoFromTx(spore.createTxHash),
        RpcError.TxNotFound,
      );
      let clusterInfo: ClusterInfo | undefined = undefined;
      if (spore.clusterId) {
        const cluster = await this.getSporeClusterById(
          spore.clusterId,
          withClusterDesc,
        );
        if (cluster instanceof ClusterInfo) {
          clusterInfo = cluster;
        }
      }
      return {
        tokenId: ccc.hexFrom(sporeId),
        clusterId: spore.clusterId ? ccc.hexFrom(spore.clusterId) : undefined,
        clusterInfo,
        contentType: spore.contentType,
        content: spore.content,
        creator: spore.creatorAddress,
        owner: spore.ownerAddress,
        dobDetails: spore.dobDecoded,
        createTxId: ccc.hexFrom(spore.createTxHash),
        createTime: timestamp,
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }
}
