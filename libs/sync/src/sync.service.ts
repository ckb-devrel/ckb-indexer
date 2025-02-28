import {
  assertConfig,
  autoRun,
  formatSortableInt,
  headerToRepoBlock,
  parseSortableInt,
  withTransaction,
} from "@app/commons";
import { Block, Transaction } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  And,
  EntityManager,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
} from "typeorm";
import {
  ScriptCodeRepo,
  SyncStatusRepo,
  TransactionRepo,
  UdtBalanceRepo,
  UdtInfoRepo,
} from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { ClusterRepo } from "./repos/cluster.repo";
import { SporeRepo } from "./repos/spore.repo";
import { SporeParserBuilder } from "./sporeParser";

import { Worker } from "worker_threads";
import { UdtParser } from "./udtParser";

const SYNC_KEY = "SYNCED";
const PENDING_KEY = "PENDING";
const PENDING_HASH_KEY = "PENDING_HASH";

function getBlocksOnWorker(
  worker: Worker,
  start: ccc.NumLike,
  end: ccc.NumLike,
): Promise<
  {
    height: ccc.Num;
    block: ccc.ClientBlock;
    scriptCodes: {
      outPoint: ccc.OutPointLike;
      size: number;
      dataHash: ccc.Hex;
      typeHash?: ccc.Hex;
      isSsri: boolean;
      isSsriUdt: boolean;
    }[];
  }[]
> {
  return new Promise((resolve, reject) => {
    worker.removeAllListeners("message");
    worker.removeAllListeners("error");

    worker.postMessage({
      start,
      end,
    });

    worker.addListener("message", resolve);
    worker.addListener("error", reject);
  });
}

