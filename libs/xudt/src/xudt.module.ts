import { Module } from "@nestjs/common";
import { BlockRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { XudtController } from "./xudt.controller";
import { XudtService } from "./xudt.service";

@Module({
  providers: [XudtService, UdtInfoRepo, UdtBalanceRepo, BlockRepo],
  exports: [XudtService],
  controllers: [XudtController],
})
export class XudtModule {}
