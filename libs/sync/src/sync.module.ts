import { Module } from "@nestjs/common";
import { SyncStatusRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { SyncService } from "./sync.service";
import { UdtParserBuilder } from "./udtParser";

@Module({
  providers: [
    SyncService,
    UdtParserBuilder,
    SyncStatusRepo,
    UdtBalanceRepo,
    UdtInfoRepo,
  ],
  exports: [SyncService],
})
export class SyncModule {}
