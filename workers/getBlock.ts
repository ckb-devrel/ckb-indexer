import { ccc } from "@ckb-ccc/core";
import { parentPort, workerData } from "worker_threads";

// get block in range (start, end]
export async function* getBlocks(
  client: ccc.Client,
  startLike: ccc.NumLike,
  endLike: ccc.NumLike,
): AsyncGenerator<{
  height: ccc.Num;
  block?: ccc.ClientBlock;
}> {
  const start = ccc.numFrom(startLike);
  const end = ccc.numFrom(endLike);

  const blocksLength = Number(end - start);
  const blocks = [];
  for (let i = 0; i < blocksLength; i++) {
    blocks.push(
      (async () => {
        const height = ccc.numFrom(i + 1) + start;
        const block = await client.getBlockByNumber(height);
        if (i) {
          await blocks[i - 1];
        }

        return {
          height,
          block,
          parsing: Promise.all(
            (block?.transactions ?? [])
              .map((tx) => {
                tx.witnesses = [];
                return tx.inputs.map(async (i) => {
                  if (
                    i.previousOutput.txHash ===
                    "0x0000000000000000000000000000000000000000000000000000000000000000"
                  ) {
                    return;
                  }
                  await i.completeExtraInfos(client);
                });
              })
              .flat(),
          ),
        };
      })(),
    );
  }

  for (const pending of blocks) {
    const { height, block, parsing } = await pending;
    await parsing;
    yield { height, block };
  }
}

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

parentPort?.addListener("message", ({ start, end }) =>
  (async () => {
    const blocks = [];
    for await (const block of getBlocks(client, start, end)) {
      blocks.push(block);
    }
    parentPort?.postMessage(blocks);
  })().catch((err) => {
    console.error(err);
    throw err;
  }),
);
