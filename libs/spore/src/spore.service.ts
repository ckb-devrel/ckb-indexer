import { assertConfig, parseAddress } from "@app/commons";
import { Cluster, Spore } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import { ClusterRepo, SporeRepo } from "./repos";

@Injectable()
export class SporeService {
  private readonly logger = new Logger(SporeService.name);
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly btcRequester: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly clusterRepo: ClusterRepo,
    private readonly sporeRepo: SporeRepo,
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

    const btcRpcUri = assertConfig<string>(configService, "sync.btcRpcUri");
    this.btcRequester = axios.create({
      baseURL: btcRpcUri,
    });
  }

  async scriptToAddress(scriptLike: ccc.ScriptLike): Promise<string> {
    return parseAddress(scriptLike, this.client, {
      btcRequester: this.btcRequester,
      rgbppBtcCodeHash: this.rgbppBtcCodeHash,
      rgbppBtcHashType: this.rgbppBtcHashType,
    });
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
