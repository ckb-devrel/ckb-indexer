import {
  ApiError,
  assert,
  parseSortableInt,
  RpcError,
  TrackerInfo,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { SyncService } from "./sync.service";

(BigInt.prototype as any).toJSON = function () {
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
  async getTrackerInfo(): Promise<TrackerInfo | ApiError> {
    try {
      const dbTip = assert(
        await this.service.getBlockHeader({
          fromDb: false,
        }),
        RpcError.BlockNotFound,
      );
      const nodeTip = assert(
        await this.service.getBlockHeader({
          fromDb: true,
        }),
        RpcError.BlockNotFound,
      );
      return {
        trackerBlockHeight: parseSortableInt(dbTip.height),
        trackerBestBlockHash: ccc.hexFrom(dbTip.hash),
        nodeBlockHeight: parseSortableInt(nodeTip.height),
        nodeBestBlockHash: ccc.hexFrom(nodeTip.hash),
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return e;
      }
      throw e;
    }
  }
}
