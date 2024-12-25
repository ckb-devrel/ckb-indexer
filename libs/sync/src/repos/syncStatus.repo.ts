import { formatSortableInt } from "@app/commons";
import { SyncStatus } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class SyncStatusRepo extends Repository<SyncStatus> {
  constructor(manager: EntityManager) {
    super(SyncStatus, manager);
  }

  async assertSyncHeight(key: string): Promise<SyncStatus> {
    const found = await this.findOneBy({ key });
    if (!found) {
      throw Error(`Sync status not found: ${key}`);
    }

    return found;
  }

  async updateSyncHeight(
    status: SyncStatus,
    height: ccc.NumLike,
  ): Promise<void> {
    const value = formatSortableInt(height);
    if (status.value === value) {
      return;
    }

    const updated = await this.update(
      { key: status.key, value: status.value },
      { value: formatSortableInt(height) },
    );
    if (!updated.affected) {
      throw Error(
        `Failed to update sync height from ${status.value} to ${value}`,
      );
    }
    status.value = value;
  }
}
