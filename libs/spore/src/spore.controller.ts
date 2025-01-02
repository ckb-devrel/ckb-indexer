import { ClusterInfo, NFTInfo } from "@app/commons";
import { Controller, Get } from "@nestjs/common";
import { SporeService } from "./spore.service";

@Controller()
export class SporeController {
  constructor(private readonly service: SporeService) {}

  @Get("getSporeClusterById")
  async getSporeClusterById(
    clusterId: string,
    withDesc: boolean,
  ): Promise<ClusterInfo> {
    throw new Error("Method not implemented.");
  }

  @Get("getSporeById")
  async getSporeById(
    sporeId: string,
    withClusterDesc: boolean,
  ): Promise<NFTInfo> {
    throw new Error("Method not implemented.");
  }
}
