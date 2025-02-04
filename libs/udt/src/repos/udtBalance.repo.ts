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
    if (addresses.length === 0) {
      return [];
    }
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
        // const rawSql = `
        //   SELECT ub.*
        //   FROM udt_balance AS ub
        //   WHERE ub.updatedAtHeight IN (
        //     SELECT MAX(updatedAtHeight)
        //     FROM udt_balance
        //     WHERE addressHash IN (?) AND balance > 0
        //     GROUP BY tokenHash
        //   );
        // `;
        const rawSql = `
          WITH LatestRecords AS (
            SELECT 
              *,
              ROW_NUMBER() OVER (
                PARTITION BY tokenHash 
                ORDER BY updatedAtHeight DESC
              ) AS rn
            FROM udt_balance
            WHERE 
              addressHash IN (?) 
              AND balance > 0
          )
          SELECT *
          FROM LatestRecords
          WHERE rn = 1;
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
    // const rawSql = `
    //   SELECT ub.*
    //   FROM udt_balance AS ub
    //   WHERE ub.updatedAtHeight IN (
    //     SELECT MAX(ub_inner.updatedAtHeight)
    //     FROM udt_balance AS ub_inner
    //     WHERE ub_inner.tokenHash = ? AND ub_inner.balance > 0
    //     GROUP BY ub_inner.addressHash
    //   )
    //   LIMIT ? OFFSET ?;
    // `;
    // return await this.manager.query(rawSql, [
    //   ccc.hexFrom(tokenHash),
    //   limit,
    //   offset,
    // ]);
    const hexToken = ccc.hexFrom(tokenHash);
    const rawSql = `
      WITH LatestAddresses AS (
        SELECT 
          addressHash,
          MAX(updatedAtHeight) AS max_height
        FROM udt_balance
        WHERE tokenHash = ? AND balance > 0
        GROUP BY addressHash
        ORDER BY max_height DESC
        LIMIT ? OFFSET ?
      )
      SELECT ub.*
      FROM udt_balance ub
      JOIN LatestAddresses la 
        ON ub.addressHash = la.addressHash 
      AND ub.updatedAtHeight = la.max_height
      WHERE ub.tokenHash = ?;
    `;
    return this.manager.query(rawSql, [hexToken, limit, offset, hexToken]);
  }

  async getItemCountByTokenHash(tokenHash: ccc.HexLike): Promise<number> {
    // const rawSql = `
    //   SELECT COUNT(*) AS holderCount
    //   FROM (
    //     SELECT addressHash
    //     FROM udt_balance
    //     WHERE tokenHash = ? AND balance > 0
    //     GROUP BY addressHash, tokenHash
    //     HAVING MAX(updatedAtHeight)
    //   ) AS grouped_holders;
    // `;
    const rawSql = `
      WITH LatestBalances AS (
        SELECT 
          addressHash,
          ROW_NUMBER() OVER (
            PARTITION BY addressHash 
            ORDER BY updatedAtHeight DESC
          ) AS rn,
          balance
        FROM udt_balance
        WHERE tokenHash = ?
      )
      SELECT COUNT(DISTINCT addressHash) AS holderCount
      FROM LatestBalances
      WHERE rn = 1 AND balance > 0;
    `;
    const result = await this.manager.query(rawSql, [ccc.hexFrom(tokenHash)]);
    return parseInt(result[0].holderCount, 10) || 0;
  }
}
