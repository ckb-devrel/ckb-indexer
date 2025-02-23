import { Transaction } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class TransactionRepo extends Repository<Transaction> {
  constructor(manager: EntityManager) {
    super(Transaction, manager);
  }

  async getTransactionByTxHash(
    txHash: ccc.Hex,
  ): Promise<Transaction | undefined> {
    return (await this.findOneBy({ txHash })) ?? undefined;
  }
}
