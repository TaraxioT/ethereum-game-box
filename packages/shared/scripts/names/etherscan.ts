// The Etherscan v2 API calls the names scripts make: read a contract's verification, verify a proxy, and verify a
// contract from standard JSON input. Every call is spaced out to stay under the free tier's rate limit.

import type { Address } from 'viem';

import { etherscanKey } from './env.ts';

const API = 'https://api.etherscan.io/v2/api?chainid=11155111';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Reply<T> {
  status: string;
  message: string;
  result: T;
}

async function call<T>(params: Record<string, string>, body?: Record<string, string>): Promise<Reply<T>> {
  await sleep(350);
  const query = new URLSearchParams({ ...params, apikey: etherscanKey() });
  const response = await fetch(`${API}&${query}`, body ? { method: 'POST', body: new URLSearchParams(body) } : {});
  return (await response.json()) as Reply<T>;
}

/** What Etherscan knows about a contract's source. */
export interface SourceInfo {
  /** Empty when unverified. */
  ContractName: string;
  /** "0" for a plain contract; otherwise the kind of proxy Etherscan detected. */
  Proxy: string;
  Implementation: string;
  CompilerVersion: string;
}

export async function sourceInfo(address: Address): Promise<SourceInfo> {
  const reply = await call<SourceInfo[]>({ module: 'contract', action: 'getsourcecode', address });
  const info = reply.result[0];
  if (!info) throw new Error(`getsourcecode ${address}: ${reply.message}`);
  return info;
}

async function poll(action: string, guid: string): Promise<string> {
  for (let i = 0; i < 12; ++i) {
    await sleep(5000);
    const reply = await call<string>({ module: 'contract', action, guid });
    if (!/pending|queue/i.test(reply.result)) return reply.result;
  }
  return 'still pending';
}

/** `verifyproxycontract`: links a proxy to `implementation`. Returns Etherscan's answer. */
export async function verifyProxy(address: Address, implementation: Address): Promise<string> {
  const submit = await call<string>(
    { module: 'contract', action: 'verifyproxycontract' },
    { address, expectedimplementation: implementation },
  );
  if (submit.status !== '1') return submit.result;
  return poll('checkproxyverification', submit.result);
}

/** `verifysourcecode` with standard JSON input. Returns Etherscan's answer. */
export async function verifyStandardJson(
  address: Address,
  input: unknown,
  contractName: string,
  compilerVersion: string,
): Promise<string> {
  const submit = await call<string>(
    { module: 'contract', action: 'verifysourcecode' },
    {
      contractaddress: address,
      sourceCode: JSON.stringify(input),
      codeformat: 'solidity-standard-json-input',
      contractname: contractName,
      compilerversion: compilerVersion,
      constructorArguements: '',
    },
  );
  if (submit.status !== '1') return submit.result;
  return poll('checkverifystatus', submit.result);
}
