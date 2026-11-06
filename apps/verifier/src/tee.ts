// How the proxy proves a model turn ran in an attested enclave. 0G's replies carry no `tee_verified` field, even with
// `verify_tee: true`, so `TeeCheck` keeps the method swappable, and `SignedChatCheck` is the one that works on mainnet:
// the reply names its provider and chat, 0G's chain names that provider's enclave key, and the enclave's signature for
// that chat must recover to the key.
//
// What this does NOT prove: the signed text is `zg-sig-v1/e2ee-ct:<hash>:<hash>`, two hashes of ciphertext we never hold.
// They don't match the request or the reply, and nobody outside the enclave can recompute them. So a pass proves that a
// registered, attested enclave handled this chat id. It doesn't bind the prompt or the reply's text to the signature.

import { type Address, type Hex, isAddress, isAddressEqual, isHex, recoverMessageAddress } from 'viem';

import { isRecord, parsed } from './json.ts';

/** A model reply, as far as a check needs it. */
export interface TeeReply {
  readonly headers: Headers;
  readonly body: unknown;
}

/** What anyone can recheck a turn with. */
export interface TeeProof {
  readonly chatId: string;
  readonly provider: Address;
  readonly text: string;
  readonly signature: Hex;
}

export type TeeResult = { readonly proof: TeeProof } | { readonly problem: string };

export interface TeeCheck {
  check(reply: TeeReply): Promise<TeeResult>;
}

/** A provider's record in 0G's serving contract. */
export interface ZgService {
  readonly url: string;
  readonly model: string;
  readonly verifiability: string;
  readonly additionalInfo: string;
  readonly teeSignerAddress: Address;
  readonly teeSignerAcknowledged: boolean;
}

export interface ZgServices {
  read(provider: Address): Promise<ZgService>;
}

export interface SignedChatOptions {
  readonly services: ZgServices;
  readonly fetch: typeof fetch;
  /** Waits between tries for the signature, which 0G may not have ready the moment the reply lands. */
  readonly sleep: (ms: number) => Promise<void>;
}

const SIGNATURE_TRIES = 4;
const SIGNATURE_WAIT_MS = 500;
const SIGNATURE_MS = 10_000;
const SERVICE_TTL_MS = 60_000;

/** `services`, remembering each provider's record for a short time. */
export function cachedServices(services: ZgServices, now: () => number = Date.now): ZgServices {
  const cache = new Map<string, { service: ZgService; until: number }>();
  return {
    async read(provider) {
      const hit = cache.get(provider);
      if (hit && hit.until > now()) return hit.service;
      const service = await services.read(provider);
      cache.set(provider, { service, until: now() + SERVICE_TTL_MS });
      return service;
    },
  };
}

/** The address a provider's enclave signs with, or null if its record can't say. */
function enclaveSigner(service: ZgService): Address | null {
  const info = parsed(service.additionalInfo);
  if (!isRecord(info)) return null;
  const { TargetSeparated, ProviderType, TargetTeeAddress } = info;
  const separate = TargetSeparated === true && ProviderType !== 'centralized' && Boolean(TargetTeeAddress);
  if (!separate) return service.teeSignerAddress;
  return typeof TargetTeeAddress === 'string' && isAddress(TargetTeeAddress, { strict: false }) ? TargetTeeAddress : null;
}

export class SignedChatCheck implements TeeCheck {
  private readonly options: SignedChatOptions;

  constructor(options: SignedChatOptions) {
    this.options = options;
  }

  async check({ headers, body }: TeeReply): Promise<TeeResult> {
    const chatId = headers.get('zg-res-key');
    const trace = isRecord(body) ? body.x_0g_trace : undefined;
    const provider = isRecord(trace) ? trace.provider : undefined;
    if (headers.get('x-0g-e2ee') !== 'sealed') return { problem: 'the reply is not sealed' };
    if (!chatId) return { problem: 'the reply has no chat id' };
    if (typeof provider !== 'string' || !isAddress(provider, { strict: false })) return { problem: 'the reply names no provider' };

    const service = await this.options.services.read(provider);
    if (service.verifiability !== 'TeeML') return { problem: 'the provider is not TeeML' };
    if (!service.teeSignerAcknowledged) return { problem: "the provider's enclave key is not acknowledged" };
    const signer = enclaveSigner(service);
    if (!signer) return { problem: "the provider's record names no enclave key" };

    const signed = await this.signature(service, chatId);
    if (!signed) return { problem: 'the chat has no signature' };
    const recovered = await recoverMessageAddress({ message: signed.text, signature: signed.signature }).catch(() => null);
    if (!recovered || !isAddressEqual(recovered, signer)) return { problem: "the signature is not the enclave's" };
    return { proof: { chatId, provider, ...signed } };
  }

  /** The enclave's signature for `chatId`. Its `signing_address` field is the provider's say-so, so it goes unread. */
  private async signature(service: ZgService, chatId: string): Promise<{ text: string; signature: Hex } | null> {
    const url = `${service.url}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(service.model)}`;
    for (let tries = 1; ; tries++) {
      const reply = await this.options
        .fetch(url, { signal: AbortSignal.timeout(SIGNATURE_MS) })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (isRecord(reply) && typeof reply.text === 'string' && typeof reply.signature === 'string' && isHex(reply.signature)) {
        return { text: reply.text, signature: reply.signature };
      }
      if (tries === SIGNATURE_TRIES) return null;
      await this.options.sleep(SIGNATURE_WAIT_MS);
    }
  }
}
