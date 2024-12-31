import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { parseSortableInt } from "../ormUtils";

export class BlockWrap {
  constructor(
    public readonly hash: ccc.Hex,
    public readonly parentHash: ccc.Hex,
    public readonly height: ccc.Num,
    public readonly timestamp: number,
    public readonly version: number,
  ) {}

  public static from(
    block: Block | ccc.ClientBlockHeader | undefined | null,
  ): BlockWrap | undefined {
    if (!block) {
      return undefined;
    }
    if (block instanceof Block) {
      return new BlockWrap(
        ccc.hexFrom(block.hash),
        ccc.hexFrom(block.parentHash),
        parseSortableInt(block.height),
        block.timestamp,
        0,
      );
    } else {
      return new BlockWrap(
        block.hash,
        block.parentHash,
        block.number,
        Number(block.timestamp),
        Number(block.version),
      );
    }
  }
}
