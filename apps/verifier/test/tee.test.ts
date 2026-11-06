import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { SignedChatCheck, type TeeReply, type ZgService, type ZgServices, cachedServices } from '../src/tee.ts';

const ENCLAVE = privateKeyToAccount(`0x${'a1'.repeat(32)}`);
const TARGET = privateKeyToAccount(`0x${'b2'.repeat(32)}`);
const PROVIDER = `0x${'cc'.repeat(20)}` as const;
const TEXT = 'zg-sig-v1/e2ee-ct:aaa:bbb';
const CHAT = 'chat/1';

const service = (overrides: Partial<ZgService> = {}): ZgService => ({
  url: 'https://provider.example',
  model: '0GM-1.0-35B-A3B',
  verifiability: 'TeeML',
  additionalInfo: '{}',
  teeSignerAddress: ENCLAVE.address,
  teeSignerAcknowledged: true,
  ...overrides,
});

const reply = (headers: Record<string, string> = {}, provider: unknown = PROVIDER): TeeReply => ({
  headers: new Headers({ 'x-0g-e2ee': 'sealed', 'zg-res-key': CHAT, ...headers }),
  body: { x_0g_trace: { provider } },
});

async function signatureFetch(signer = ENCLAVE): Promise<typeof fetch> {
  const signature = await signer.signMessage({ message: TEXT });
  return vi.fn(async () => Response.json({ text: TEXT, signature, signing_address: ENCLAVE.address }));
}

function check(record: ZgService, signatures: typeof fetch) {
  return new SignedChatCheck({ services: { read: async () => record }, fetch: signatures, sleep: async () => undefined });
}

describe('the check', () => {
  it('passes a sealed reply whose chat the enclave signed', async () => {
    const fetch = await signatureFetch();
    expect(await check(service(), fetch).check(reply())).toEqual({
      proof: { chatId: CHAT, provider: PROVIDER, text: TEXT, signature: await ENCLAVE.signMessage({ message: TEXT }) },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://provider.example/v1/proxy/signature/chat%2F1?model=0GM-1.0-35B-A3B',
      expect.anything(),
    );
  });

  it('uses the target key when the record separates it', async () => {
    const additionalInfo = JSON.stringify({ TargetSeparated: true, ProviderType: 'tee', TargetTeeAddress: TARGET.address });
    expect(await check(service({ additionalInfo }), await signatureFetch(TARGET)).check(reply())).toHaveProperty('proof');
    expect(await check(service({ additionalInfo }), await signatureFetch(ENCLAVE)).check(reply())).toEqual({
      problem: "the signature is not the enclave's",
    });
  });

  it('keeps the listed key for a centralized provider', async () => {
    const additionalInfo = JSON.stringify({ TargetSeparated: true, ProviderType: 'centralized', TargetTeeAddress: TARGET.address });
    expect(await check(service({ additionalInfo }), await signatureFetch(ENCLAVE)).check(reply())).toHaveProperty('proof');
  });

  it('ignores the signing address the reply claims', async () => {
    const signature = await TARGET.signMessage({ message: TEXT });
    const fetch = (async () => Response.json({ text: TEXT, signature, signing_address: TARGET.address })) as typeof globalThis.fetch;
    expect(await check(service(), fetch).check(reply())).toEqual({ problem: "the signature is not the enclave's" });
  });

  it('waits a moment for a signature that is not ready', async () => {
    const good = await signatureFetch();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockImplementation(good);
    expect(await check(service(), fetch).check(reply())).toHaveProperty('proof');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['is not sealed', reply({ 'x-0g-e2ee': 'plain' }), 'the reply is not sealed'],
    ['has no chat id', { headers: new Headers({ 'x-0g-e2ee': 'sealed' }), body: {} }, 'the reply has no chat id'],
    ['names no provider', reply({}, null), 'the reply names no provider'],
    ['names a bad provider', reply({}, 'nobody'), 'the reply names no provider'],
  ])('fails a reply that %s', async (_name, input, problem) => {
    const fetch = await signatureFetch();
    expect(await check(service(), fetch).check(input)).toEqual({ problem });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['is not TeeML', { verifiability: 'OpML' }, 'the provider is not TeeML'],
    ['is not acknowledged', { teeSignerAcknowledged: false }, "the provider's enclave key is not acknowledged"],
    ['has bad additional info', { additionalInfo: '{oops' }, "the provider's record names no enclave key"],
    ['has empty additional info', { additionalInfo: '' }, "the provider's record names no enclave key"],
    ['has a bad target', { additionalInfo: '{"TargetSeparated":true,"TargetTeeAddress":"nobody"}' }, "the provider's record names no enclave key"],
  ])('fails a provider that %s', async (_name, overrides, problem) => {
    expect(await check(service(overrides), await signatureFetch()).check(reply())).toEqual({ problem });
  });

  it('fails when the chat never gets a signature', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 404 }));
    expect(await check(service(), fetch).check(reply())).toEqual({ problem: 'the chat has no signature' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('fails a signature that is not hex or does not recover', async () => {
    const notHex = (async () => Response.json({ text: TEXT, signature: 'zz' })) as typeof globalThis.fetch;
    expect(await check(service(), notHex).check(reply())).toEqual({ problem: 'the chat has no signature' });
    const broken = (async () => Response.json({ text: TEXT, signature: '0x1234' })) as typeof globalThis.fetch;
    expect(await check(service(), broken).check(reply())).toEqual({ problem: "the signature is not the enclave's" });
  });

  it('fails a signature over other text', async () => {
    const signature = await ENCLAVE.signMessage({ message: 'something else' });
    const fetch = (async () => Response.json({ text: TEXT, signature })) as typeof globalThis.fetch;
    expect(await check(service(), fetch).check(reply())).toEqual({ problem: "the signature is not the enclave's" });
  });
});

describe('the provider cache', () => {
  it('reads a provider once for a short time, then again', async () => {
    const reader: ZgServices = { read: vi.fn(async () => service()) };
    let now = 0;
    const cached = cachedServices(reader, () => now);
    await cached.read(PROVIDER);
    await cached.read(PROVIDER);
    expect(reader.read).toHaveBeenCalledTimes(1);
    now = 61_000;
    await cached.read(PROVIDER);
    expect(reader.read).toHaveBeenCalledTimes(2);
  });
});
