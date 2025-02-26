import { Module } from "@nestjs/common";
import { AssetController } from "./asset.controller";
import { AssetService } from "./asset.service";
import { ClusterRepo, SporeRepo, TransactionRepo, UdtInfoRepo } from "./repos";

@Module({
  providers: [
    AssetService,
    UdtInfoRepo,
    SporeRepo,
    ClusterRepo,
    TransactionRepo,
  ],
  exports: [AssetService],
  controllers: [AssetController],
})
export class AssetModule {}
