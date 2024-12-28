import { UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtInfoRepo extends Repository<UdtInfo> {
  constructor(manager: EntityManager) {
    super(UdtInfo, manager);
  }

  async getTokenInfoByTokenId(tokenHash: ccc.HexLike): Promise<UdtInfo | null> {
    return await this.findOneBy({ hash: ccc.hexFrom(tokenHash) });
  }
}
