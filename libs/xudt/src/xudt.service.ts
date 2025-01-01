import { assertConfig, headerToRepoBlock, ScriptMode } from "@app/commons";
import { Block, UdtBalance, UdtInfo } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UdtBalanceRepo, UdtInfoRepo } from "./repos";
import { BlockRepo } from "./repos/block.repo";

@Injectable()
export class XudtService {
  private readonly client: ccc.Client;
  private readonly rgbppBtcCodeHash: ccc.Hex;
  private readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    private readonly configService: ConfigService,
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtBalanceRepo: UdtBalanceRepo,
    private readonly blockRepo: BlockRepo,
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

  async getTokenInfo(
    tokenId: ccc.HexLike,
    withTxAndBlock: boolean = false,
  ): Promise<{
    udtInfo: UdtInfo;
    tx?: ccc.Transaction;
    block?: Block;
  } | null> {
    const udtInfo = await this.udtInfoRepo.getTokenInfoByTokenId(tokenId);
    if (!udtInfo) {
      return null;
    }
    if (withTxAndBlock) {
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
      if (!issueBlock) {
        if (issueTx.blockHash) {
          const header = await this.client.getHeaderByHash(issueTx.blockHash);
          return {
            udtInfo,
            tx: issueTx.transaction,
            block: headerToRepoBlock(header),
          };
        } else if (issueTx.blockNumber) {
          const header = await this.client.getHeaderByNumber(
            issueTx.blockNumber,
          );
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
      return {
        udtInfo,
        tx: issueTx.transaction,
        block: issueBlock,
      };
    } else {
      return { udtInfo };
    }
  }

  async getTokenHoldersCount(tokenId: ccc.HexLike): Promise<number> {
    return this.udtBalanceRepo.countBy({ tokenHash: ccc.hexFrom(tokenId) });
  }

  async getTokenBalance(
    address: string,
    tokenId?: ccc.HexLike,
  ): Promise<UdtBalance[]> {
    return await this.udtBalanceRepo.getTokenByAddress(address, tokenId);
  }

  async getTokenAllBalances(tokenId: ccc.HexLike): Promise<UdtBalance[]> {
    return await this.udtBalanceRepo.getTokenByTokenId(tokenId);
  }

  async parseScriptMode(script: ccc.ScriptLike): Promise<ScriptMode> {
    if (
      script.codeHash === this.rgbppBtcCodeHash &&
      script.hashType === this.rgbppBtcHashType
    ) {
      return ScriptMode.Rgbpp;
    }
    const singleUseLock = await this.client.getKnownScript(
      ccc.KnownScript.SingleUseLock,
    );
    if (
      script.codeHash === singleUseLock.codeHash &&
      script.hashType === singleUseLock.hashType
    ) {
      return ScriptMode.SingleUseLock;
    }
    const xudtType = await this.client.getKnownScript(ccc.KnownScript.XUdt);
    if (
      script.codeHash === xudtType.codeHash &&
      script.hashType === xudtType.hashType
    ) {
      return ScriptMode.Xudt;
    }
    // todo: add spore script
    return ScriptMode.Unknown;
  }
}
