import { formatSortableInt } from "@app/commons";
import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class BlockRepo extends Repository<Block> {
  constructor(manager: EntityManager) {
    super(Block, manager);
  }

  async getBlockByHash(hash: ccc.Hex): Promise<Block | undefined> {
    return (await this.findOneBy({ hash })) ?? undefined;
  }

  async getBlockByNumber(number: ccc.Num): Promise<Block | undefined> {
    const height = formatSortableInt(number);
    return (await this.findOneBy({ height })) ?? undefined;
  }

  async getTipBlock(): Promise<Block | undefined> {
    const blocks = await this.find({
      order: { height: "DESC" },
      take: 1,
    });
    return blocks[0];
  }

  async getBlockByHashOrNumber(params: {
    hash?: ccc.Hex;
    number?: ccc.Num;
  }): Promise<Block | undefined> {
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
