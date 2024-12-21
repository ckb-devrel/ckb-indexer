import { loadConfig } from "@app/commons/config";
import { SchemasModule } from "@app/schemas";
import { SyncModule } from "@app/sync";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
    SchemasModule,
    SyncModule,
  ],
})
export class AppModule {}
