import { Module } from "@nestjs/common";
import { BlockRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { UdtController } from "./udt.controller";
import { UdtService } from "./udt.service";

@Module({
  providers: [UdtService, UdtInfoRepo, UdtBalanceRepo, BlockRepo],
  exports: [UdtService],
  controllers: [UdtController],
})
export class UdtModule {}
