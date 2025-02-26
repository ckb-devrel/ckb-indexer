import { Module } from "@nestjs/common";
import { CellController } from "./cell.controller";
import { CellService } from "./cell.service";
import { TransactionRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";

@Module({
  providers: [CellService, UdtInfoRepo, UdtBalanceRepo, TransactionRepo],
  exports: [CellService],
  controllers: [CellController],
})
export class CellModule {}
