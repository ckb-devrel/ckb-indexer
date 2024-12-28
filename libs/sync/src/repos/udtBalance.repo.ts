import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtBalanceRepo extends Repository<UdtBalance> {
  constructor(manager: EntityManager) {
    super(UdtBalance, manager);
  }

  async getTokenBalance(
    address: string,
    tokenHash?: ccc.HexLike,
  ): Promise<UdtBalance[]> {
    const addressHash = ccc.hashCkb(address);
    if (tokenHash) {
      return await this.findBy({
        addressHash,
        tokenHash: ccc.hexFrom(tokenHash),
      });
    } else {
      return await this.findBy({ addressHash });
    }
  }

  async getItemCountByTokenHash(tokenHash: ccc.HexLike): Promise<number> {
    return await this.countBy({ tokenHash: ccc.hexFrom(tokenHash) });
  }
}
