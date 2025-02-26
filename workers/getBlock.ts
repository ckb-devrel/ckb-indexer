import { ccc } from "@ckb-ccc/shell";
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
                // tx.witnesses = [];
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

const { isMainnet, rpcUri, ssriServerUri, rpcTimeout, maxConcurrent } =
  workerData;
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
const executor = ssriServerUri
  ? new ccc.ssri.ExecutorJsonRpc(ssriServerUri, {
      maxConcurrent,
      timeout: rpcTimeout,
    })
  : undefined;

class Trait extends ccc.ssri.Trait {
  constructor(outPoint: ccc.OutPointLike, executor?: ccc.ssri.Executor) {
    super(outPoint, executor);
  }
}

parentPort?.addListener("message", ({ start, end }) =>
  (async () => {
    const blocks = [];
    for await (const block of getBlocks(client, start, end)) {
      const scriptCodes: {
        outPoint: ccc.OutPointLike;
        size: number;
        dataHash: ccc.Hex;
        typeHash?: ccc.Hex;
        isSsri: boolean;
        isSsriUdt: boolean;
      }[] = [];
      for (const tx of block.block?.transactions ?? []) {
        await Promise.all(
          tx.outputs.map(async (output, i) => {
            const data = tx.outputsData[i];
            // ELF magic number is ".ELF" => 0x7f454c46
            // ELF header has at least 64bytes
            if (!data || !data.startsWith("0x7f454c46") || data.length <= 130) {
              return;
            }

            const outPoint = {
              txHash: tx.hash(),
              index: i,
            };

            const trait = new Trait(outPoint, executor);
            let isSsri = false;
            let isSsriUdt = false;
            try {
              const { res } = await trait.hasMethods([
                "UDT.name",
                "UDT.symbol",
                "UDT.decimals",
                "UDT.icon",
              ]);
              isSsri = true;
              isSsriUdt = res.some((v) => v);
            } catch (err) {
              if (
                !(err instanceof ccc.ssri.ExecutorErrorExecutionFailed) &&
                !(err instanceof ccc.ssri.ExecutorErrorDecode)
              ) {
                throw err;
              }
            }

            scriptCodes.push({
              outPoint: {
                txHash: tx.hash(),
                index: i,
              },
              size: data.length / 2 - 1,
              dataHash: ccc.hashCkb(data),
              typeHash: output.type?.hash(),
              isSsri,
              isSsriUdt,
            });
          }),
        );
      }

      blocks.push({ ...block, scriptCodes });
    }
    parentPort?.postMessage(blocks);
  })().catch((err) => {
    console.error(err);
    throw err;
  }),
);
