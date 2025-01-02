import { Module } from "@nestjs/common";
import { SporeController } from "./spore.controller";
import { SporeService } from "./spore.service";

@Module({
  providers: [SporeService],
  exports: [SporeService],
  controllers: [SporeController],
})
export class SporeModule {}
