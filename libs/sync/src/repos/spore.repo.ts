import { Spore } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class SporeRepo extends Repository<Spore> {
  constructor(manager: EntityManager) {
    super(Spore, manager);
  }

  async getDobBySporeId(sporeId: string): Promise<string | undefined> {
    const spore = await this.findOne({ where: { sporeId } });
    return spore?.dobDecoded;
  }
}
