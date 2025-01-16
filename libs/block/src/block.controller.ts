import {
  ApiError,
  assert,
  BlockHeader,
  parseSortableInt,
  RpcError,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { BlockService } from "./block.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

@Controller()
export class BlockController {
  constructor(private readonly service: BlockService) {}

  @ApiOkResponse({
    type: BlockHeader,
    description: "Get tip block",
  })
  @Get("/blocks/latest")
  async getLatestBlock(): Promise<BlockHeader | ApiError> {
    try {
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
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }

  @ApiOkResponse({
    type: BlockHeader,
    description: "Get block by block number",
  })
  @Get("/blocks/by-number/:blockNumber")
  async getBlockHeaderByNumber(
    @Param("blockNumber") blockNumber: number,
  ): Promise<BlockHeader | ApiError> {
    try {
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
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }
}
