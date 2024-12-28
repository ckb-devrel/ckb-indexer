import { parseSortableInt } from "@app/commons";
import { ccc } from "@ckb-ccc/core";
import { Controller, Get, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UdtBalanceRepo, UdtInfoRepo } from "../repos";
import { BlockRepo } from "../repos/block.repo";
import {
  Chain,
  RpcError,
  RpcErrorMessage,
  TokenBalance,
  TokenInfo,
} from "./restTypes";

function assert<T>(
  expression: T | undefined | null,
  message: string | RpcError,
): T {
  if (!expression) {
    if (typeof message === "string") {
      throw new Error(message);
    } else {
      throw new Error(RpcErrorMessage[message]);
    }
  }
  return expression;
}

function assertConfig<T>(config: ConfigService, key: string): T {
  return assert(config.get<T>(key), `Missing config: ${key}`);
}

@Controller()
export class SyncController {
  private readonly client: ccc.Client;
  public readonly rgbppBtcCodeHash: ccc.Hex;
  public readonly rgbppBtcHashType: ccc.HashType;

  constructor(
    private readonly udtInfoRepo: UdtInfoRepo,
    private readonly udtBalanceRepo: UdtBalanceRepo,
    private readonly blockRepo: BlockRepo,
    private readonly configService: ConfigService,
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

  @Get("/getTokenInfo")
  async getTokenInfo(
    @Query()
    tokenId: string,
  ): Promise<TokenInfo> {
    const udtInfo = assert(
      await this.udtInfoRepo.getTokenInfoByTokenId(tokenId),
      RpcError.TokenNotFound,
    );
    const issueTx = assert(
      await this.client.getTransaction(udtInfo.firstIssuanceTxHash),
      RpcError.TxNotFound,
    );
    const issueBlock = assert(
      await this.blockRepo.getBlock({
        hash: issueTx.blockHash,
        number: issueTx.blockNumber,
      }),
      RpcError.BlockNotFound,
    );
    const holderCount =
      await this.udtBalanceRepo.getItemCountByTokenHash(tokenId);
    const rgbppIssue = issueTx.transaction.outputs.some((output) => {
      return (
        output.lock.codeHash === this.rgbppBtcCodeHash &&
        output.lock.hashType === this.rgbppBtcHashType
      );
    });
    return {
      tokenId: ccc.hexFrom(udtInfo.hash),
      name: udtInfo.name ?? undefined,
      symbol: udtInfo.symbol ?? undefined,
      decimal: udtInfo.decimals ?? undefined,
      owner: udtInfo.owner ?? undefined,
      totalAmount: udtInfo.maximumSupply
        ? ccc.numFrom(udtInfo.maximumSupply)
        : undefined,
      supplyLimit: ccc.numFrom(udtInfo.totalSupply),
      mintable: !rgbppIssue,
      holderCount: ccc.numFrom(holderCount),
      rgbppTag: rgbppIssue,
      issueChain: rgbppIssue ? Chain.Btc : Chain.Ckb,
      issueTxId: ccc.hexFrom(udtInfo.firstIssuanceTxHash),
      issueTxHeight: parseSortableInt(issueBlock.height),
      issueTime: parseSortableInt(issueBlock.timestamp),
    };
  }

  @Get("/getTokenBalance")
  async getTokenBalances(
    address: string,
    tokenId?: string,
  ): Promise<TokenBalance[]> {
    const udtBalances = await this.udtBalanceRepo.getTokenBalance(
      address,
      tokenId,
    );
    const tokenBalances = new Array<TokenBalance>();
    for (const udtBalance of udtBalances) {
      const udtInfo = assert(
        await this.udtInfoRepo.getTokenInfoByTokenId(udtBalance.tokenHash),
        RpcError.TokenNotFound,
      );
      tokenBalances.push({
        tokenId: ccc.hexFrom(udtBalance.tokenHash),
        name: udtInfo.name ?? undefined,
        symbol: udtInfo.symbol ?? undefined,
        decimal: udtInfo.decimals ?? undefined,
        address: address,
        balance: ccc.numFrom(udtBalance.balance),
      });
    }
    return tokenBalances;
  }
}
