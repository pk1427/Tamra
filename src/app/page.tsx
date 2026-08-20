'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { watchBlocks } from '@/lib/rpc/watch';
import { getTransactionReceiptLazy } from '@/lib/rpc/client';
import { decodeTx, decodeLogs, decodeWithTextSignature } from '@/lib/decoder/decode';
import { buildStory } from '@/lib/story/buildStory';
import type { Block, Transaction, TransactionReceipt } from 'viem';

function stringifyArgs(args: unknown): string {
  return JSON.stringify(args, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

type DecodedTx = {
  hash: string;
  tx: Transaction;
  decodedCall: ReturnType<typeof decodeTx>;
  receipt: TransactionReceipt | null;
  decodedEvents: ReturnType<typeof decodeLogs>;
  story: ReturnType<typeof buildStory> | null;
};

type BlockItem = {
  number: bigint;
  hash: string;
  timestamp: bigint;
  txs: DecodedTx[];
};

function triggerSelectorLookups(
  txs: { tx: Transaction; decodedCall: ReturnType<typeof decodeTx> }[],
  lookupCache: React.MutableRefObject<Map<string, string | null>>,
  pendingLookups: React.MutableRefObject<Set<string>>,
  setResolvedSignatures: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  const uniqueSelectors = new Set<string>();

  for (const { tx, decodedCall } of txs) {
    if (decodedCall.functionName !== 'unknown') continue;
    const selector = tx.input.slice(0, 10) as `0x${string}`;
    if (!/^0x[0-9a-f]{8}$/i.test(selector)) continue;
    if (lookupCache.current.has(selector)) continue;
    if (pendingLookups.current.has(selector)) continue;
    uniqueSelectors.add(selector);
  }

  if (uniqueSelectors.size === 0) return;

  // Temporary: verify dedup count per block
  // eslint-disable-next-line no-console
  console.log(`[lookup] Fetching ${uniqueSelectors.size} new selector(s)`);

  for (const selector of uniqueSelectors) {
    pendingLookups.current.add(selector);

    fetch(`/api/lookup-selector?selector=${selector}`)
      .then((r) => r.json())
      .then((data) => {
        const signature = data.signature ?? null;
        lookupCache.current.set(selector, signature);
        if (signature) {
          setResolvedSignatures((prev) => ({ ...prev, [selector]: signature }));
        }
      })
      .catch(() => {
        lookupCache.current.set(selector, null);
      })
      .finally(() => {
        pendingLookups.current.delete(selector);
      });
  }
}

export default function Home() {
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadingReceipts, setLoadingReceipts] = useState<Set<string>>(new Set());
  const [resolvedSignatures, setResolvedSignatures] = useState<Record<string, string>>({});
  const lookupCache = useRef<Map<string, string | null>>(new Map());
  const pendingLookups = useRef<Set<string>>(new Set());

  useEffect(() => {
    let unwatch: (() => void) | undefined;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      setStatus('connecting');

      unwatch = watchBlocks(async (block) => {
        setStatus('live');

        try {
          const fullBlock = block as Block & { transactions: Transaction[] };

          const txs: DecodedTx[] = fullBlock.transactions.map((tx) => {
            const decodedCall = decodeTx(tx.input as `0x${string}`);
            return {
              hash: tx.hash,
              tx,
              decodedCall,
              receipt: null,
              decodedEvents: [],
              story: null,
            };
          });

          setBlocks((prev) => {
            const next = [{
              number: fullBlock.number as bigint,
              hash: fullBlock.hash as string,
              timestamp: fullBlock.timestamp,
              txs,
            }, ...prev];
            return next.slice(0, 50);
          });

          triggerSelectorLookups(
            txs,
            lookupCache,
            pendingLookups,
            setResolvedSignatures,
          );
        } catch (err) {
          console.error('Failed to process block', err);
          setStatus('reconnecting');
          reconnectTimer = setTimeout(connect, 3000);
        }
      });
    };

    connect();

    return () => {
      if (unwatch) unwatch();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const formatTime = useCallback((ts: bigint) => {
    return new Date(Number(ts) * 1000).toLocaleTimeString();
  }, []);

  const handleExpand = useCallback(async (txHash: string) => {
    setExpanded((current) => current === txHash ? null : txHash);

    if (expanded === txHash) return;

    setLoadingReceipts((prev) => new Set(prev).add(txHash));

    try {
      const receipt = await getTransactionReceiptLazy(txHash as `0x${string}`);

      setBlocks((prev) => {
        const next = prev.map((block) => ({
          ...block,
          txs: block.txs.map((tx) => {
            if (tx.hash !== txHash) return tx;
            const decodedEvents = receipt ? decodeLogs(receipt.logs) : [];
            const selector = tx.tx.input.slice(0, 10) as `0x${string}`;
            const resolvedSignature = resolvedSignatures[selector];
            const story = receipt ? buildStory({
              tx: tx.tx,
              receipt,
              decodedCall: tx.decodedCall,
              decodedEvents,
              resolvedSignature,
            }) : null;
            return { ...tx, receipt, decodedEvents, story };
          }),
        }));
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch receipt', err);
    } finally {
      setLoadingReceipts((prev) => {
        const next = new Set(prev);
        next.delete(txHash);
        return next;
      });
    }
  }, [expanded]);

  const getPartialSummary = useCallback((tx: DecodedTx) => {
    if (tx.story) return tx.story.summary;
    if (tx.decodedCall.error || !tx.decodedCall.args) {
      const selector = tx.tx.input.slice(0, 10) as `0x${string}`;
      const signature = resolvedSignatures[selector];
      if (signature) {
        return `Called ${signature}`;
      }
      return `Unrecognized transaction`;
    }
    if (tx.decodedCall.functionName === 'transfer') {
      const [to, value] = tx.decodedCall.args as [`0x${string}`, bigint];
      if (typeof to === 'string' && typeof value === 'bigint') {
        return `Transfer ${value.toString()} tokens to ${to}`;
      }
      return `Unrecognized transaction`;
    }
    if (tx.decodedCall.functionName === 'approve') {
      const [spender, value] = tx.decodedCall.args as [`0x${string}`, bigint];
      if (typeof spender === 'string' && typeof value === 'bigint') {
        return `Approve ${value.toString()} tokens for ${spender}`;
      }
      return `Unrecognized transaction`;
    }
    if (tx.decodedCall.functionName === 'exactInputSingle') {
      return 'Swap via Uniswap V3 exactInputSingle';
    }
    return `${tx.decodedCall.functionName} call`;
  }, [resolvedSignatures]);

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      <header className="border-b border-zinc-800 p-4 flex items-center justify-between sticky top-0 bg-black/80 backdrop-blur z-10">
        <h1 className="text-lg font-bold tracking-tight">Tamra</h1>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'live'
                ? 'bg-green-500'
                : status === 'reconnecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-zinc-500'
            }`}
          />
          <span className="text-xs text-zinc-400 capitalize">{status}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {blocks.length === 0 && (status === 'connecting' || status === 'reconnecting') && (
          <div className="text-center text-zinc-500 py-20">
            {status === 'connecting' ? 'Waiting for blocks...' : 'Reconnecting...'}
          </div>
        )}

        {blocks.map((block) => (
          <div key={block.hash} className="border border-zinc-800 rounded-lg overflow-hidden">
            <div className="bg-zinc-900 p-3 flex items-center justify-between">
              <div>
                <span className="text-zinc-400 text-xs">Block #{block.number.toString()}</span>
                <div className="text-xs text-zinc-600 font-mono mt-0.5">{block.hash.slice(0, 14)}...</div>
              </div>
              <div className="text-xs text-zinc-500">{formatTime(block.timestamp)}</div>
            </div>

            <div className="divide-y divide-zinc-800">
              {block.txs.map((tx) => (
                <div key={tx.hash}>
                  <button
                    onClick={() => handleExpand(tx.hash)}
                    className="w-full text-left p-3 hover:bg-zinc-900 flex items-center justify-between transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${tx.story?.breakdown.success === false ? 'text-red-400' : 'text-zinc-200'}`}>
                        {getPartialSummary(tx)}
                      </div>
                      <div className="text-xs text-zinc-600 font-mono mt-1 truncate">
                        {tx.hash}
                      </div>
                    </div>
                    <span className="text-zinc-600 ml-2 text-xs">{expanded === tx.hash ? '▲' : '▼'}</span>
                  </button>

                  {expanded === tx.hash && (
                    <div className="p-4 bg-zinc-950 border-t border-zinc-800 space-y-3">
                      {loadingReceipts.has(tx.hash) && !tx.receipt ? (
                        <div className="text-center text-zinc-500 py-4">
                          <span className="inline-block animate-spin mr-2">&#9696;</span>
                          Fetching receipt...
                        </div>
                      ) : tx.story ? (
                        <>
                          <div>
                            <div className="text-xs text-zinc-500 mb-1">Function / Event</div>
                            <div className="text-sm text-zinc-300">
                              {(() => {
                                const selector = tx.tx.input.slice(0, 10);
                                const resolved = resolvedSignatures[selector];
                                const name = tx.decodedCall.error ? (resolved || 'Unknown') : tx.decodedCall.functionName;
                                return name;
                              })()}
                              {tx.decodedEvents.length > 0 && (
                                <span className="text-zinc-500 ml-2">
                                  + {tx.decodedEvents.map(e => e.eventName).join(', ')}
                                </span>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 mb-1">Token Amounts</div>
                            <div className="text-sm text-zinc-300">
                              {Object.keys(tx.story.breakdown.tokenAmounts).length > 0 ? (
                                <pre className="text-xs overflow-auto whitespace-pre-wrap">
                                  {stringifyArgs(tx.story.breakdown.tokenAmounts)}
                                </pre>
                              ) : (
                                'None'
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">Gas Used</div>
                              <div className="text-sm text-zinc-300">{tx.story.breakdown.gasUsed}</div>
                            </div>
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">Status</div>
                              <div className={`text-sm ${tx.story.breakdown.success ? 'text-green-400' : 'text-red-400'}`}>
                                {tx.story.breakdown.success ? 'Success' : 'Failed'}
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 mb-1">From → To</div>
                            <div className="text-sm text-zinc-300 font-mono break-all">
                              {tx.story.breakdown.from} → {tx.story.breakdown.to}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 mb-1">Raw Call Args</div>
                            {(() => {
                              const selector = tx.tx.input.slice(0, 10);
                              const resolved = resolvedSignatures[selector];
                              if (resolved) {
                                const decoded = decodeWithTextSignature(tx.tx.input as `0x${string}`, resolved);
                                if (decoded) {
                                  return (
                                    <pre className="text-xs text-zinc-400 overflow-auto whitespace-pre-wrap">
                                      {stringifyArgs(decoded.args)}
                                    </pre>
                                  );
                                }
                                return (
                                  <pre className="text-xs text-zinc-400 overflow-auto whitespace-pre-wrap">
                                    {resolved}
                                  </pre>
                                );
                              }
                              return (
                                <pre className="text-xs text-zinc-400 overflow-auto whitespace-pre-wrap">
                                  {stringifyArgs(tx.decodedCall.args)}
                                </pre>
                              );
                            })()}
                          </div>

                          {tx.decodedEvents.length > 0 && (
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">Decoded Events</div>
                              {tx.decodedEvents.map((ev, i) => (
                                <div key={i} className="text-xs text-zinc-400 mb-1">
                                  <span className="text-zinc-500">{ev.address.slice(0, 10)}...</span>:                                    {ev.eventName} {stringifyArgs(ev.args)}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-sm text-zinc-300">
                          {tx.decodedCall.error ? 'Unknown call' : tx.decodedCall.functionName}
                          <pre className="text-xs text-zinc-400 overflow-auto whitespace-pre-wrap mt-2">
                            {stringifyArgs(tx.decodedCall.args)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
