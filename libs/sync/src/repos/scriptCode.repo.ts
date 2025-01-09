import { ScriptCode } from "@app/schemas";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class ScriptCodeRepo extends Repository<ScriptCode> {
  constructor(manager: EntityManager) {
    super(ScriptCode, manager);
  }
}
