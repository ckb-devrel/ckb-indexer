import { assert, parseSortableInt, RpcError, TrackerInfo } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get } from "@nestjs/common";
import { SyncService } from "./sync.service";

@Controller()
export class SyncController {
  constructor(private readonly service: SyncService) {}

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
