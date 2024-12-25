import {
  autoRun,
  formatSortableInt,
  parseSortableInt,
  withTransaction,
} from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  And,
  EntityManager,
  LessThan,
  LessThanOrEqual,
  MoreThan,
} from "typeorm";
import { SyncStatusRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { UdtParserBuilder } from "./udtParser";

const SYNC_KEY = "SYNCED";
const PENDING_KEY = "PENDING";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly client: ccc.Client;
  private readonly blockLimitPerInterval: number | undefined;
  private readonly confirmations: number | undefined;

  constructor(
    configService: ConfigService,
    private readonly udtParserBuilder: UdtParserBuilder,
    private readonly entityManager: EntityManager,
    private readonly syncStatusRepo: SyncStatusRepo,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtBalanceRepo: UdtBalanceRepo,
  ) {
    this.client = new ccc.ClientPublicTestnet();

    this.blockLimitPerInterval = configService.get<number>(
      "sync.blockLimitPerInterval",
    );
    this.confirmations = configService.get<number>("sync.confirmations");

    const syncInterval = configService.get<number>("sync.interval");
    if (syncInterval !== undefined) {
      autoRun(this.logger, syncInterval, () => this.sync());
    }

    const clearInterval = configService.get<number>("sync.clearInterval");
    if (this.confirmations !== undefined && clearInterval !== undefined) {
      autoRun(this.logger, clearInterval, () => this.clear());
    }
  }

  async sync() {
    const pendingStatus =
      await this.syncStatusRepo.assertSyncHeight(PENDING_KEY);
    const pendingHeight = parseSortableInt(pendingStatus.value);
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
          const blockRepo = new BlockRepo(entityManager);
          await blockRepo.insert({
            hash: block.header.hash,
            parentHash: block.header.parentHash,
            height: formatSortableInt(block.header.number),
          });

          for (const tx of block.transactions) {
            await udtParser.udtInfoHandleTx(entityManager, tx);
          }

          await this.syncStatusRepo.updateSyncHeight(pendingStatus, i);
          this.logger.log(
            `Tip ${tip}. Synced block ${i}, ${block.transactions.length} transactions processed`,
          );
        },
      );
    }
  }

  async clear() {
    if (this.confirmations === undefined) {
      return;
    }

    const pendingHeight = parseSortableInt(
      (await this.syncStatusRepo.assertSyncHeight(PENDING_KEY)).value,
    );
    const confirmedHeight = pendingHeight - ccc.numFrom(this.confirmations);

    const syncedStatus = await this.syncStatusRepo.assertSyncHeight(SYNC_KEY);
    if (parseSortableInt(syncedStatus.value) >= confirmedHeight) {
      return;
    }
    await this.syncStatusRepo.updateSyncHeight(syncedStatus, confirmedHeight);
    this.logger.log(`Clearing up to height ${confirmedHeight}`);

    let deleteUdtInfoCount = 0;
    while (true) {
      const udtInfo = await this.udtInfoRepo.findOne({
        where: {
          updatedAtHeight: And(
            LessThanOrEqual(formatSortableInt(confirmedHeight)),
            MoreThan(formatSortableInt("-1")),
          ),
        },
        order: {
          updatedAtHeight: "DESC",
        },
      });
      if (!udtInfo) {
        // No more confirmed data
        break;
      }

      await withTransaction(
        this.entityManager,
        undefined,
        async (entityManager) => {
          const udtInfoRepo = new UdtInfoRepo(entityManager);

          // Delete all history data, and set the latest confirmed data as permanent data
          const deleted = await udtInfoRepo.delete({
            hash: udtInfo.hash,
            updatedAtHeight: LessThan(udtInfo.updatedAtHeight),
          });
          deleteUdtInfoCount += deleted.affected ?? 0;

          await udtInfoRepo.update(
            { id: udtInfo.id },
            { updatedAtHeight: formatSortableInt("-1") },
          );
        },
      );
    }

    let deleteUdtBalanceCount = 0;
    while (true) {
      const udtBalance = await this.udtBalanceRepo.findOne({
        where: {
          updatedAtHeight: And(
            LessThanOrEqual(formatSortableInt(confirmedHeight)),
            MoreThan(formatSortableInt("-1")),
          ),
        },
        order: {
          updatedAtHeight: "DESC",
        },
      });
      if (!udtBalance) {
        // No more confirmed data
        break;
      }

      await withTransaction(
        this.entityManager,
        undefined,
        async (entityManager) => {
          const udtBalanceRepo = new UdtBalanceRepo(entityManager);

          // Delete all history data, and set the latest confirmed data as permanent data
          const deleted = await udtBalanceRepo.delete({
            addressHash: udtBalance.addressHash,
            tokenHash: udtBalance.tokenHash,
            updatedAtHeight: LessThan(udtBalance.updatedAtHeight),
          });
          deleteUdtBalanceCount += deleted.affected ?? 0;

          await udtBalanceRepo.update(
            { id: udtBalance.id },
            { updatedAtHeight: formatSortableInt("-1") },
          );
        },
      );
    }

    this.logger.log(
      `Cleared ${deleteUdtInfoCount} confirmed UDT info, ${deleteUdtBalanceCount} confirmed UDT balance`,
    );
  }
}
