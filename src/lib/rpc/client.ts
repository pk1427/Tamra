import { createPublicClient, fallback, webSocket, http } from 'viem';
import { mainnet } from 'viem/chains';
import type { TransactionReceipt } from 'viem';

const WSS_URL = process.env.NEXT_PUBLIC_ETH_WSS_URL!;
const HTTP_URL = process.env.NEXT_PUBLIC_ETH_HTTP_URL!;

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    webSocket(WSS_URL),
    http(HTTP_URL),
  ]),
});

const receiptCache = new Map<string, { promise: Promise<TransactionReceipt | null>; receipt: TransactionReceipt | null }>();

export async function getTransactionReceiptLazy(hash: `0x${string}`): Promise<TransactionReceipt | null> {
  const cached = receiptCache.get(hash);
  if (cached) {
    return cached.receipt;
  }

  const promise = publicClient.getTransactionReceipt({ hash }).then((receipt) => {
    receiptCache.set(hash, { promise, receipt });
    return receipt;
  }).catch((err) => {
    receiptCache.set(hash, { promise, receipt: null });
    return null;
  });

  receiptCache.set(hash, { promise, receipt: null });
  return promise;
}

export async function fetchWithConcurrencyLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
