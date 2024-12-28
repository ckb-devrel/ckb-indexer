import { Module } from "@nestjs/common";
import { SyncStatusRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { SyncController } from "./sync.controller";
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
<<<<<<< HEAD
  controllers: [SyncController],
=======
  controllers: [SyncController]
>>>>>>> c92dbd5 (feat(WIP): add controller module)
})
export class SyncModule {}
