import { Module } from "@nestjs/common";
import { SyncStatusRepo, UdtInfoPendingRepo, UdtInfoRepo } from "./repos";
import { SyncService } from "./sync.service";

@Module({
  providers: [SyncService, SyncStatusRepo, UdtInfoRepo, UdtInfoPendingRepo],
  exports: [SyncService],
})
export class SyncModule {}
