import { ccc } from "@ckb-ccc/shell";
import { parentPort, workerData } from "worker_threads";

const { isMainnet, rpcUri, rpcTimeout, maxConcurrent } = workerData;
const client = isMainnet
  ? new ccc.ClientPublicMainnet({
      url: rpcUri,
      maxConcurrent,
      timeout: rpcTimeout,
    })
  : new ccc.ClientPublicTestnet({
      url: rpcUri,
      maxConcurrent,
      timeout: rpcTimeout,
    });

parentPort?.addListener("message", (outputs: ccc.OutPointLike[]) =>
  (async () => {
    const promies: Promise<ccc.Cell | undefined>[] = [];
    for (const output of outputs) {
      const cell = client.getCell(output);
      promies.push(cell);
    }
    const cells = await Promise.all(promies);
    parentPort?.postMessage(cells);
  })().catch((err) => {
    console.error(err);
    throw err;
  }),
);
