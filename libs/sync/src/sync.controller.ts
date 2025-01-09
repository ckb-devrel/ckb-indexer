import { assert, parseSortableInt, RpcError, TrackerInfo } from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { SyncService } from "./sync.service";

@Controller()
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @ApiOkResponse({
    type: TrackerInfo,
    description: "Get current tracker running status quo",
  })
  @Get("/getTrackerInfo")
  async getTrackerInfo(): Promise<TrackerInfo> {
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
  }
}
