import { Module } from "@nestjs/common";
import { SyncStatusRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { SyncAgent } from "./sync.agent";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { UdtParserBuilder } from "./udtParser";

@Module({
  providers: [
    SyncService,
    UdtParserBuilder,
    BlockRepo,
    SyncStatusRepo,
    UdtBalanceRepo,
    UdtInfoRepo,
    SyncAgent,
  ],
  exports: [SyncService, UdtParserBuilder, SyncAgent],
  controllers: [SyncController],
})
export class SyncModule {}
