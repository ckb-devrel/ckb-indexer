import { Cluster } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class ClusterRepo extends Repository<Cluster> {
  constructor(manager: EntityManager) {
    super(Cluster, manager);
  }

  async getClusterById(clusterId: ccc.HexLike): Promise<Cluster | null> {
    return await this.findOne({
      where: {
        clusterId: ccc.hexFrom(clusterId),
      },
      order: {
        id: "DESC",
      },
    });
  }
}
