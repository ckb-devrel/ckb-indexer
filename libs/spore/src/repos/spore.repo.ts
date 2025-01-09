import { Spore } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class SporeRepo extends Repository<Spore> {
  constructor(manager: EntityManager) {
    super(Spore, manager);
  }

  async getSporeCountByClusterId(clusterId: ccc.HexLike): Promise<number> {
    return await this.manager
      .createQueryBuilder(Spore, "spore")
      .select("max(id)")
      .where("spore.clusterId = :clusterId", {
        clusterId: ccc.hexFrom(clusterId),
      })
      .groupBy("spore.sporeId")
      .getCount();
  }

  async getHolderCountByClusterId(clusterId: ccc.HexLike): Promise<number> {
    return await this.manager
      .createQueryBuilder(Spore, "spore")
      .select("max(id)")
      .where("spore.clusterId = :clusterId", {
        clusterId: ccc.hexFrom(clusterId),
      })
      .groupBy("spore.ownerAddress")
      .getCount();
  }

  async getSpore(sporeId: ccc.HexLike): Promise<Spore | null> {
    return await this.findOne({
      where: {
        sporeId: ccc.hexFrom(sporeId),
      },
      order: {
        updatedAtHeight: "DESC",
      },
    });
  }
}
