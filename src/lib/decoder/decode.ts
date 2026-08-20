import { decodeFunctionData, decodeEventLog, decodeAbiParameters } from 'viem';
import {
  ERC20_TRANSFER_FUNCTION_ABI,
  ERC20_APPROVE_FUNCTION_ABI,
  UNISWAP_V3_ROUTER_EXACT_INPUT_SINGLE_ABI,
  ERC20_TRANSFER_EVENT_ABI,
  ERC20_APPROVAL_EVENT_ABI,
  UNISWAP_V3_POOL_SWAP_EVENT_ABI,
} from './known-signatures';

type DecodedCall = {
  functionName: string;
  args: unknown[];
  error?: string;
};

type DecodedLog = {
  eventName: string;
  args: Record<string, unknown>;
  address: `0x${string}`;
};

export function decodeTx(data: `0x${string}`): DecodedCall {
  const abis = [
    ERC20_TRANSFER_FUNCTION_ABI,
    ERC20_APPROVE_FUNCTION_ABI,
    UNISWAP_V3_ROUTER_EXACT_INPUT_SINGLE_ABI,
  ];

  for (const abi of abis) {
    try {
      const result = decodeFunctionData({ abi, data });
      return {
        functionName: result.functionName,
        args: result.args as unknown as unknown[],
      };
    } catch {
      continue;
    }
  }

  return {
    functionName: 'unknown',
    args: [data],
    error: 'Selector not found in known ABIs',
  };
}

export function decodeLogs(logs: { data: `0x${string}`; topics: `0x${string}`[]; address: `0x${string}` }[]): DecodedLog[] {
  const eventAbis = [
    ERC20_TRANSFER_EVENT_ABI,
    ERC20_APPROVAL_EVENT_ABI,
    UNISWAP_V3_POOL_SWAP_EVENT_ABI,
  ];

  return logs.map((log) => {
    for (const abi of eventAbis) {
      try {
        const result = decodeEventLog({ abi, ...log } as any);
        return {
          eventName: result.eventName,
          args: result.args as unknown as Record<string, unknown>,
          address: log.address,
        };
      } catch {
        continue;
      }
    }

    return {
      eventName: 'unknown',
      args: { topics: log.topics, data: log.data },
      address: log.address,
    };
  });
}

export function parseTextSignature(sig: string): { functionName: string; paramTypes: string[] } | null {
  const match = sig.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)?\)$/);
  if (!match) return null;

  const functionName = match[1];
  const paramsStr = match[2];

  if (!paramsStr.trim()) {
    return { functionName, paramTypes: [] };
  }

  const paramTypes: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      current += char;
    } else if (char === ')' || char === ']' || char === '}') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      paramTypes.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    paramTypes.push(current.trim());
  }

  return { functionName, paramTypes };
}

export function decodeWithTextSignature(data: `0x${string}`, textSignature: string): { functionName: string; args: unknown[] } | null {
  const parsed = parseTextSignature(textSignature);
  if (!parsed) return null;

  const { functionName, paramTypes } = parsed;

  if (data.length < 10) return null;

  const calldata = data as `0x${string}`;
  const parameters = paramTypes.map((type) => ({ type } as { type: string }));

  try {
    const args = decodeAbiParameters(parameters, calldata);
    return { functionName, args: args as unknown[] };
  } catch {
    return null;
  }
}
