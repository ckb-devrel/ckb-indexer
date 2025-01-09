import {
  assertConfig,
  formatSortable,
  formatSortableInt,
  parseAddress,
  parseSortableInt,
  withTransaction,
} from "@app/commons";
import { ccc } from "@ckb-ccc/shell";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { EntityManager } from "typeorm";
import { UdtBalanceRepo, UdtInfoRepo } from "./repos";

@Injectable()
export class UdtParser {
  public readonly logger = new Logger(UdtParser.name);
  public readonly btcRequester: AxiosInstance;
  public readonly client: ccc.Client;

  public readonly udtTypes: ccc.Script[];

  public readonly rgbppBtcCodeHash: ccc.Hex;
  public readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    configService: ConfigService,
    public readonly entityManager: EntityManager,
  ) {
    const isMainnet = configService.get<boolean>("sync.isMainnet");
    const ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.client = isMainnet
      ? new ccc.ClientPublicMainnet({ url: ckbRpcUri })
      : new ccc.ClientPublicTestnet({ url: ckbRpcUri });

    this.btcRequester = axios.create({
      baseURL: assertConfig(configService, "sync.btcRpcUri"),
    });
    this.rgbppBtcCodeHash = ccc.hexFrom(
      assertConfig(configService, "sync.rgbppBtcCodeHash"),
    );
    this.rgbppBtcHashType = ccc.hashTypeFrom(
      assertConfig(configService, "sync.rgbppBtcHashType"),
    );

    const udtTypes =
      configService.get<
        { codeHash: ccc.HexLike; hashType: ccc.HashTypeLike }[]
      >("sync.udtTypes") ?? [];
    this.udtTypes = udtTypes.map((t) => ccc.Script.from({ ...t, args: "" }));
  }

  async udtInfoHandleTx(tx: ccc.Transaction) {
    return Promise.all(
      (await this.getUdtTypesInTx(tx)).map(async (udtType) => ({
        ...(await this.getBalanceDiffInTx(tx, udtType)),
        udtType,
      })),
    );
  }

  async saveDiffs(
    entityManager: EntityManager,
    tx: ccc.Transaction,
    blockHeight: ccc.Num,
    udtDiffs: {
      udtType: ccc.Script;
      diffs: { address: string; balance: ccc.Num; capacity: ccc.Num }[];
      netBalance: ccc.Num;
      netCapacity: ccc.Num;
    }[],
  ) {
    const txHash = tx.hash();
    await withTransaction(
      this.entityManager,
      entityManager,
      async (entityManager) => {
        const udtInfoRepo = new UdtInfoRepo(entityManager);
        const udtBalanceRepo = new UdtBalanceRepo(entityManager);

        for (const { udtType, diffs, netBalance, netCapacity } of udtDiffs) {
          const tokenHash = udtType.hash();

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

              updatedAtHeight: formatSortable(blockHeight),

              typeCodeHash: udtType.codeHash,
              typeHashType: udtType.hashType,
              typeArgs: udtType.args,

              firstIssuanceTxHash: txHash,
              totalSupply: formatSortable("0"),
              capacity: formatSortable("0"),
            }),
            id:
              existedUdtInfo &&
              parseSortableInt(existedUdtInfo.updatedAtHeight) === blockHeight
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

          udtInfo.updatedAtHeight = formatSortableInt(blockHeight);
          await udtInfoRepo.save(udtInfo);

          if (!existedUdtInfo) {
            this.logger.log(
              `New token ${tokenHash} ${udtInfo.name}(${udtInfo.symbol}) found at tx ${txHash}`,
            );
          }
          /* === Update UDT Info === */

          /* === Update UDT Balance === */
          await Promise.all(
            diffs.map(async (diff) => {
              const addressHash = ccc.hashCkb(
                ccc.bytesFrom(diff.address, "utf8"),
              );

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

                  updatedAtHeight: formatSortable(blockHeight),

                  address: diff.address,
                  balance: formatSortable("0"),
                  capacity: formatSortable("0"),
                }),
                id:
                  existedUdtBalance &&
                  parseSortableInt(existedUdtBalance.updatedAtHeight) ===
                    blockHeight
                    ? existedUdtBalance.id
                    : undefined,
              });

              udtBalance.balance = formatSortableInt(
                parseSortableInt(udtBalance.balance) + diff.balance,
              );
              udtBalance.capacity = formatSortableInt(
                parseSortableInt(udtBalance.capacity) + diff.capacity,
              );

              udtBalance.updatedAtHeight = formatSortableInt(blockHeight);
              await udtBalanceRepo.save(udtBalance);
            }),
          );
          /* === Update UDT Balance === */
        }
      },
    );
  }

  async getUdtTypesInTx(tx: ccc.Transaction): Promise<ccc.Script[]> {
    const scripts: ccc.Bytes[] = [];
    await Promise.all(
      tx.inputs.map(async (input) => {
        if (!input.cellOutput?.type) {
          return;
        }
        const rawType = input.cellOutput.type.toBytes();

        if (!scripts.some((s) => ccc.bytesEq(s, rawType))) {
          scripts.push(rawType);
        }
      }),
    );
    for (const output of tx.outputs) {
      if (!output.type) {
        continue;
      }
      const rawType = output.type.toBytes();

      if (!scripts.some((s) => ccc.bytesEq(s, rawType))) {
        scripts.push(rawType);
      }
    }

    return (
      await Promise.all(
        scripts.map(async (raw) => {
          const script = ccc.Script.fromBytes(raw);
          if (!(await this.isTypeUdt(script))) {
            return;
          }
          return script;
        }),
      )
    ).filter((s) => s !== undefined);
  }

  async isTypeUdt(script: ccc.Script): Promise<boolean> {
    if (
      this.udtTypes.some(
        ({ codeHash, hashType }) =>
          script.codeHash === codeHash && script.hashType === hashType,
      )
    ) {
      return true;
    }

    /* === TODO: Check if the tx contains SSRI UDT === */
    /* === TODO: Check if the tx contains SSRI UDT === */

    return false;
  }

  async getBalanceDiffInTx(
    tx: ccc.Transaction,
    udtType: ccc.Script,
  ): Promise<{
    diffs: { address: string; balance: ccc.Num; capacity: ccc.Num }[];
    netBalance: ccc.Num;
    netCapacity: ccc.Num;
  }> {
    const diffs: { address: string; balance: ccc.Num; capacity: ccc.Num }[] =
      [];
    let netBalance = ccc.Zero;
    let netCapacity = ccc.Zero;

    await Promise.all(
      tx.inputs.map(async (input) => {
        if (!input.cellOutput?.type || !input.cellOutput.type.eq(udtType)) {
          return;
        }
        const address = await this.scriptToAddress(input.cellOutput.lock);

        const diff =
          diffs.find((d) => d.address === address) ??
          diffs[
            diffs.push({
              address,
              balance: ccc.Zero,
              capacity: ccc.Zero,
            }) - 1
          ];

        const balance = ccc.udtBalanceFrom(
          (input.outputData ?? "") + "00".repeat(16),
        );
        diff.balance -= balance;
        diff.capacity -= input.cellOutput.capacity;

        netBalance -= balance;
        netCapacity -= input.cellOutput.capacity;
      }),
    );

    await Promise.all(
      tx.outputs.map(async (output, i) => {
        const outputData = tx.outputsData[i];

        if (!output.type || !output.type.eq(udtType)) {
          return;
        }

        const address = await this.scriptToAddress(output.lock);
        const diff =
          diffs.find((d) => d.address === address) ??
          diffs[
            diffs.push({
              address,
              balance: ccc.Zero,
              capacity: ccc.Zero,
            }) - 1
          ];

        const balance = ccc.udtBalanceFrom(
          (outputData ?? "") + "00".repeat(16),
        );
        diff.balance += balance;
        diff.capacity += output.capacity;

        netBalance += balance;
        netCapacity += output.capacity;
      }),
    );

    return {
      diffs,
      netBalance,
      netCapacity,
    };
  }

  async getTokenInfoInTx(tx: ccc.Transaction): Promise<{
    decimals: number | null;
    name: string | null;
    symbol: string | null;
  }> {
    const uniqueType = await this.client.getKnownScript(
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

  async scriptToAddress(scriptLike: ccc.ScriptLike): Promise<string> {
    return parseAddress(
      scriptLike,
      this.client,
      {
        btcRequester: this.btcRequester,
        rgbppBtcCodeHash: this.rgbppBtcCodeHash,
        rgbppBtcHashType: this.rgbppBtcHashType,
      },
      this.logger,
    );
  }
}
