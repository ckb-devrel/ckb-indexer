import { Module } from "@nestjs/common";
import { ClusterRepo, SporeRepo } from "./repos";
import { SporeController } from "./spore.controller";
import { SporeService } from "./spore.service";

@Module({
  providers: [SporeService, SporeRepo, ClusterRepo],
  exports: [SporeService],
  controllers: [SporeController],
})
export class SporeModule {}
