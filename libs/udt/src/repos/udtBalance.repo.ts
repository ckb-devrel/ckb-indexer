import { formatSortable } from "@app/commons";
import { UdtBalance } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, In, Repository } from "typeorm";

@Injectable()
export class UdtBalanceRepo extends Repository<UdtBalance> {
  constructor(manager: EntityManager) {
    super(UdtBalance, manager);
  }

  async hasHeight(height: ccc.Num): Promise<boolean> {
    const count = await this.countBy({
      updatedAtHeight: formatSortable(height),
    });
    return count > 0;
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
            updatedAtHeight: formatSortable(height),
          },
        });
      } else {
        const rawSql = `
          WITH LatestRecords AS (
            SELECT addressHash, MAX(updatedAtHeight) as maxHeight
            FROM udt_balance
            WHERE addressHash IN (?) AND tokenHash = ?
            GROUP BY addressHash
          )
          SELECT ub.*
          FROM udt_balance ub
          INNER JOIN LatestRecords lr 
            ON ub.addressHash = lr.addressHash 
            AND ub.updatedAtHeight = lr.maxHeight
          WHERE ub.tokenHash = ?;
        `;
        return await this.manager.query(rawSql, [
          addressHashes,
          ccc.hexFrom(tokenHash),
          ccc.hexFrom(tokenHash),
        ]);
      }
    } else {
      if (height) {
        return await this.find({
          where: {
            addressHash: In(addressHashes),
            updatedAtHeight: formatSortable(height),
          },
        });
      } else {
        const rawSql = `
          WITH LatestRecords AS (
            SELECT 
              *,
              ROW_NUMBER() OVER (
                PARTITION BY addressHash, tokenHash
                ORDER BY updatedAtHeight DESC
              ) AS rn
            FROM udt_balance
            WHERE addressHash IN (?)
          )
          SELECT *
          FROM LatestRecords
          WHERE rn = 1;
        `;
        return await this.manager.query(rawSql, [addressHashes]);
      }
    }
  }

  async getNonZeroTokenItemsByTokenId(
    tokenHash: ccc.HexLike,
    offset: number,
    limit: number,
  ): Promise<UdtBalance[]> {
    const hexToken = ccc.hexFrom(tokenHash);
    const rawSql = `
      WITH LatestBalances AS (
        SELECT 
          addressHash,
          MAX(updatedAtHeight) AS max_height
        FROM udt_balance
        WHERE tokenHash = ? 
          AND balance > 0
        GROUP BY addressHash
        LIMIT ? OFFSET ?
      )
      SELECT ub.*
      FROM udt_balance ub
      INNER JOIN LatestBalances lb 
        ON ub.addressHash = lb.addressHash 
        AND ub.updatedAtHeight = lb.max_height
      WHERE ub.tokenHash = ?;
    `;
    return this.manager.query(rawSql, [hexToken, limit, offset, hexToken]);
  }

  async getItemCountByTokenHash(tokenHash: ccc.HexLike): Promise<number> {
    const rawSql = `
      WITH LatestBalances AS (
        SELECT addressHash
        FROM udt_balance
        WHERE tokenHash = ?
          AND balance > 0
        GROUP BY addressHash
        HAVING updatedAtHeight = MAX(updatedAtHeight)
      )
      SELECT COUNT(*) AS holderCount
      FROM LatestBalances;
    `;
    const result = await this.manager.query(rawSql, [ccc.hexFrom(tokenHash)]);
    return parseInt(result[0].holderCount, 10) || 0;
  }
}
