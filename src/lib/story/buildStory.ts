import type { Transaction, TransactionReceipt } from 'viem';

export type Story = {
  summary: string;
  breakdown: {
    functionCalled: string;
    tokenAmounts: Record<string, string>;
    gasUsed: string;
    success: boolean;
    from: `0x${string}`;
    to: `0x${string}`;
  };
};

export function buildStory({
  tx,
  receipt,
  decodedCall,
  decodedEvents,
  resolvedSignature,
}: {
  tx: Transaction;
  receipt: TransactionReceipt;
  decodedCall: { functionName: string; args: unknown[]; error?: string };
  decodedEvents: { eventName: string; args: Record<string, unknown>; address: `0x${string}` }[];
  resolvedSignature?: string;
}): Story {
  const success = receipt.status === 'success';

  const tokenAmounts: Record<string, string> = {};
  for (const ev of decodedEvents) {
    if (ev.eventName === 'Transfer') {
      const value = ev.args.value;
      if (typeof value === 'bigint') {
        tokenAmounts[ev.address] = value.toString();
      }
    } else if (ev.eventName === 'Approval') {
      const value = ev.args.value;
      if (typeof value === 'bigint') {
        tokenAmounts[ev.address] = value.toString();
      }
    } else if (ev.eventName === 'Swap') {
      const amount0 = ev.args.amount0;
      const amount1 = ev.args.amount1;
      if (typeof amount0 === 'bigint') {
        tokenAmounts['amount0'] = amount0.toString();
      }
      if (typeof amount1 === 'bigint') {
        tokenAmounts['amount1'] = amount1.toString();
      }
    }
  }

  let summary = '';
  if (decodedCall.error || !decodedCall.args) {
    if (resolvedSignature) {
      summary = `Called ${resolvedSignature} on ${tx.to}`;
    } else {
      summary = `Unknown call from ${tx.from} to ${tx.to}`;
    }
  } else if (decodedCall.functionName === 'transfer') {
    const [to, value] = decodedCall.args as [`0x${string}`, bigint];
    if (typeof value === 'bigint' && typeof to === 'string') {
      summary = `Transfer ${value.toString()} tokens from ${tx.from} to ${to}`;
    } else {
      summary = `Unrecognized transaction`;
    }
  } else if (decodedCall.functionName === 'approve') {
    const [spender, value] = decodedCall.args as [`0x${string}`, bigint];
    if (typeof value === 'bigint' && typeof spender === 'string') {
      summary = `Approve ${value.toString()} tokens for ${spender} from ${tx.from}`;
    } else {
      summary = `Unrecognized transaction`;
    }
  } else if (decodedCall.functionName === 'exactInputSingle') {
    summary = `Swap via Uniswap V3 exactInputSingle from ${tx.from}`;
  } else {
    summary = `${decodedCall.functionName} from ${tx.from} to ${tx.to}`;
  }

  if (!success) {
    summary = `Failed: ${summary}`;
  }

  return {
    summary,
    breakdown: {
      functionCalled: decodedCall.error ? 'unknown' : decodedCall.functionName,
      tokenAmounts,
      gasUsed: receipt.gasUsed.toString(),
      success,
      from: tx.from,
      to: tx.to ?? '0x',
    },
  };
}
