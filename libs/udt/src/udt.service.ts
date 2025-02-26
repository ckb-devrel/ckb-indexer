import {
  assert,
  assertConfig,
  headerToRepoBlock,
  parseScriptMode,
  parseSortableInt,
  RpcError,
  ScriptMode,
} from "@app/commons";
import { Block, UdtBalance, UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";
import { ScriptCodeRepo } from "./repos/scriptCode.repo";

@Injectable()
export class UdtService {
  public readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;
  private readonly udtTypes: Record<ccc.Hex, ccc.CellDepLike>;

  constructor(
    private readonly configService: ConfigService,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtBalanceRepo: UdtBalanceRepo,
    private readonly blockRepo: BlockRepo,
    private readonly scriptCodeRepo: ScriptCodeRepo,
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

    const udtTypes =
      configService.get<
        {
          codeHash: ccc.HexLike;
          hashType: ccc.HashTypeLike;
          cellDep: ccc.CellDepLike;
        }[]
      >("sync.udtTypes") ?? [];
    this.udtTypes = udtTypes.reduce(
      (acc, t) => {
        acc[ccc.hexFrom(t.codeHash)] = t.cellDep;
        return acc;
      },
      {} as Record<ccc.Hex, ccc.CellDepLike>,
    );
  }

  async getUdtCelldep(
    codeHash: ccc.HexLike,
    hashType: ccc.HashTypeLike,
  ): Promise<ccc.CellDep | undefined> {
    const celldep = this.udtTypes[ccc.hexFrom(codeHash)];
    if (!celldep) {
      return await this.scriptCodeRepo.generateCelldep(codeHash, hashType);
    }
    return ccc.CellDep.from(celldep);
  }

  async getTipBlockNumber(): Promise<ccc.Num> {
    const tipBlock = await this.blockRepo.getTipBlock();
    return tipBlock ? parseSortableInt(tipBlock.height) : 0n;
  }

  async getTokenInfo(
    tokenId: ccc.HexLike,
    withTxAndBlock: boolean = false,
  ): Promise<
    | {
        udtInfo: UdtInfo;
        tx?: ccc.Transaction;
        block?: Block;
      }
    | undefined
  > {
    const udtInfo = await this.udtInfoRepo.getTokenInfoByTokenId(tokenId);
    if (!udtInfo) {
      return;
    }
    if (!withTxAndBlock) {
      return { udtInfo };
    }
    const issueTx = await this.client.getTransaction(
      udtInfo.firstIssuanceTxHash,
    );
    if (!issueTx) {
      return { udtInfo };
    }
    const issueBlock = await this.blockRepo.getBlockByHashOrNumber({
      hash: issueTx.blockHash,
      number: issueTx.blockNumber,
    });
    if (issueBlock) {
      return {
        udtInfo,
        tx: issueTx.transaction,
        block: issueBlock,
      };
    }
    if (issueTx.blockHash) {
      const header = await this.client.getHeaderByHash(issueTx.blockHash);
      return {
        udtInfo,
        tx: issueTx.transaction,
        block: headerToRepoBlock(header),
      };
    } else if (issueTx.blockNumber) {
      const header = await this.client.getHeaderByNumber(issueTx.blockNumber);
      return {
        udtInfo,
        tx: issueTx.transaction,
        block: headerToRepoBlock(header),
      };
    } else {
      throw new Error(
        "issueTx.blockHash or issueTx.blockNumber should be provided",
      );
    }
  }

  async getTokenHoldersCount(tokenId: ccc.HexLike): Promise<number> {
    return this.udtBalanceRepo.getItemCountByTokenHash(tokenId);
  }

  async getTokenBalanceByAddress(
    address: string,
    tokenId?: ccc.HexLike,
    height?: ccc.Num,
  ): Promise<UdtBalance[]> {
    if (height) {
      assert(
        await this.udtBalanceRepo.hasHeight(height),
        RpcError.HeightCropped,
      );
    }

    return await this.udtBalanceRepo.getTokenItemsByAddress(
      [address],
      tokenId,
      height,
    );
  }

  async getTokenBalanceByTokenId(
    tokenId: ccc.HexLike,
    addresses: string[],
    height?: ccc.Num,
  ): Promise<UdtBalance[]> {
    if (height) {
      assert(
        await this.udtBalanceRepo.hasHeight(height),
        RpcError.HeightCropped,
      );
    }

    return await this.udtBalanceRepo.getTokenItemsByAddress(
      addresses,
      tokenId,
      height,
    );
  }

  async getTokenAllBalances(
    tokenId: ccc.HexLike,
    offset: number,
    limit: number,
  ): Promise<UdtBalance[]> {
    return await this.udtBalanceRepo.getNonZeroTokenItemsByTokenId(
      tokenId,
      offset,
      limit,
    );
  }

  async scriptMode(script: ccc.ScriptLike): Promise<ScriptMode> {
    return await parseScriptMode(script, this.client, [
      {
        codeHash: this.rgbppBtcCodeHash,
        hashType: this.rgbppBtcHashType,
        mode: ScriptMode.RgbppBtc,
      },
    ]);
  }
}
