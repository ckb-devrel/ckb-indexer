import { ccc } from "@ckb-ccc/shell";
import { parentPort, workerData } from "worker_threads";

function sleep(time: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, time));
}

const chunkSize = 20;

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
    const cells: ccc.Cell[] = [];
    while (outputs.length > 0) {
      const promies: Promise<ccc.Cell | undefined>[] = [];
      for (const output of outputs.splice(0, chunkSize)) {
        const cell = client.getCell(output);
        promies.push(cell);
      }
      await sleep(200);
      const results = await Promise.all(promies);
      cells.push(...results.filter((cell) => cell !== undefined));
    }
    parentPort?.postMessage(cells);
  })().catch((err) => {
    console.error(err);
    throw err;
  }),
);
