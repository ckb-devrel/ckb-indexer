import {
  assertConfig,
  formatSortable,
  formatSortableInt,
  parseBtcAddress,
  parseSortableInt,
  withTransaction,
} from "@app/commons";
import { ScriptCode } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AxiosInstance } from "axios";
import { EntityManager } from "typeorm";
import { ScriptCodeRepo, UdtBalanceRepo, UdtInfoRepo } from "./repos";

enum UdtType {
  SUdt = "sUdt",
  Ssri = "Ssri",
}

type UdtTypeInfo =
  | { type: UdtType.Ssri; scriptCode: ScriptCode }
  | { type: UdtType.SUdt };

type TokenInfo = {
  name?: string;
  symbol?: string;
  decimals?: number;
  icon?: string;
};

async function trySsriMethod<T>(
  fn: () => Promise<ccc.ssri.ExecutorResponse<T>>,
): Promise<ccc.ssri.ExecutorResponse<T | undefined>> {
  try {
    return await fn();
  } catch (err) {
    if (
      !(err instanceof ccc.ssri.ExecutorErrorExecutionFailed) &&
      !(err instanceof ccc.ssri.ExecutorErrorExecutionFailed)
    ) {
      throw err;
    }
    return ccc.ssri.ExecutorResponse.new(undefined);
  }
}

@Injectable()
export class UdtParser {
  public readonly logger = new Logger(UdtParser.name);
  public readonly client: ccc.Client;
  public readonly executor: ccc.ssri.Executor;

  public readonly udtTypes: ccc.Script[];

  public readonly rgbppBtcCodeHash: ccc.Hex;
  public readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    configService: ConfigService,
    public readonly entityManager: EntityManager,
    public readonly udtInfoRepo: UdtInfoRepo,
    public readonly scriptCodeRepo: ScriptCodeRepo,
    @Inject("BTC_REQUESTERS") private readonly btcRequesters: AxiosInstance[],
  ) {
    const isMainnet = configService.get<boolean>("sync.isMainnet");
    const ssriServerUri = assertConfig<string>(
      configService,
      "sync.ssriServerUri",
    );
    this.executor = new ccc.ssri.ExecutorJsonRpc(ssriServerUri);
    const ckbRpcTimeout = configService.get<number>("sync.ckbRpcTimeout");
    const maxConcurrent = configService.get<number>("sync.maxConcurrent");
    const ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.client = isMainnet
      ? new ccc.ClientPublicMainnet({
          url: ckbRpcUri,
          timeout: ckbRpcTimeout,
          maxConcurrent,
        })
      : new ccc.ClientPublicTestnet({
          url: ckbRpcUri,
          timeout: ckbRpcTimeout,
          maxConcurrent,
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
      udtType: { script: ccc.Script; typeInfo: UdtTypeInfo };
      info: TokenInfo;
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

        for (const {
          udtType,
          info,
          diffs,
          netBalance,
          netCapacity,
        } of udtDiffs) {
          const tokenHash = udtType.script.hash();

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

              typeCodeHash: udtType.script.codeHash,
              typeHashType: udtType.script.hashType,
              typeArgs: udtType.script.args,

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
            udtInfo.name = info.name ?? null;
            udtInfo.symbol = info.symbol ?? null;
            udtInfo.decimals = info.decimals ?? null;
            udtInfo.icon = info.icon ?? null;
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

  async getUdtTypesInTx(
    tx: ccc.Transaction,
  ): Promise<{ script: ccc.Script; typeInfo: UdtTypeInfo }[]> {
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
          const typeInfo = await this.isTypeUdt(script);
          if (!typeInfo) {
            return;
          }
          return { script, typeInfo };
        }),
      )
    ).filter((s) => s !== undefined);
  }

  async isTypeUdt(script: ccc.Script): Promise<UdtTypeInfo | undefined> {
    const scriptCode = await (() => {
      if (script.hashType === "type") {
        return this.scriptCodeRepo.findOne({
          where: { typeHash: script.codeHash },
          order: { updatedAtHeight: "DESC" },
        });
      }
      return this.scriptCodeRepo.findOne({
        where: { dataHash: script.codeHash },
        order: { updatedAtHeight: "DESC" },
      });
    })();

    if (scriptCode && scriptCode.isSsri && scriptCode.isSsriUdt) {
      return { type: UdtType.Ssri, scriptCode };
    }

    if (
      this.udtTypes.some(
        ({ codeHash, hashType }) =>
          script.codeHash === codeHash && script.hashType === hashType,
      )
    ) {
      return { type: UdtType.SUdt };
    }

    return undefined;
  }

  async getBalanceDiffInTx(
    tx: ccc.Transaction,
    udtType: { script: ccc.Script; typeInfo: UdtTypeInfo },
  ): Promise<{
    info: TokenInfo;
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
        if (
          !input.cellOutput?.type ||
          !input.cellOutput.type.eq(udtType.script)
        ) {
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

        if (!output.type || !output.type.eq(udtType.script)) {
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

    const info: TokenInfo = {};
    const existed = await this.udtInfoRepo.findOneBy({
      hash: udtType.script.hash(),
    });
    if (
      !existed ||
      (existed.name == null &&
        existed.symbol == null &&
        existed.decimals == null &&
        existed.icon == null)
    ) {
      if (udtType.typeInfo.type === UdtType.Ssri) {
        const udt = new ccc.udt.Udt(
          ccc.OutPoint.fromBytes(udtType.typeInfo.scriptCode.outPoint),
          udtType.script,
          { executor: this.executor },
        );

        const [
          { res: name },
          { res: symbol },
          { res: decimals },
          { res: icon },
        ] = await Promise.all([
          trySsriMethod(() => udt.name()),
          trySsriMethod(() => udt.symbol()),
          trySsriMethod(() => udt.decimals()),
          trySsriMethod(() => udt.icon()),
        ]);

        info.name = name;
        info.symbol = symbol;
        info.decimals = Number(decimals);
        info.icon = icon;
      } else if (
        udtType.typeInfo.type === UdtType.SUdt &&
        netBalance > ccc.Zero
      ) {
        const { name, symbol, decimals } = await this.getTokenInfoInTx(tx);
        info.name = name;
        info.symbol = symbol;
        info.decimals = decimals;
      }
    }

    return {
      info,
      diffs,
      netBalance,
      netCapacity,
    };
  }

  async getTokenInfoInTx(tx: ccc.Transaction): Promise<TokenInfo> {
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
        return { decimals };
      }
      const nameLen = Number(ccc.numFromBytes(outputData.slice(1, 2)));
      if (outputData.length < 2 + nameLen) {
        return { decimals };
      }
      const name = ccc.bytesTo(outputData.slice(2, 2 + nameLen), "utf8");

      if (outputData.length < 3 + nameLen) {
        return { decimals, name };
      }
      const symbolLen = Number(
        ccc.numFromBytes(outputData.slice(2 + nameLen, 3 + nameLen)),
      );
      if (outputData.length < 3 + nameLen + symbolLen) {
        return { decimals, name };
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

    return {};
  }

  async scriptToAddress(scriptLike: ccc.ScriptLike): Promise<string> {
    if (
      scriptLike.codeHash === this.rgbppBtcCodeHash &&
      scriptLike.hashType === this.rgbppBtcHashType
    ) {
      return parseBtcAddress({
        client: this.client,
        rgbppScript: scriptLike,
        requesters: this.btcRequesters,
        logger: this.logger,
      });
    }
    const script = ccc.Script.from(scriptLike);
    return ccc.Address.fromScript(script, this.client).toString();
  }
}
