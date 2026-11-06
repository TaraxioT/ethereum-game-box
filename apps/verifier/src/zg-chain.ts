// 0G's chain, read only: each provider's record in its serving contract. The Worker sends nothing here but storage
// payments (`zg-storage.ts`), and no contract of ours lives on it.

import { type Address, type Transport, createPublicClient, http, parseAbi } from 'viem';

import type { ZgServices } from './tee.ts';

const servingAbi = parseAbi([
  'struct Service { address provider; string serviceType; string url; uint256 inputPrice; uint256 outputPrice; uint256 updatedAt; string model; string verifiability; string additionalInfo; address teeSignerAddress; bool teeSignerAcknowledged; }',
  'function getService(address provider) view returns (Service service)',
]);

/** Provider records from the serving contract at `contract`. */
export function zgServices(contract: Address, transport: Transport): ZgServices {
  const client = createPublicClient({ transport });
  return {
    read: (provider) => client.readContract({ address: contract, abi: servingAbi, functionName: 'getService', args: [provider] }),
  };
}

export const zgTransport = (url: string): Transport => http(url, { retryCount: 1, timeout: 10_000 });
