import {
  formatSortable,
  formatSortableInt,
  parseSortableInt,
  withTransaction,
} from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Axios } from "axios";
import { EntityManager } from "typeorm";
import { UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { SyncAgent } from "./sync.agent";

@Injectable()
export class UdtParserBuilder {
  public readonly logger = new Logger(UdtParserBuilder.name);
  public readonly requester: Axios;
  public readonly client: ccc.Client;

  public readonly rgbppBtcCodeHash: ccc.Hex;
  public readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    configService: ConfigService,
    public readonly entityManager: EntityManager,
    public readonly syncAgent: SyncAgent,
  ) {
    this.client = syncAgent.rpc();

    const btcCodeHash = configService.get<string>("sync.rgbppBtcCodeHash");
    if (!btcCodeHash) {
      throw Error("Missing sync.rgbppBtcCodeHash");
    }
    this.rgbppBtcCodeHash = ccc.hexFrom(btcCodeHash);

    const btcHashType = configService.get<string>("sync.rgbppBtcHashType");
    if (!btcHashType) {
      throw Error("Missing sync.rgbppBtcHashType");
    }
    this.rgbppBtcHashType = ccc.hashTypeFrom(btcHashType);
  }

  build(blockHeight: ccc.NumLike): UdtParser {
    return new UdtParser(this, ccc.numFrom(blockHeight));
  }
}

class UdtParser {
  constructor(
    public readonly context: UdtParserBuilder,
    public readonly blockHeight: ccc.Num,
  ) {}

  async udtInfoHandleTx(
    entityManager: EntityManager,
    txLike: ccc.TransactionLike,
  ) {
    const tx = ccc.Transaction.from(txLike);
    const txHash = tx.hash();

    const udtTypes = await this.getUdtTypesInTx(tx);

    await withTransaction(
      this.context.entityManager,
      entityManager,
      async (entityManager) => {
        const udtInfoRepo = new UdtInfoRepo(entityManager);
        const udtBalanceRepo = new UdtBalanceRepo(entityManager);

        for (const udtType of udtTypes) {
          const tokenHash = udtType.hash();

          const { diffs, netBalance, netCapacity } =
            await this.getBalanceDiffInTx(tx, udtType);

          /* === Update UDT Info === */
          const existedUdtInfo = await udtInfoRepo.findOne({
            where: {
              hash: tokenHash,
            },
            order: {
              updatedAtHeight: "DESC",
            },
          });

          const udtInfo = udtInfoRepo.create({
            ...(existedUdtInfo ?? {
              hash: tokenHash,

              updatedAtHeight: formatSortable(this.blockHeight),

              typeCodeHash: udtType.codeHash,
              typeHashType: udtType.hashType,
              typeArgs: udtType.args,

              firstIssuanceTxHash: txHash,
              totalSupply: formatSortable("0"),
              capacity: formatSortable("0"),
            }),
            id:
              existedUdtInfo &&
              parseSortableInt(existedUdtInfo.updatedAtHeight) ===
                this.blockHeight
                ? existedUdtInfo.id
                : undefined,
          });

          udtInfo.totalSupply = formatSortableInt(
            parseSortableInt(udtInfo.totalSupply) + netBalance,
          );
          udtInfo.capacity = formatSortableInt(
            parseSortableInt(udtInfo.capacity) + netCapacity,
          );

          if (
            udtInfo.name == null &&
            udtInfo.symbol == null &&
            udtInfo.decimals == null &&
            udtInfo.icon == null
          ) {
            /* === TODO: Get UDT info from SSRI === */
            /* === TODO: Get UDT info from SSRI === */

            if (netBalance > ccc.Zero) {
              const { name, symbol, decimals } =
                await this.getTokenInfoInTx(tx);
              udtInfo.name = name;
              udtInfo.symbol = symbol;
              udtInfo.decimals = decimals;
            }
          }

          udtInfo.updatedAtHeight = formatSortableInt(this.blockHeight);
          await udtInfoRepo.save(udtInfo);

          if (!existedUdtInfo) {
            this.context.logger.log(
              `New token ${tokenHash} ${udtInfo.name}(${udtInfo.symbol}) found at tx ${txHash}`,
            );
          }
          /* === Update UDT Info === */

          /* === Update UDT Balance === */
          await Promise.all(
            diffs.map(async (diff) => {
              const { address } = await this.context.syncAgent.scriptToAddress(
                diff.lock,
              );
              const addressHash = ccc.hashCkb(ccc.bytesFrom(address, "utf8"));

              const existedUdtBalance = await udtBalanceRepo.findOne({
                where: {
                  addressHash,
                  tokenHash,
                },
                order: {
                  updatedAtHeight: "DESC",
                },
              });
              const udtBalance = udtBalanceRepo.create({
                ...(existedUdtBalance ?? {
                  addressHash,
                  tokenHash,

                  updatedAtHeight: formatSortable(this.blockHeight),

                  address,
                  balance: formatSortable("0"),
                  capacity: formatSortable("0"),
                }),
                id:
                  existedUdtBalance &&
                  parseSortableInt(existedUdtBalance.updatedAtHeight) ===
                    this.blockHeight
                    ? existedUdtBalance.id
                    : undefined,
              });

              udtBalance.balance = formatSortableInt(
                parseSortableInt(udtBalance.balance) + diff.balance,
              );
              udtBalance.capacity = formatSortableInt(
                parseSortableInt(udtBalance.capacity) + diff.capacity,
              );

              udtBalance.updatedAtHeight = formatSortableInt(this.blockHeight);
              await udtBalanceRepo.save(udtBalance);
            }),
          );
          /* === Update UDT Balance === */
        }
      },
    );
  }

