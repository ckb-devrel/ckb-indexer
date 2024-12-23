import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  SyncStatus,
  UdtBalance,
  UdtInfo,
} from "./schemas";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "mysql",
        host: configService.get("mysql.host"),
        port: Number(configService.get("mysql.port")),
        username: configService.get("mysql.username"),
        password: configService.get("mysql.password"),
        database: configService.get("mysql.database"),
        synchronize: true,
        entities: [
          SyncStatus,
          UdtInfo,
          UdtBalance,
        ],
      }),
    }),
  ],
})
export class SchemasModule {}
