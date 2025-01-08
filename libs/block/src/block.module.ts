import { Module } from "@nestjs/common";
import { BlockController } from "./block.controller";
import { BlockService } from "./block.service";
import { BlockRepo } from "./repos";

@Module({
  providers: [BlockService, BlockRepo],
  exports: [BlockService],
  controllers: [BlockController],
})
export class BlockModule {}
