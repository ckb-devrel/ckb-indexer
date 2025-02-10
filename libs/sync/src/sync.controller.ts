import {
  ApiError,
  assert,
  NormalizedReturn,
  parseSortableInt,
  RpcError,
  TrackerInfo,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { SyncService } from "./sync.service";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

@Controller()
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @ApiOkResponse({
    type: TrackerInfo,
    description: "Get current tracker running status quo",
  })
  @Get("/trackerInfo")
  async getTrackerInfo(): Promise<NormalizedReturn<TrackerInfo>> {
    try {
      const dbTip = assert(
        await this.service.getBlockHeader({
          fromDb: true,
        }),
        RpcError.BlockNotFound,
      );
      const nodeTip = assert(
        await this.service.getBlockHeader({
          fromDb: false,
        }),
        RpcError.BlockNotFound,
      );
      return {
        code: 0,
        data: {
          trackerBlockHeight: parseSortableInt(dbTip.height),
          trackerBestBlockHash: ccc.hexFrom(dbTip.hash),
          nodeBlockHeight: parseSortableInt(nodeTip.height),
          nodeBestBlockHash: ccc.hexFrom(nodeTip.hash),
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
