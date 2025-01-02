import { Module } from "@nestjs/common";
import { CellController } from "./cell.controller";
import { CellService } from "./cell.service";
import { UdtBalanceRepo, UdtInfoRepo } from "./repos";

@Module({
  providers: [CellService, UdtInfoRepo, UdtBalanceRepo],
  exports: [CellService],
  controllers: [CellController],
})
export class CellModule {}
