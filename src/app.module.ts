import { loadConfig } from "@app/commons/config";
import { SchemasModule } from "@app/schemas";
import { SyncModule } from "@app/sync";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CellModule } from "libs/cell/src";
import { XudtModule } from "libs/xudt/src";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
    SchemasModule,
    SyncModule,
    CellModule,
    XudtModule,
  ],
})
export class AppModule {}
