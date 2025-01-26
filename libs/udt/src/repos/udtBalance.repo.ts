import { formatSortable } from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, In, MoreThan, Repository } from "typeorm";

@Injectable()
export class UdtBalanceRepo extends Repository<UdtBalance> {
  constructor(manager: EntityManager) {
    super(UdtBalance, manager);
  }

  async getTokenItemsByAddress(
    addresses: string[],
    tokenHash?: ccc.HexLike,
    height?: ccc.Num,
  ): Promise<UdtBalance[]> {
    const addressHashes = addresses.map((address) =>
      ccc.hashCkb(ccc.bytesFrom(address, "utf8")),
    );
    if (tokenHash) {
      if (height) {
        return await this.find({
          where: {
            addressHash: In(addressHashes),
            tokenHash: ccc.hexFrom(tokenHash),
            balance: MoreThan(formatSortable(0)),
            updatedAtHeight: formatSortable(height),
          },
        });
      } else {
        return await this.find({
          where: {
            addressHash: In(addressHashes),
            tokenHash: ccc.hexFrom(tokenHash),
            balance: MoreThan(formatSortable(0)),
          },
          order: { updatedAtHeight: "DESC" },
          take: 1,
        });
      }
    } else {
      if (height) {
        return await this.find({
          where: {
            addressHash: In(addressHashes),
            balance: MoreThan(formatSortable(0)),
            updatedAtHeight: formatSortable(height),
          },
        });
      } else {
        const rawSql = `
          SELECT ub.*
          FROM udt_balance AS ub
          WHERE ub.updatedAtHeight IN (
            SELECT MAX(updatedAtHeight)
            FROM udt_balance
            WHERE addressHash = IN (?) AND balance > 0
            GROUP BY tokenHash
          );
        `;
        return await this.manager.query(rawSql, [addressHashes]);
      }
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
      WHERE ub.updatedAtHeight IN (
        SELECT MAX(ub_inner.updatedAtHeight)
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
