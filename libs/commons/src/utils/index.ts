import { Block } from "@app/schemas";
import { ccc } from "@ckb-ccc/shell";
import { cccA } from "@ckb-ccc/shell/advanced";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AxiosInstance } from "axios";
import { validate } from "bitcoin-address-validation";
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
  IsomorphicBindingNotFound,
  HeightCropped,
  InvalidAddress,
  InvalidTokenId,
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
  [RpcError.IsomorphicBindingNotFound]: "Isomorphic binding not found",
  [RpcError.HeightCropped]: "Record on height cropped",
  [RpcError.InvalidAddress]: "Invalid address",
  [RpcError.InvalidTokenId]: "Invalid token id",
};

export class ApiError {
  message: string;

  constructor(message: string) {
    this.message = message;
  }

  static fromRpcError(error: RpcError) {
    return new ApiError(RpcErrorMessage[error]);
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

export const ScriptVecOpt = ccc.mol.option(ccc.mol.vector(ccc.Script));
export const ScriptOpt = ccc.mol.option(ccc.Script);

// Refer to https://github.com/nervosnetwork/ckb-production-scripts/blob/master/c/xudt_rce.mol#L6
export const XudtWitness = ccc.mol.table({
  owner_script: ScriptOpt,
  owner_signature: ccc.mol.BytesOpt,
  extension_scripts: ScriptVecOpt,
  extension_data: ccc.mol.BytesVec,
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
  block.timestamp = Number(header.timestamp);
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
    [ccc.KnownScript.UniqueType]: ScriptMode.UniqueType,
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
  logger: Logger;
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
  // Check if txId is a standard 32-byte hex string (with 0x prefix)
  if (txId.length !== 66) {
    logger?.warn(
      `Invalid BTC txId format: ${txId}. Expected 0x-prefixed 32-byte hex string.`,
    );
    return ckbAddress;
  }

  let fallbackToCkb = false;
  for (const requester of requesters) {
    logger?.debug(
      `[parseBtcAddress] Getting ${txId} from ${requester.getUri()}`,
    );
    const { data, skip } = await (async () => {
      try {
        return await requester.post("/", {
          method: "getrawtransaction",
          params: [txId.slice(2), true],
        });
      } catch (err) {
        if (err?.response?.data?.error !== undefined) {
          return err.response;
        }
        logger?.error(
          `Failed to request ${txId}:${outIndex} from ${requester.getUri()}: ${err.message}`,
        );
        return {
          skip: true,
        };
      }
    })();

    if (skip) {
      continue;
    }

    const rpcError = data?.error ? JSON.stringify(data?.error) : undefined;
    if (rpcError) {
      // Which means the btc outpoint parsed from ckb has been dropped by btc nodes, so
      // fallback to ckb address is fine
      if (
        rpcError?.includes("No such mempool or blockchain transaction.") ||
        rpcError?.includes(
          "Retry failed, reason: Node responded with non success status code",
        )
      ) {
        fallbackToCkb = true;
        break;
      } else {
        logger?.error(
          `Failed to get ${txId}:${outIndex} from ${requester.getUri()}: ${rpcError}`,
        );
        continue;
      }
    }

    // Which means the btc tx pattern is not valid for rgbpp, so fallback to ckb address is fine
    if (data?.result?.vout?.[outIndex]?.scriptPubKey?.address == null) {
      logger?.warn(
        `Failed to parse address from ${txId}:${outIndex} from ${requester.getUri()}: ${JSON.stringify(data)}`,
      );
      fallbackToCkb = true;
      break;
    }
    return data?.result?.vout?.[outIndex]?.scriptPubKey?.address;
  }

  if (fallbackToCkb) {
    return ckbAddress;
  }

  throw new Error("Failed to get from all btc nodes, please try other nodes.");
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

export function mintableScriptMode(scriptMode: ScriptMode): boolean {
  const unmintable = [
    ScriptMode.SingleUseLock,
    ScriptMode.RgbppBtc,
    ScriptMode.RgbppDoge,
    ScriptMode.RgbppBtcTimelock,
    ScriptMode.RgbppDogeTimelock,
  ].includes(scriptMode);
  return !unmintable;
}

export function examineAddress(address: string): boolean {
  if (address.startsWith("ck")) {
    try {
      cccA.addressPayloadFromString(address);
      return true;
    } catch (_) {}
  } else {
    return validate(address);
  }
  return false;
}

export function examineTokenId(tokenId: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(tokenId);
}

export function findOwnerScriptFromIssuanceTx(
  tx: ccc.Transaction,
  udtTypeArgs: ccc.Hex,
): ccc.Script | undefined {
  const ownerScriptHash = ccc.hexFrom(ccc.bytesFrom(udtTypeArgs).slice(0, 32));

  // Compare ownerScriptHash with every parts from tx.Inputs
  for (const input of tx.inputs) {
    if (input.cellOutput?.lock.hash() === ownerScriptHash) {
      return input.cellOutput.lock;
    }
    if (input.cellOutput?.type?.hash() === ownerScriptHash) {
      return input.cellOutput.type;
    }
  }

  // Otherwise falling back to tx.Witnesses (xUDT specific)
  for (const witness of tx.witnesses) {
    try {
      const witnessArgs = ccc.WitnessArgs.fromBytes(witness);
      if (witnessArgs.inputType) {
        try {
          const xudtWitness = XudtWitness.decode(witnessArgs.inputType);
          if (xudtWitness.owner_script?.hash() === ownerScriptHash) {
            return xudtWitness.owner_script;
          }
        } catch (_) {}
      }
      if (witnessArgs.outputType) {
        try {
          const xudtWitness = XudtWitness.decode(witnessArgs.outputType);
          if (xudtWitness.owner_script?.hash() === ownerScriptHash) {
            return xudtWitness.owner_script;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
}
