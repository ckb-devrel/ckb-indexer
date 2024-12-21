import { UdtInfoPending } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtInfoPendingRepo extends Repository<UdtInfoPending> {
  constructor(manager: EntityManager) {
    super(UdtInfoPending, manager);
  }
}
