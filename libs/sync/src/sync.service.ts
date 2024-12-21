import { autoRun, formatSortable, parseSortable, withTransaction } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HDKey } from "@scure/bip32";
import { Axios } from "axios";
import { EntityManager } from "typeorm";
import { SyncStatusRepo, UdtInfoPendingRepo, UdtInfoRepo } from "./repos";

const SYNC_KEY = "SYNCED";
const PENDING_KEY = "PENDING";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly requester: Axios;
  private readonly client: ccc.Client;
  private readonly rootKey: HDKey;
  private readonly pathPrefix: string;
  private readonly feeRate: number;

  constructor(
    configService: ConfigService,
    private readonly entityManager: EntityManager,
    private readonly syncStatusRepo: SyncStatusRepo,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtInfoPendingRepo: UdtInfoPendingRepo,
  ) {
    this.client = new ccc.ClientPublicTestnet();

    autoRun(this.logger, 5000, () => this.sync());
  }

  async sync() {
    const pendingHeight =
      await this.syncStatusRepo.assertSyncHeight(PENDING_KEY);
    const tip = await this.client.getTip();

    for (
      let i = pendingHeight + ccc.numFrom(1);
      i <= tip;
      i += ccc.numFrom(1)
    ) {
      const block = await this.client.getBlockByNumber(i);
      if (!block) {
        this.logger.error(`Failed to get block ${i}`);
        break;
      }

      await withTransaction(this.entityManager, undefined, async () => {
        for (const tx of block.transactions) {
          await this.udtInfoHandleTx(tx);
        }
      });
    }
  }

  async udtInfoHandleTx(txLike: ccc.TransactionLike) {
    const tx = ccc.Transaction.from(txLike);

    const udtTypes = await this.getUdtTypesInTx(tx);

    for (const udtType of udtTypes) {
      const typeHash = udtType.hash();

      const udtInfo =
        (await this.udtInfoPendingRepo.findOneBy({
          hash: typeHash,
        })) ??
        this.udtInfoPendingRepo.create({
          typeCodeHash: udtType.codeHash,
          typeHashType: udtType.hashType,
          typeArgs: udtType.args,

          firstIssuanceTxHash: tx.hash(),
          totalSupply: formatSortable("0"),
          circulatingSupply: formatSortable("0"),
        });

      const inputAmount = await tx.getInputsUdtBalance(this.client, udtType);
      const outputAmount = tx.getOutputsUdtBalance(udtType);

      udtInfo.totalSupply = formatSortable(
        (
          ccc.numFrom(parseSortable(udtInfo.totalSupply)) -
          inputAmount +
          outputAmount
        ).toString(),
      );

      await this.udtInfoPendingRepo.save(udtInfo);
    }
  }

  async getUdtTypesInTx(txLike: ccc.TransactionLike): Promise<ccc.Script[]> {
    const tx = ccc.Transaction.from(txLike);

    const scripts: Map<string, ccc.Script> = new Map();
    for (const input of tx.inputs) {
      await input.completeExtraInfos(this.client);
      if (!input.cellOutput?.type) {
        continue;
      }
      scripts.set(input.cellOutput.type.hash(), input.cellOutput.type);
    }
    for (const output of tx.outputs) {
      if (!output.type) {
        continue;
      }
      scripts.set(output.type.hash(), output.type);
    }

    return ccc.reduceAsync(
      Array.from(scripts.values()),
      async (acc: ccc.Script[], script) => {
        if (!this.isTypeUdt(script)) {
          return;
        }
        acc.push(script);
      },
      [],
    );
  }

  async isTypeUdt(scriptLike: ccc.ScriptLike): Promise<boolean> {
    const script = ccc.Script.from(scriptLike);

    const xUDTScript = await this.client.getKnownScript(ccc.KnownScript.XUdt);
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
}
