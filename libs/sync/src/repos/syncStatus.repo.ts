import { formatSortableInt, parseSortableInt } from "@app/commons";
import { SyncStatus } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class SyncStatusRepo extends Repository<SyncStatus> {
  constructor(manager: EntityManager) {
    super(SyncStatus, manager);
  }

  async assertSyncHeight(key: string): Promise<ccc.Num> {
    const found = await this.findOneBy({ key });
    if (!found) {
      throw Error(`Sync status not found: ${key}`);
    }

    return parseSortableInt(found.value);
  }

  async updateSyncHeight(key: string, height: ccc.NumLike): Promise<void> {
    await this.update({ key }, { value: formatSortableInt(height) });
  }
}
