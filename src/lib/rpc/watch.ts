import { publicClient } from './client';
import type { Block, Log } from 'viem';

export type BlockListener = (block: Block) => void;
export type LogListener = (logs: Log[]) => void;

export function watchBlocks(onBlock: BlockListener) {
  return publicClient.watchBlocks({
    includeTransactions: true,
    onBlock,
  });
}

export function watchContractEvent(address: `0x${string}`, abi: any[], eventName: string, onLogs: LogListener) {
  return publicClient.watchContractEvent({
    address,
    abi,
    eventName,
    onLogs,
  });
}
