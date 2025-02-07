import {
  ApiError,
  assert,
  BlockHeader,
  NormalizedReturn,
  parseSortableInt,
  RpcError,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
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
  @ApiQuery({
    name: "fromDb",
    required: false,
    default: true,
    description:
      "Determine whether to get the block from the database or from the CKB node",
  })
  @Get("/blocks/latest")
  async getLatestBlock(
    @Query("fromDb") fromDb: boolean = true,
  ): Promise<NormalizedReturn<BlockHeader>> {
    try {
      const tipHeader = assert(
        await this.service.getBlockHeader({
          fromDb,
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
  @ApiQuery({
    name: "fromDb",
    required: false,
    default: true,
    description:
      "Determine whether to get the block from the database or from the CKB node",
  })
  @Get("/blocks/by-number/:blockNumber")
  async getBlockHeaderByNumber(
    @Param("blockNumber") blockNumber: number,
    @Query("fromDb") fromDb: boolean = true,
  ): Promise<NormalizedReturn<BlockHeader>> {
    try {
      const blockHeader = assert(
        await this.service.getBlockHeader({
          blockNumber,
          fromDb,
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
