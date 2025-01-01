import { Module } from "@nestjs/common";
import { CellController } from "./cell.controller";
import { CellService } from "./cell.service";

@Module({
  providers: [CellService],
  exports: [CellService],
  controllers: [CellController],
})
export class CellModule {}
