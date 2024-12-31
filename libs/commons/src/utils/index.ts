import { ccc } from "@ckb-ccc/core";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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
