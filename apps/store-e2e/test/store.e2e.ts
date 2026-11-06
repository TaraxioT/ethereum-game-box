import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type World, startWorld } from '../src/world.ts';

let world: World;

beforeAll(async () => {
  world = await startWorld();
});

afterAll(async () => {
  await world?.stop();
});

describe('spike', () => {
  it('boots', async () => {
    const health = await (await fetch(`${world.relayerUrl}/health`)).json();
    console.log(health);
    const verifier = await (await fetch(`${world.verifierUrl}/health`)).json();
    console.log(verifier);
    const index = await (await fetch(`${world.storeUrl}/index.json`)).json();
    console.log(index);
    expect(1).toBe(1);
  });
});
