import { Block } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class BlockRepo extends Repository<Block> {
  constructor(manager: EntityManager) {
    super(Block, manager);
  }
}
