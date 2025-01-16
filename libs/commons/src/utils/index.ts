import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  ClusterNotFound,
  SporeNotFound,
}

export const RpcErrorMessage: Record<RpcError, string> = {
  [RpcError.TokenNotFound]: "Token not found",
  [RpcError.TxNotFound]: "Tx not found",
  [RpcError.BlockNotFound]: "Block not found",
  [RpcError.CkbCellNotFound]: "Cell on ckb not found",
  [RpcError.RgbppCellNotFound]: "Rgbpp cell on ckb not found",
  [RpcError.CellNotAsset]: "Cell is not an asset",
  [RpcError.ClusterNotFound]: "Cluster not found",
  [RpcError.SporeNotFound]: "Spore not found",
};

export class ApiError {
  name = "Api Error";
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}

export function assert<T>(
  expression: T | undefined | null,
  message: string | RpcError,
): T {
  if (!expression) {
    if (typeof message === "string") {
      throw new ApiError(message);
    } else {
      throw new ApiError(RpcErrorMessage[message]);
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

export async function parseScriptModeFromAddress(
  address: string,
  client: ccc.Client,
): Promise<ScriptMode> {
  if (address.startsWith("ck")) {
    const ckbAddress = await ccc.Address.fromString(address, client);
    return await parseScriptMode(ckbAddress.script, client);
  } else {
    return ScriptMode.RgbppBtc;
  }
}

export async function parseScriptMode(
  script: ccc.ScriptLike,
  client: ccc.Client,
  extension?: {
    codeHash: ccc.Hex;
    hashType: ccc.HashType;
    mode: ScriptMode;
  }[],
): Promise<ScriptMode> {
  if (extension) {
    for (const { codeHash, hashType, mode } of extension) {
      if (script.codeHash === codeHash && script.hashType === hashType) {
        return mode;
      }
    }
  }
  const paris = {
    [ccc.KnownScript.SingleUseLock]: ScriptMode.SingleUseLock,
    [ccc.KnownScript.XUdt]: ScriptMode.Udt,
    [ccc.KnownScript.OmniLock]: ScriptMode.OmniLock,
    [ccc.KnownScript.AnyoneCanPay]: ScriptMode.Acp,
    [ccc.KnownScript.Secp256k1Blake160]: ScriptMode.Secp256k1,
    [ccc.KnownScript.JoyId]: ScriptMode.JoyId,
  };
  for (const [knownScript, mode] of Object.entries(paris)) {
    const expectedScript = await client.getKnownScript(
      knownScript as ccc.KnownScript,
    );
    if (
      script.codeHash === expectedScript.codeHash &&
      script.hashType === expectedScript.hashType
    ) {
      return mode;
    }
  }
  for (const clusterInfo of Object.values(
    ccc.spore.getClusterScriptInfos(client),
  )) {
    if (
      script.codeHash === clusterInfo?.codeHash &&
      script.hashType === clusterInfo?.hashType
    ) {
      return ScriptMode.Cluster;
    }
  }
  for (const sporeInfo of Object.values(
    ccc.spore.getSporeScriptInfos(client),
  )) {
    if (
      script.codeHash === sporeInfo?.codeHash &&
      script.hashType === sporeInfo?.hashType
    ) {
      return ScriptMode.Spore;
    }
  }
  return ScriptMode.Unknown;
}

export async function parseDogeAddress() {
  throw new Error("Not implemented");
}

export async function parseBtcAddress(params: {
  client: ccc.Client;
  rgbppScript: ccc.ScriptLike;
  requesters: AxiosInstance[];
  logger?: Logger;
}): Promise<string> {
  const { client, rgbppScript, requesters, logger } = params;
  const script = ccc.Script.from(rgbppScript);
  const ckbAddress = ccc.Address.fromScript(script, client).toString();

  const decoded = (() => {
    try {
      return RgbppLockArgs.decode(script.args);
    } catch (err) {
      return undefined;
    }
  })();
  if (!decoded) {
    return ckbAddress;
  }
  const { outIndex, txId } = decoded;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let error: any | undefined = undefined;
  for (const requester of requesters) {
    const { data } = await requester.post("/", {
      method: "getrawtransaction",
      params: [txId.slice(2), true],
    });

    if (
      data?.error &&
      !JSON.stringify(data?.error).includes(
        "No such mempool or blockchain transaction.",
      )
    ) {
      error = data.error;
      continue;
    }

    if (data?.result?.vout?.[outIndex]?.scriptPubKey?.address == null) {
      logger?.warn(
        `Failed to get btc rgbpp utxo ${txId}:${outIndex} from ${requester.getUri()}`,
      );
      continue;
    }
    return data?.result?.vout?.[outIndex]?.scriptPubKey?.address;
  }

  if (error) {
    throw error;
  }

  return ckbAddress;
}

export function extractIsomorphicInfo(
  rgbppScript: ccc.ScriptLike,
): ccc.OutPointLike | undefined {
  const decoded = (() => {
    try {
      return RgbppLockArgs.decode(rgbppScript.args);
    } catch (err) {
      return undefined;
    }
  })();
  if (!decoded) {
    return undefined;
  }

  const { outIndex, txId } = decoded;
  return { txHash: txId, index: outIndex };
}