  async getUdtTypesInTx(txLike: ccc.TransactionLike): Promise<ccc.Script[]> {
    const tx = ccc.Transaction.from(txLike);

    const scripts: Map<string, ccc.Script> = new Map();
    await Promise.all(
      tx.inputs.map(async (input) => {
        await input.completeExtraInfos(this.context.client);
        if (!input.cellOutput?.type) {
          return;
        }
        scripts.set(input.cellOutput.type.hash(), input.cellOutput.type);
      }),
    );
    for (const output of tx.outputs) {
      if (!output.type) {
        continue;
      }
      scripts.set(output.type.hash(), output.type);
    }

    return ccc.reduceAsync(
      Array.from(scripts.values()),
      async (acc: ccc.Script[], script) => {
        if (!(await this.isTypeUdt(script))) {
          return;
        }
        acc.push(script);
      },
      [],
    );
  }

  async isTypeUdt(scriptLike: ccc.ScriptLike): Promise<boolean> {
    const script = ccc.Script.from(scriptLike);

    const xUDTScript = await this.context.client.getKnownScript(
      ccc.KnownScript.XUdt,
    );
    if (
      script.codeHash === xUDTScript.codeHash &&
      script.hashType === xUDTScript.hashType
    ) {
      return true;
    }

    /* === TODO: Check if the tx contains SSRI UDT === */
    /* === TODO: Check if the tx contains SSRI UDT === */

    return false;
  }

  async getBalanceDiffInTx(
    txLike: ccc.TransactionLike,
    udtTypeLike: ccc.ScriptLike,
  ): Promise<{
    diffs: { lock: ccc.Script; balance: ccc.Num; capacity: ccc.Num }[];
    netBalance: ccc.Num;
    netCapacity: ccc.Num;
  }> {
    const tx = ccc.Transaction.from(txLike);
    const udtType = ccc.Script.from(udtTypeLike);

    const diffs: Map<
      string,
      { lock: ccc.Script; balance: ccc.Num; capacity: ccc.Num }
    > = new Map();
    let netBalance = ccc.Zero;
    let netCapacity = ccc.Zero;

    await Promise.all(
      tx.inputs.map(async (input) => {
        await input.completeExtraInfos(this.context.client);
        if (!input.cellOutput?.type || !input.cellOutput.type.eq(udtType)) {
          return;
        }
        const lock = input.cellOutput.lock;
        const lockHash = lock.hash();
        const diff = diffs.get(lockHash) ?? {
          lock,
          balance: ccc.Zero,
          capacity: ccc.Zero,
        };

        const balance = ccc.udtBalanceFrom(input.outputData ?? "00".repeat(16));
        diff.balance -= balance;
        diff.capacity -= input.cellOutput.capacity;

        diffs.set(lockHash, diff);

        netBalance -= balance;
        netCapacity -= input.cellOutput.capacity;
      }),
    );
    for (const i in tx.outputs) {
      const output = tx.outputs[i];
      const outputData = tx.outputsData[i];

      if (!output.type || !output.type.eq(udtType)) {
        continue;
      }

      const lock = output.lock;
      const lockHash = lock.hash();
      const diff = diffs.get(lockHash) ?? {
        lock,
        balance: ccc.Zero,
        capacity: ccc.Zero,
      };

      const balance = ccc.udtBalanceFrom(outputData ?? "00".repeat(16));
      diff.balance += balance;
      diff.capacity += output.capacity;

      diffs.set(lockHash, diff);

      netBalance += balance;
      netCapacity += output.capacity;
    }

    return {
      diffs: Array.from(diffs.values()),
      netBalance,
      netCapacity,
    };
  }

  async getTokenInfoInTx(txLike: ccc.TransactionLike): Promise<{
    decimals: number | null;
    name: string | null;
    symbol: string | null;
  }> {
    const tx = ccc.Transaction.from(txLike);
    const uniqueType = await this.context.client.getKnownScript(
      ccc.KnownScript.UniqueType,
    );

    for (const i in tx.outputs) {
      const output = tx.outputs[i];
      const outputData = ccc.bytesFrom(tx.outputsData[i]);

      if (
        !output.type ||
        output.type.codeHash !== uniqueType.codeHash ||
        output.type.hashType !== uniqueType.hashType
      ) {
        continue;
      }

      // | decimals | name len |  ... name ...  | symbol len |  ... symbol ...  |
      // | 1 bytes  | 1 bytes  | name len bytes | 1 bytes    | symbol len bytes |
      if (outputData.length < 1) {
        break;
      }
      const decimals = Number(ccc.numFromBytes(outputData.slice(0, 1)));

      if (outputData.length < 2) {
        return { decimals, name: null, symbol: null };
      }
      const nameLen = Number(ccc.numFromBytes(outputData.slice(1, 2)));
      if (outputData.length < 2 + nameLen) {
        return { decimals, name: null, symbol: null };
      }
      const name = ccc.bytesTo(outputData.slice(2, 2 + nameLen), "utf8");

      if (outputData.length < 3 + nameLen) {
        return { decimals, name, symbol: null };
      }
      const symbolLen = Number(
        ccc.numFromBytes(outputData.slice(2 + nameLen, 3 + nameLen)),
      );
      if (outputData.length < 3 + nameLen + symbolLen) {
        return { decimals, name, symbol: null };
      }
      const symbol = ccc.bytesTo(
        outputData.slice(3 + nameLen, 3 + nameLen + symbolLen),
        "utf8",
      );

      return {
        decimals,
        name,
        symbol,
      };
    }

    return { name: null, symbol: null, decimals: null };
  }
}
