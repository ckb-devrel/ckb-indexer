import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/core";
import spore from "@ckb-ccc/spore";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AxiosInstance } from "axios";
import { formatSortableInt } from "../ormUtils";
import { ScriptMode } from "../rest";

export function sleep(time: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, time));
}

export function deduplicate<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export function autoRun(
  logger: Logger,
  autoIntervalMsRaw: string | number,
  handler: () => any,
) {
  const autoIntervalMs = Number(autoIntervalMsRaw);
  if (
    autoIntervalMs &&
    Number.isSafeInteger(autoIntervalMs) &&
    autoIntervalMs > 0
  ) {
    (async () => {
      while (true) {
        try {
          await handler();
        } catch (err) {
          logger.error(err.message, err.stack, err.context);
        }
        await sleep(autoIntervalMs);
      }
    })();
  }
}

export async function asyncSome<T>(
  arr: T[],
  predicate: (item: T) => Promise<boolean>,
) {
  for (const item of arr) {
    if (await predicate(item)) {
      return true;
    }
  }
  return false;
}

export async function asyncMap<T, R>(
  arr: T[],
  mapper: (item: T) => Promise<R>,
) {
  return Promise.all(arr.map(mapper));
}

export enum RpcError {
  TokenNotFound,
  TxNotFound,
  BlockNotFound,
  CkbCellNotFound,
  RgbppCellNotFound,
  CellNotAsset,
}

export const RpcErrorMessage: Record<RpcError, string> = {
  [RpcError.TokenNotFound]: "Token not found",
  [RpcError.TxNotFound]: "Tx not found",
  [RpcError.BlockNotFound]: "Block not found",
  [RpcError.CkbCellNotFound]: "Cell on ckb not found",
  [RpcError.RgbppCellNotFound]: "Rgbpp cell on ckb not found",
  [RpcError.CellNotAsset]: "Cell is not an asset",
};

export function assert<T>(
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

export function assertConfig<T>(config: ConfigService, key: string): T {
  return assert(config.get<T>(key), `Missing config: ${key}`);
}

export const RgbppLockArgs = ccc.mol.struct({
  outIndex: ccc.mol.Uint32,
  // No idea why the txId is reversed
  txId: ccc.mol.Byte32.map({
    inMap: (v: ccc.HexLike) => ccc.bytesFrom(v).reverse(),
    outMap: (v) => ccc.hexFrom(ccc.bytesFrom(v).reverse()),
  }),
});

export function headerToRepoBlock(
  header: ccc.ClientBlockHeader | undefined,
): Block | undefined {
  if (!header) {
    return header;
  }
  const block = new Block();
  block.hash = header.hash;
  block.height = formatSortableInt(header.number);
  block.parentHash = header.parentHash;
  return block;
}

export async function parseScriptMode(
  script: ccc.ScriptLike,
  client: ccc.Client,
  rgbpp?: {
    rgbppBtcCodeHash: ccc.Hex;
    rgbppBtcHashType: ccc.HashType;
  },
): Promise<ScriptMode> {
  if (
    script.codeHash === rgbpp?.rgbppBtcCodeHash &&
    script.hashType === rgbpp?.rgbppBtcHashType
  ) {
    return ScriptMode.Rgbpp;
  }
  const singleUseLock = await client.getKnownScript(
    ccc.KnownScript.SingleUseLock,
  );
  if (
    script.codeHash === singleUseLock?.codeHash &&
    script.hashType === singleUseLock?.hashType
  ) {
    return ScriptMode.SingleUseLock;
  }
  const xudtType = await client.getKnownScript(ccc.KnownScript.XUdt);
  if (
    script.codeHash === xudtType.codeHash &&
    script.hashType === xudtType.hashType
  ) {
    return ScriptMode.Xudt;
  }
  for (const clusterInfo of Object.values(
    spore.getClusterScriptInfos(client),
  )) {
    if (
      script.codeHash === clusterInfo?.codeHash &&
      script.hashType === clusterInfo?.hashType
    ) {
      return ScriptMode.Cluster;
    }
  }
  for (const sporeInfo of Object.values(spore.getSporeScriptInfos(client))) {
    if (
      script.codeHash === sporeInfo?.codeHash &&
      script.hashType === sporeInfo?.hashType
    ) {
      return ScriptMode.Spore;
    }
  }
  return ScriptMode.Unknown;
}

export async function parseAddress(
  scriptLike: ccc.ScriptLike,
  rgbpp?: {
    btcRequester: AxiosInstance;
    rgbppBtcCodeHash: ccc.Hex;
    rgbppBtcHashType: ccc.HashType;
  },
): Promise<{
  address: string;
  btc?: {
    txId: string;
    outIndex: number;
  };
}> {
  const script = ccc.Script.from(scriptLike);

  if (
    script.codeHash === rgbpp?.rgbppBtcCodeHash &&
    script.hashType === rgbpp?.rgbppBtcHashType
  ) {
    const decoded = (() => {
      try {
        return RgbppLockArgs.decode(script.args);
      } catch (err) {
        throw new Error(
          `Failed to decode rgbpp lock args ${script.args}: ${err.message}`,
        );
      }
    })();

    if (decoded) {
      const { outIndex, txId } = decoded;
      const { data } = await rgbpp?.btcRequester.post("/", {
        method: "getrawtransaction",
        params: [txId.slice(2), true],
      });

      if (data?.result?.vout?.[outIndex]?.scriptPubKey?.address == null) {
        throw new Error(`Failed to get btc rgbpp utxo ${txId}:${outIndex}`);
      } else {
        return {
          address: data?.result?.vout?.[outIndex]?.scriptPubKey?.address,
          btc: decoded,
        };
      }
    }
  }

  return { address: ccc.Address.fromScript(script, this.client).toString() };
}
