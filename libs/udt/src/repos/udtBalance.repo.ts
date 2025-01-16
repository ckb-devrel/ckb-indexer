import { formatSortable } from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, MoreThan, Repository } from "typeorm";

@Injectable()
export class UdtBalanceRepo extends Repository<UdtBalance> {
  constructor(manager: EntityManager) {
    super(UdtBalance, manager);
  }

  async getTokenItemsByAddress(
    address: string,
    tokenHash?: ccc.HexLike,
  ): Promise<UdtBalance[]> {
    const addressHash = ccc.hashCkb(ccc.bytesFrom(address, "utf8"));
    if (tokenHash) {
      return await this.find({
        where: {
          addressHash,
          tokenHash: ccc.hexFrom(tokenHash),
          balance: MoreThan(formatSortable(0)),
        },
        order: { updatedAtHeight: "DESC" },
        take: 1,
      });
    } else {
      const rawSql = `
        SELECT ub.*
        FROM udt_balance AS ub
        WHERE ub.id IN (
          SELECT MAX(id)
          FROM udt_balance
          WHERE addressHash = ? AND balance > 0
          GROUP BY tokenHash
        );
      `;
      return await this.manager.query(rawSql, [addressHash]);
    }
  }

  async getTokenItemsByTokenId(
    tokenHash: ccc.HexLike,
    offset: number,
    limit: number,
  ): Promise<UdtBalance[]> {
    const rawSql = `
      SELECT ub.*
      FROM udt_balance AS ub
      WHERE ub.id IN (
        SELECT MAX(ub_inner.id)
        FROM udt_balance AS ub_inner
        WHERE ub_inner.tokenHash = ? AND ub_inner.balance > 0
        GROUP BY ub_inner.addressHash
      )
      LIMIT ? OFFSET ?;
    `;
    return await this.manager.query(rawSql, [
      ccc.hexFrom(tokenHash),
      limit,
      offset,
    ]);
  }

  async getItemCountByTokenHash(tokenHash: ccc.HexLike): Promise<number> {
    const rawSql = `
      SELECT COUNT(*) AS holderCount
      FROM (
        SELECT addressHash
        FROM udt_balance
        WHERE tokenHash = ? AND balance > 0
        GROUP BY addressHash, tokenHash
        HAVING MAX(updatedAtHeight)
      ) AS grouped_holders;
    `;
    const result = await this.manager.query(rawSql, [ccc.hexFrom(tokenHash)]);
    return parseInt(result[0].holderCount, 10) || 0;
  }
}
