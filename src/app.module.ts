import { loadConfig } from "@app/commons/config";
import { SchemasModule } from "@app/schemas";
import { SyncModule } from "@app/sync";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AssetModule } from "libs/asset/src";
import { BlockModule } from "libs/block/src";
import { CellModule } from "libs/cell/src";
import { SporeModule } from "libs/spore/src";
import { UdtModule } from "libs/udt/src";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
    SchemasModule,
    SyncModule,
    CellModule,
    UdtModule,
    SporeModule,
    AssetModule,
    BlockModule,
  ],
})
export class AppModule {}
