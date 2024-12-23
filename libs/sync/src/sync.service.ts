import { autoRun, withTransaction } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { SyncStatusRepo } from "./repos";
import { UdtParserBuilder } from "./udtParser";

const SYNC_KEY = "SYNCED";
const PENDING_KEY = "PENDING";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly client: ccc.Client;
  private readonly blockLimitPerInterval: number | undefined;

  constructor(
    configService: ConfigService,
    private readonly udtParserBuilder: UdtParserBuilder,
    private readonly entityManager: EntityManager,
    private readonly syncStatusRepo: SyncStatusRepo,
  ) {
    this.client = new ccc.ClientPublicTestnet();

    this.blockLimitPerInterval = configService.get<number>(
      "sync.blockLimitPerInterval",
    );

    const syncInterval = configService.get<number>("sync.interval");
    if (syncInterval !== undefined) {
      autoRun(this.logger, syncInterval, () => this.sync());
    }
  }

  async sync() {
    const pendingHeight =
      await this.syncStatusRepo.assertSyncHeight(PENDING_KEY);
    const tip = await this.client.getTip();
    const endBlock =
      this.blockLimitPerInterval === undefined
        ? tip
        : ccc.numMin(
            pendingHeight + ccc.numFrom(this.blockLimitPerInterval),
            tip,
          );

    for (
      let i = pendingHeight + ccc.numFrom(1);
      i <= endBlock;
      i += ccc.numFrom(1)
    ) {
      const block = await this.client.getBlockByNumber(i);
      if (!block) {
        this.logger.error(`Failed to get block ${i}`);
        break;
      }

      const udtParser = this.udtParserBuilder.build(i);

      await withTransaction(
        this.entityManager,
        undefined,
        async (entityManager) => {
          for (const tx of block.transactions) {
            await udtParser.udtInfoHandleTx(entityManager, tx);
          }

          await this.syncStatusRepo.updateSyncHeight(PENDING_KEY, i);
          this.logger.log(
            `Tip ${tip}. Synced block ${i}, ${block.transactions.length} transactions processed`,
          );
        },
      );
    }
  }
}