async function* getBlocks(props: {
  start: ccc.NumLike;
  end: ccc.NumLike;
  ssriServerUri: string;
  workers?: number;
  chunkSize?: number;
  isMainnet?: boolean;
  rpcUri?: string;
  rpcTimeout?: number;
  maxConcurrent?: number;
}) {
  const start = ccc.numFrom(props.start);
  const end = ccc.numFrom(props.end);
  const workers = props.workers ?? 8;
  const chunkSize = ccc.numFrom(props.chunkSize ?? 5);

  const queries: ReturnType<typeof getBlocksOnWorker>[] = [];
  const freeWorkers = Array.from(
    new Array(workers),
    () =>
      new Worker("./dist/workers/getBlock.js", {
        workerData: {
          isMainnet: props.isMainnet,
          rpcUri: props.rpcUri,
          ssriServerUri: props.ssriServerUri,
          rpcTimeout: props.rpcTimeout,
          maxConcurrent: props.maxConcurrent,
        },
      }),
  );

  try {
    let offset = start;
    while (true) {
      const workerEnd = ccc.numMin(offset + chunkSize, end);
      if (freeWorkers.length === 0 || offset === workerEnd) {
        const query = queries.shift();
        if (!query) {
          break;
        }
        for (const block of await query) {
          yield block;
        }
        continue;
      }

      const worker = freeWorkers.shift()!;
      queries.push(
        getBlocksOnWorker(worker, offset, workerEnd)
          .then((res) => {
            freeWorkers.push(worker);
            return res;
          })
          .catch((error) => {
            freeWorkers.push(worker);
            throw error;
          }),
      );
      offset = workerEnd;
    }
  } finally {
    freeWorkers.forEach((worker) => worker.terminate());
  }
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  private readonly isMainnet: boolean | undefined;
  private readonly ssriServerUri: string;
  private readonly ckbRpcUri: string | undefined;
  private readonly ckbRpcTimeout: number | undefined;
  private readonly maxConcurrent: number | undefined;
  private readonly client: ccc.Client;

  private readonly threads: number | undefined;
  private readonly blockChunk: number | undefined;
  private readonly blockLimitPerInterval: number | undefined;
  private readonly blockSyncStart: number | undefined;
  private readonly confirmations: number | undefined;
  private readonly txCacheConfirmations: number | undefined;

  private startTip?: ccc.Num;
  private startTipTime?: number;
  private syncedBlocks: number = 0;
  private syncedBlockTime: number = 0;

  constructor(
    configService: ConfigService,
    private readonly sporeParserBuilder: SporeParserBuilder,
    private readonly udtParser: UdtParser,
    private readonly entityManager: EntityManager,
    private readonly syncStatusRepo: SyncStatusRepo,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtBalanceRepo: UdtBalanceRepo,
    private readonly sporeRepo: SporeRepo,
    private readonly clusterRepo: ClusterRepo,
    private readonly blockRepo: BlockRepo,
    private readonly scriptCodeRepo: ScriptCodeRepo,
    private readonly transactionRepo: TransactionRepo,
  ) {
    this.isMainnet = configService.get<boolean>("sync.isMainnet");
    this.ssriServerUri = assertConfig<string>(
      configService,
      "sync.ssriServerUri",
    );
    this.ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.ckbRpcTimeout = configService.get<number>("sync.ckbRpcTimeout");
    this.maxConcurrent = configService.get<number>("sync.maxConcurrent");
    this.client = this.isMainnet
      ? new ccc.ClientPublicMainnet({
          url: this.ckbRpcUri,
          maxConcurrent: this.maxConcurrent,
        })
      : new ccc.ClientPublicTestnet({
          url: this.ckbRpcUri,
          maxConcurrent: this.maxConcurrent,
        });
    this.threads = configService.get<number>("sync.threads");
    this.blockChunk = configService.get<number>("sync.blockChunk");

    this.blockLimitPerInterval = configService.get<number>(
      "sync.blockLimitPerInterval",
    );
    this.blockSyncStart = configService.get<number>("sync.blockSyncStart");
    this.confirmations = configService.get<number>("sync.confirmations");
    this.txCacheConfirmations = configService.get<number>(
      "sync.txCacheConfirmations",
    );

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
    // Will break when endBlock === tip
    while (true) {
      const pendingStatus = await this.syncStatusRepo.syncHeight(
        PENDING_KEY,
        this.blockSyncStart,
      );
      const pendingHeight = parseSortableInt(pendingStatus.value);

      const tipTime = Date.now();
      const tip = await this.client.getTip();
      const tipCost =
        this.startTip !== undefined && this.startTipTime !== undefined
          ? (tipTime - this.startTipTime) / Number(tip - this.startTip)
          : undefined;
      if (this.startTip === undefined || this.startTipTime === undefined) {
        this.startTip = tip;
        this.startTipTime = tipTime;
      }

      const endBlock =
        this.blockLimitPerInterval === undefined
          ? tip
          : ccc.numMin(
              pendingHeight + ccc.numFrom(this.blockLimitPerInterval),
              tip,
            );

      let txsCount = 0;
      for await (const { height, block, scriptCodes } of getBlocks({
        start: pendingHeight,
        end: endBlock,
        ssriServerUri: this.ssriServerUri,
        workers: this.threads,
        chunkSize: this.blockChunk,
        rpcUri: this.ckbRpcUri,
        rpcTimeout: this.ckbRpcTimeout,
        isMainnet: this.isMainnet,
        maxConcurrent: this.maxConcurrent,
      })) {
        if (!block) {
          this.logger.error(`Failed to get block ${height}`);
          break;
        }

        const pendingHash = await this.syncStatusRepo.findOneBy({
          key: PENDING_HASH_KEY,
        });
        if (pendingHash && pendingHash.value !== block.header.parentHash) {
          this.logger.warn("Blockchain reorg detected, rolling back data");
          await withTransaction(
            this.entityManager,
            undefined,
            async (entityManager) => {
              /* === Rollback block status === */
              const blockRepo = new BlockRepo(entityManager);
              const syncStatusRepo = new SyncStatusRepo(entityManager);

              const block = await blockRepo.findOneBy({
                hash: pendingHash.value,
              });
              if (!block) {
                throw new Error(
                  `Failed to find block to rollback ${pendingHash.value}`,
                );
              }
              const rolledBackHeight = formatSortableInt(block.height);
              await blockRepo.delete({ hash: block.hash });

              const updateHash = await syncStatusRepo.update(
                {
                  key: pendingHash.key,
                  value: pendingHash.value,
                },
                {
                  value: block.parentHash,
                },
              );
              const updateNumber = await syncStatusRepo.update(
                {
                  key: pendingStatus.key,
                  value: pendingStatus.value,
                },
                {
                  value: formatSortableInt(
                    parseSortableInt(block.height) - ccc.numFrom(1),
                  ),
                },
              );
              if (
                (updateHash.affected ?? 0) === 0 ||
                (updateNumber.affected ?? 0) === 0
              ) {
                throw new Error(
                  `Failed to rollback pending block hash from ${pendingStatus.value}(${pendingHash.value}) to ${block.height}(${block.parentHash})`,
                );
              }
              /* === Rollback block status === */

              /* === Rollback records === */
              const clusterRepo = new ClusterRepo(entityManager);
              const sporeRepo = new SporeRepo(entityManager);
              const udtInfoRepo = new UdtInfoRepo(entityManager);
              const udtBalanceRepo = new UdtBalanceRepo(entityManager);

              await Promise.all([
                clusterRepo.delete({
                  updatedAtHeight: MoreThanOrEqual(rolledBackHeight),
                }),
                sporeRepo.delete({
                  updatedAtHeight: MoreThanOrEqual(rolledBackHeight),
                }),
                udtInfoRepo.delete({
                  updatedAtHeight: MoreThanOrEqual(rolledBackHeight),
                }),
                udtBalanceRepo.delete({
                  updatedAtHeight: MoreThanOrEqual(rolledBackHeight),
                }),
              ]);
              /* === Rollback records === */
            },
          );
          return;
        }

        /* === Save block transactions === */
        const MAX_TX_SIZE = 1024 * 1024 * 2; // 2MB
        const BATCH_SIZE = 50;

        // Use a single transaction for all batches to prevent deadlocks
        await withTransaction(
          this.entityManager,
          undefined,
          async (entityManager) => {
            const transactionRepo = entityManager.getRepository(Transaction);
            let totalTxSize = 0;

            // Process batches serially instead of in parallel to avoid lock contention
            for (let i = 0; i < block.transactions.length; i += BATCH_SIZE) {
              const batch = block.transactions.slice(i, i + BATCH_SIZE);
              const values = batch.map((tx) => {
                const cccTx = ccc.Transaction.from(tx);
                cccTx.witnesses = [];
                const molTx = Buffer.from(cccTx.toBytes());
                totalTxSize += molTx.length;
                return {
                  txHash: ccc.hexFrom(cccTx.hash()),
                  tx: molTx,
                  updatedAtHeight: formatSortableInt(height),
                };
              });

              try {
                await transactionRepo
                  .createQueryBuilder()
                  .insert()
                  .into(Transaction)
                  .values(values)
                  .orIgnore()
                  .updateEntity(false)
                  .execute();
              } catch (error) {
                this.logger.error(
                  `Failed to insert transactions batch ${i}-${i + batch.length} for block ${block.header.hash}`,
                  error,
                );
                throw error;
              }

              // If we've accumulated too much data, commit the transaction and start a new one
              if (
                totalTxSize > MAX_TX_SIZE &&
                i + BATCH_SIZE < block.transactions.length
              ) {
                await entityManager.queryRunner?.commitTransaction();
                await entityManager.queryRunner?.startTransaction();
                totalTxSize = 0;
              }
            }
          },
        );
        /* === Save block transactions === */

        txsCount += block.transactions.length;

        await Promise.all(
          scriptCodes.map(async (scriptCode) => {
            const outPoint = ccc.hexFrom(
              ccc.OutPoint.encode(scriptCode.outPoint),
            );
            const existed = await this.scriptCodeRepo.findOneBy({ outPoint });
            if (!existed) {
              await this.scriptCodeRepo.insert({
                outPoint,
                updatedAtHeight: formatSortableInt(height),
                dataHash: scriptCode.dataHash,
                typeHash: scriptCode.typeHash,
                size: scriptCode.size,
                isSsri: scriptCode.isSsri,
                isSsriUdt: scriptCode.isSsriUdt,
              });
            }
          }),
        );

        const sporeParser = this.sporeParserBuilder.build(height);

        const txDiffs = await Promise.all(
          block.transactions.map(async (txLike) => {
            const tx = ccc.Transaction.from(txLike);
            const diffs = await this.udtParser.udtInfoHandleTx(tx);
            const flows = await sporeParser.analyzeTxFlow(tx);
            return { tx, diffs, flows };
          }),
        );

        await withTransaction(
          this.entityManager,
          undefined,
          async (entityManager) => {
            const blockRepo = new BlockRepo(entityManager);
            const syncStatusRepo = new SyncStatusRepo(entityManager);
            await blockRepo.insert({
              hash: block.header.hash,
              parentHash: block.header.parentHash,
              height: formatSortableInt(block.header.number),
              timestamp: Number(block.header.timestamp / 1000n),
            });
            if (pendingHash) {
              const update = await syncStatusRepo.update(
                {
                  key: PENDING_HASH_KEY,
                  value: pendingHash.value,
                },
                { value: block.header.hash },
              );
              if (update.affected === 0) {
                throw new Error(
                  `Failed to update pending block hash from ${pendingHash.value} to ${block.header.hash}`,
                );
              }
            } else {
              await syncStatusRepo.save({
                key: PENDING_HASH_KEY,
                value: block.header.hash,
              });
            }

            for (const { tx, diffs, flows } of txDiffs) {
              await sporeParser.handleFlows(entityManager, tx, flows);
              await this.udtParser.saveDiffs(entityManager, tx, height, diffs);
            }

            await syncStatusRepo.updateSyncHeight(pendingStatus, height);
          },
        );

        this.syncedBlocks += 1;

        if (this.syncedBlocks % 1000 === 0 || height === endBlock) {
          const syncedBlockTime = this.syncedBlockTime + Date.now() - tipTime;
          const blocksDiff = Number(tip - endBlock);
          const syncCost = syncedBlockTime / this.syncedBlocks;
          const estimatedTime = tipCost
            ? (blocksDiff * syncCost * tipCost) / (tipCost - syncCost)
            : blocksDiff * syncCost;
          this.logger.log(
            `Tip ${tip} ${tipCost ? (tipCost / 1000).toFixed(1) : "-"} s/block, synced block ${height}, ${(
              (this.syncedBlocks * 1000) /
              syncedBlockTime
            ).toFixed(1)} blocks/s (~${
              estimatedTime !== undefined
                ? (estimatedTime / 1000 / 60).toFixed(1)
                : "-"
            } mins left). ${txsCount} transactions processed`,
          );
          txsCount = 0;
        }
      }
      this.syncedBlockTime += Date.now() - tipTime;

      if (endBlock === tip) {
        break;
      }
    }
  }

  async clear() {
    if (this.confirmations === undefined) {
      return;
    }
    if (!(await this.syncStatusRepo.hasKeys([SYNC_KEY, PENDING_KEY]))) {
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

    let deleteSporeCount = 0;
    while (true) {
      const spore = await this.sporeRepo.findOne({
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
      if (!spore) {
        // No more confirmed data
        break;
      }

      await withTransaction(
        this.entityManager,
        undefined,
        async (entityManager) => {
          const sporeRepo = new SporeRepo(entityManager);

          // Delete all history data, and set the latest confirmed data as permanent data
          const deleted = await sporeRepo.delete({
            sporeId: spore.sporeId,
            updatedAtHeight: LessThan(spore.updatedAtHeight),
          });
          deleteSporeCount += deleted.affected ?? 0;

          await sporeRepo.update(
            { id: spore.id },
            { updatedAtHeight: formatSortableInt("-1") },
          );
        },
      );
    }

    let deleteClusterCount = 0;
    while (true) {
      const cluster = await this.clusterRepo.findOne({
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
      if (!cluster) {
        // No more confirmed data
        break;
      }

      await withTransaction(
        this.entityManager,
        undefined,
        async (entityManager) => {
          const clusterRepo = new ClusterRepo(entityManager);

          // Delete all history data, and set the latest confirmed data as permanent data
          const deleted = await clusterRepo.delete({
            clusterId: cluster.clusterId,
            updatedAtHeight: LessThan(cluster.updatedAtHeight),
          });
          deleteClusterCount += deleted.affected ?? 0;

          await clusterRepo.update(
            { id: cluster.id },
            { updatedAtHeight: formatSortableInt("-1") },
          );
        },
      );
    }

    let deleteTransactionCount = 0;
    if (this.txCacheConfirmations !== undefined) {
      const txCacheConfirmedHeight =
        pendingHeight - ccc.numFrom(this.txCacheConfirmations);

      await withTransaction(
        this.entityManager,
        undefined,
        async (entityManager) => {
          const transactionRepo = new TransactionRepo(entityManager);

          // Delete all history data
          const deleted = await transactionRepo.delete({
            updatedAtHeight: LessThan(
              formatSortableInt(txCacheConfirmedHeight),
            ),
          });
          deleteTransactionCount += deleted.affected ?? 0;
        },
      );
    }

    this.logger.log(
      `Cleared ${deleteUdtInfoCount} confirmed UDT info, ${deleteUdtBalanceCount} confirmed UDT balance, ${deleteSporeCount} confirmed Spore, ${deleteClusterCount} confirmed Cluster, ${deleteTransactionCount} confirmed transaction`,
    );
  }

  async getBlockHeader(params: {
    blockNumber?: number;
    fromDb: boolean;
  }): Promise<Block | undefined> {
    const { blockNumber, fromDb } = params;
    if (blockNumber) {
      if (fromDb) {
        return await this.blockRepo.getBlockByNumber(ccc.numFrom(blockNumber));
      } else {
        const header = await this.client.getHeaderByNumber(blockNumber);
        return headerToRepoBlock(header);
      }
    } else {
      if (fromDb) {
        return await this.blockRepo.getTipBlock();
      } else {
        const header = await this.client.getTipHeader();
        return headerToRepoBlock(header);
      }
    }
  }
}
