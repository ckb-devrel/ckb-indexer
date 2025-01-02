import { UdtBalance } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtBalanceRepo extends Repository<UdtBalance> {
  constructor(manager: EntityManager) {
    super(UdtBalance, manager);
  }

  async getCkbAddressByBtcAddress(
    btcAddress: string,
  ): Promise<string | undefined> {
    if (btcAddress.startsWith("ck")) {
      return undefined;
    }
    const udtBalance = await this.findOneBy({ address: btcAddress });
    return udtBalance?.ckbAddress;
  }
}
