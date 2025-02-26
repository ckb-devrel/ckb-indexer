import { Transaction } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, In, Repository } from "typeorm";

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

  async getCellByOutpoint(
    outpoint: ccc.OutPoint,
  ): Promise<ccc.Cell | undefined> {
    const dbTx = await this.findOneBy({ txHash: outpoint.txHash });
    if (!dbTx) {
      return undefined;
    }
    const tx = ccc.Transaction.fromBytes(dbTx.tx);
    return ccc.Cell.from({
      outPoint: outpoint,
      cellOutput: tx.outputs[Number(outpoint.index)],
      outputData: tx.outputsData[Number(outpoint.index)],
    });
  }

  async getCellsByOutpoints(
    outpoints: ccc.OutPoint[],
  ): Promise<Map<ccc.OutPoint, ccc.Cell | undefined>> {
    const dbTxs = await this.findBy({
      txHash: In(outpoints.map((outpoint) => outpoint.txHash)),
    });
    const txs = dbTxs.map((dbTx) => ccc.Transaction.fromBytes(dbTx.tx));
    const result = new Map<ccc.OutPoint, ccc.Cell | undefined>();
    for (const outpoint of outpoints) {
      const tx = txs.find((tx) => tx.hash() === outpoint.txHash);
      if (!tx) {
        result.set(outpoint, undefined);
        continue;
      }
      result.set(
        outpoint,
        ccc.Cell.from({
          outPoint: outpoint,
          cellOutput: tx.outputs[Number(outpoint.index)],
          outputData: tx.outputsData[Number(outpoint.index)],
        }),
      );
    }
    return result;
  }
}
