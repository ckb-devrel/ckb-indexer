import { Module } from "@nestjs/common";
import { BlockController } from "./block.controller";
import { BlockService } from "./block.service";

@Module({
  providers: [BlockService],
  exports: [BlockService],
  controllers: [BlockController],
})
export class BlockModule {}
