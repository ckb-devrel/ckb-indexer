import { Cluster } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class ClusterRepo extends Repository<Cluster> {
  constructor(manager: EntityManager) {
    super(Cluster, manager);
  }
}
