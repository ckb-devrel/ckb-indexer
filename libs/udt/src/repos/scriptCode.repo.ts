import { ScriptCode } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { EntityManager, Repository } from "typeorm";

@Injectable()
export class ScriptCodeRepo extends Repository<ScriptCode> {
  constructor(manager: EntityManager) {
    super(ScriptCode, manager);
  }

  async generateCelldep(
    codeHash: ccc.HexLike,
    hashType: ccc.HashTypeLike,
  ): Promise<ccc.CellDep | undefined> {
    let scriptCode: ScriptCode | null;
    if (hashType === "type") {
      scriptCode = await this.findOne({
        where: { typeHash: ccc.hexFrom(codeHash) },
        order: { updatedAtHeight: "DESC" },
      });
    } else {
      scriptCode = await this.findOne({
        where: { dataHash: ccc.hexFrom(codeHash) },
        order: { updatedAtHeight: "DESC" },
      });
    }
    if (!scriptCode) {
      return undefined;
    }
    return ccc.CellDep.from({
      outPoint: ccc.OutPoint.decode(scriptCode.outPoint),
      depType: "code",
    });
  }
}
