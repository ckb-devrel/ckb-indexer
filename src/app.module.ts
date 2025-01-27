import { loadConfig } from "@app/commons/config";
import { SchemasModule } from "@app/schemas";
import { SyncModule } from "@app/sync";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import axios from "axios";
import { AssetModule } from "libs/asset/src";
import { BlockModule } from "libs/block/src";
import { CellModule } from "libs/cell/src";
import { SporeModule } from "libs/spore/src";
import { UdtModule } from "libs/udt/src";

const config = loadConfig();

if (!Array.isArray(config.sync.btcRpcs)) {
  throw new Error("Invalid sync.btcRpcs. It should be an array");
}

const btcRequestersProvider = {
  provide: "BTC_REQUESTERS",
  useValue: config.sync.btcRpcs.map(
    ({
      uri,
      username,
      password,
    }: {
      uri: string;
      username?: string;
      password?: string;
    }) =>
      axios.create({
        baseURL: uri,
        auth: username && password ? { username, password } : undefined,
      }),
  ),
};

@Global()
@Module({
  providers: [btcRequestersProvider],
  exports: [btcRequestersProvider],
})
export class ContextModule {}

@Module({
  imports: [
    ContextModule,
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
