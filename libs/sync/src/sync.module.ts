import { Module } from "@nestjs/common";
import { SyncStatusRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { SyncService } from "./sync.service";
import { UdtParserBuilder } from "./udtParser";
import { SyncController } from "./sync.controller";

@Module({
  providers: [
    SyncService,
    UdtParserBuilder,
    BlockRepo,
    SyncStatusRepo,
    UdtBalanceRepo,
    UdtInfoRepo,
  ],
  exports: [SyncService, UdtParserBuilder],
  controllers: [SyncController]
})
export class SyncModule {}
