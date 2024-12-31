import { Module } from "@nestjs/common";
import { SyncStatusRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { ClusterRepo } from "./repos/cluster.repo";
import { SporeRepo } from "./repos/spore.repo";
import { SporeParserBuilder } from "./sporeParser";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { UdtParser } from "./udtParser";

@Module({
  providers: [
    SyncService,
    SporeParserBuilder,
    UdtParser,
    BlockRepo,
    SyncStatusRepo,
    UdtBalanceRepo,
    UdtInfoRepo,
    SporeRepo,
    ClusterRepo,
  ],
  exports: [SyncService, UdtParser, SporeParserBuilder],
  controllers: [SyncController],
})
export class SyncModule {}
