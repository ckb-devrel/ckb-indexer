import { Module } from "@nestjs/common";
import { AssetController } from "./asset.controller";
import { AssetService } from "./asset.service";
import { UdtInfoRepo } from "./repos";

@Module({
  providers: [AssetService, UdtInfoRepo],
  exports: [AssetService],
  controllers: [AssetController],
})
export class AssetModule {}
