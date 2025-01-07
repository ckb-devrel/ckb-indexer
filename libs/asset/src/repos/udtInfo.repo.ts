import { UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtInfoRepo extends Repository<UdtInfo> {
  constructor(manager: EntityManager) {
    super(UdtInfo, manager);
  }

  async getTokenInfo(tokenHash: ccc.HexLike): Promise<UdtInfo | undefined> {
    return (
      (await this.findOne({
        where: {
          hash: ccc.hexFrom(tokenHash),
        },
        order: {
          updatedAtHeight: "DESC",
        },
      })) ?? undefined
    );
  }
}
