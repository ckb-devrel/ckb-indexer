import { assert, BlockHeader, parseSortableInt, RpcError } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { BlockService } from "./block.service";

@Controller()
export class BlockController {
  constructor(private readonly service: BlockService) {}

  @ApiOkResponse({
    type: BlockHeader,
    description: "Get tip block",
  })
  @Get("/getLatestBlock")
  async getLatestBlock(): Promise<BlockHeader> {
    const tipHeader = assert(
      await this.service.getBlockHeader({
        fromDb: false,
      }),
      RpcError.BlockNotFound,
    );
    return {
      version: 0,
      preHash: ccc.hexFrom(tipHeader.parentHash),
      height: ccc.numFrom(tipHeader.height),
      timestamp: tipHeader.timestamp,
      hash: ccc.hexFrom(tipHeader.hash),
    };
  }

  @ApiOkResponse({
    type: BlockHeader,
    description: "Get block by block number",
  })
  @Get("/getBlockHeaderByNumber")
  async getBlockHeaderByNumber(
    @Param("blockNumber") blockNumber: number,
  ): Promise<BlockHeader> {
    const blockHeader = assert(
      await this.service.getBlockHeader({
        blockNumber,
        fromDb: false,
      }),
      RpcError.BlockNotFound,
    );
    return {
      version: 0,
      preHash: ccc.hexFrom(blockHeader.parentHash),
      height: parseSortableInt(blockHeader.height),
      timestamp: blockHeader.timestamp,
      hash: ccc.hexFrom(blockHeader.hash),
    };
  }
}
