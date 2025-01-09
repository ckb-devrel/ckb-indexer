import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtBalanceRepo extends Repository<UdtBalance> {
  constructor(manager: EntityManager) {
    super(UdtBalance, manager);
  }

  async getTokenByAddress(
    address: string,
    tokenHash?: ccc.HexLike,
  ): Promise<UdtBalance[]> {
    const addressHash = ccc.hashCkb(address);
    if (tokenHash) {
      return await this.find({
        where: {
          addressHash,
          tokenHash: ccc.hexFrom(tokenHash),
        },
        order: { updatedAtHeight: "DESC" },
        take: 1,
      });
    } else {
      const groupByTokenHash = await this.manager
        .createQueryBuilder(UdtBalance, "udtBalance")
        .select("max(id)")
        .where("udtBalance.addressHash = :addressHash", { addressHash })
        .groupBy("udtBalance.tokenHash")
        .getSql();
      return await this.manager
        .createQueryBuilder(UdtBalance, "udtBalance")
        .select("udtBalance.*")
        .where(`id IN (${groupByTokenHash})`)
        .getMany();
    }
  }

  async getTokenByTokenId(tokenHash: ccc.HexLike): Promise<UdtBalance[]> {
    const groupByAddresHash = await this.manager
      .createQueryBuilder(UdtBalance, "udtBalance")
      .select("max(id)")
      .where("udtBalance.tokenHash = :tokenHash", {
        tokenHash: ccc.hexFrom(tokenHash),
      })
      .groupBy("udtBalance.addressHash")
      .getSql();
    return await this.manager
      .createQueryBuilder(UdtBalance, "udtBalance")
      .select("udtBalance.*")
      .where(`id In (${groupByAddresHash})`)
      .getMany();
  }

  async getItemCountByTokenHash(tokenHash: ccc.HexLike): Promise<number> {
    return await this.manager
      .createQueryBuilder(UdtBalance, "udtBalance")
      .select("max(id)")
      .where("udtBalance.tokenHash = :tokenHash", {
        tokenHash: ccc.hexFrom(tokenHash),
      })
      .groupBy("udtBalance.tokenHash")
      .getCount();
  }
}
