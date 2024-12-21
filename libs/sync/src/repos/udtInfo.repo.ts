import { UdtInfo } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class UdtInfoRepo extends Repository<UdtInfo> {
  constructor(manager: EntityManager) {
    super(UdtInfo, manager);
  }
}
