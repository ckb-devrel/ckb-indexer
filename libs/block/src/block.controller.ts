import {
  ApiError,
  assert,
  BlockHeader,
  NormalizedReturn,
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
  async getLatestBlock(): Promise<NormalizedReturn<BlockHeader>> {
    try {
      const tipHeader = assert(
        await this.service.getBlockHeader({
          fromDb: false,
        }),
        RpcError.BlockNotFound,
      );
      return {
        code: 0,
        data: {
          version: 0,
          preHash: ccc.hexFrom(tipHeader.parentHash),
          height: ccc.numFrom(tipHeader.height),
          timestamp: tipHeader.timestamp,
          hash: ccc.hexFrom(tipHeader.hash),
        },
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return {
          code: -1,
          msg: e.message,
        };
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
  ): Promise<NormalizedReturn<BlockHeader>> {
    try {
      const blockHeader = assert(
        await this.service.getBlockHeader({
          blockNumber,
          fromDb: false,
        }),
        RpcError.BlockNotFound,
      );
      return {
        code: 0,
        data: {
          version: 0,
          preHash: ccc.hexFrom(blockHeader.parentHash),
          height: parseSortableInt(blockHeader.height),
          timestamp: blockHeader.timestamp,
          hash: ccc.hexFrom(blockHeader.hash),
        },
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return {
          code: -1,
          msg: e.message,
        };
      }
      throw e;
    }
  }
}
