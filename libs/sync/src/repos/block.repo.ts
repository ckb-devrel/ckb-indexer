import { formatSortableInt } from "@app/commons";
import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class BlockRepo extends Repository<Block> {
  constructor(manager: EntityManager) {
    super(Block, manager);
  }

  async getBlockByHash(hash: ccc.Hex): Promise<Block | null> {
    return await this.findOneBy({ hash });
  }

  async getBlockByNumber(number: ccc.Num): Promise<Block | null> {
    const height = formatSortableInt(number);
    return await this.findOneBy({ height });
  }

  async getBlock(params: {
    hash?: ccc.Hex;
    number?: ccc.Num;
  }): Promise<Block | null> {
    const { hash, number } = params;
    if (hash) {
      return await this.getBlockByHash(hash);
    } else if (number) {
      return await this.getBlockByNumber(number);
    } else {
      throw new Error("One of the block hash or number should be provided");
    }
  }
}
