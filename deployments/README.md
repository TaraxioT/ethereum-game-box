# deployments

One file per chain with every deployed address. Deploy scripts write it; `@egb/shared` reads it; nothing else
hard-codes an address. Only `sepolia.json` exists, because every contract is on Sepolia.

```json
{
  "chainId": 11155111,
  "external": { "USDC": "0x…" },
  "contracts": {
    "GameBoxNames": { "address": "0x…", "deployBlock": 12075663, "txHash": "0x…", "verified": true }
  },
  "ens": { "ETHRegistry": { "address": "0x…", "source": "https://github.com/ensdomains/contracts-v2/…" } },
  "names": {
    "registry": "0x…", "titleResolver": "0x…", "gameResolver": "0x…", "titles": { "stockduel": "0x…" },
    "gameboxResolver": "0x…"
  }
}
```

- `external`: addresses we use but don't deploy.
- `contracts`: what we deploy. `script/Deployments.sol` writes each entry. The block and transaction come from forge's
  broadcast record, so a deploy script run once more without `--broadcast` fills them in. `verified` is set by
  `pnpm names:verify`.
- `ens`: the ENSv2 contracts the Game Box names call, each with `address` and `source`: the file in
  `ensdomains/contracts-v2` (branch `deploy/mainnet-v2-20261002`), `ensdomains/ens-contracts` or
  `ensdomains/verifiable-factory` that its address and source come from. `@egb/shared/names` reads it with
  `ensAddress(name)`.
- `contracts` includes `DemoBoxAccount`, the demo Box's `P256Account`, which `P256AccountFactory` created (its block and
  transaction are the factory's `deploy` call).
- `names`: the proxies we created through ENS's `VerifiableFactory` that never move: `gamebox.eth`'s registry, the
  shared title and game resolvers and each game's title registry (all made by `GameBoxNames`), and `gamebox.eth`'s own
  resolver with the default record (`gameboxResolver`). Box and player resolvers are found from `GameBoxNames`' events.

Commit it after every deploy, in the same commit as the change that needed the deploy.
