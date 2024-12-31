import { Module } from "@nestjs/common";
import { XudtController } from "./xudt.controller";
import { XudtService } from "./xudt.service";

@Module({
  providers: [XudtService],
  exports: [XudtService],
  controllers: [XudtController],
})
export class XudtModule {}
