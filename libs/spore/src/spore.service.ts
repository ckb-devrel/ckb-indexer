import { assertConfig, parseBtcAddress } from "@app/commons";
import { Cluster, Spore } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { ClusterRepo, SporeRepo } from "./repos";

@Injectable()
export class SporeService {
  private readonly logger = new Logger(SporeService.name);
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    private readonly configService: ConfigService,
    private readonly clusterRepo: ClusterRepo,
    private readonly sporeRepo: SporeRepo,
    @Inject("BTC_REQUESTERS") private readonly btcRequesters: AxiosInstance[],
  ) {
    const isMainnet = configService.get<boolean>("sync.isMainnet");
    const ckbRpcUri = configService.get<string>("sync.ckbRpcUri");
    this.client = isMainnet
      ? new ccc.ClientPublicMainnet({ url: ckbRpcUri })
      : new ccc.ClientPublicTestnet({ url: ckbRpcUri });

    this.rgbppBtcCodeHash = ccc.hexFrom(
      assertConfig(configService, "sync.rgbppBtcCodeHash"),
    );
    this.rgbppBtcHashType = ccc.hashTypeFrom(
      assertConfig(configService, "sync.rgbppBtcHashType"),
    );
  }

  async scriptToAddress(scriptLike: ccc.ScriptLike): Promise<string> {
    if (
      scriptLike.codeHash === this.rgbppBtcCodeHash &&
      scriptLike.hashType === this.rgbppBtcHashType
    ) {
      return parseBtcAddress({
        client: this.client,
        rgbppScript: scriptLike,
        requesters: this.btcRequesters,
      });
    }
    const script = ccc.Script.from(scriptLike);
    return ccc.Address.fromScript(script, this.client).toString();
  }

  async getItemsCountOfCluster(clusterId: ccc.HexLike): Promise<number> {
    return await this.sporeRepo.getSporeCountByClusterId(clusterId);
  }

  async getHoldersCountOfCluster(clusterId: ccc.HexLike): Promise<number> {
    return await this.sporeRepo.getHolderCountByClusterId(clusterId);
  }

  async getCluster(clusterId: ccc.HexLike): Promise<Cluster | null> {
    return await this.clusterRepo.getClusterById(clusterId);
  }

  async getBlockInfoFromTx(txHash: string): Promise<{
    height: ccc.Num;
    timestamp: number;
  } | null> {
    const tx = await this.client.getTransaction(txHash);
    if (tx === undefined || tx.blockNumber === undefined) {
      return null;
    }
    const header = await this.client.getHeaderByNumber(tx.blockNumber);
    if (header === undefined) {
      return null;
    }
    return {
      height: header.number,
      timestamp: Number(header.timestamp / 1000n),
    };
  }

  async getSpore(sporeId: ccc.HexLike): Promise<Spore | null> {
    return await this.sporeRepo.getSpore(sporeId);
  }
}
