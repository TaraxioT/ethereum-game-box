# deployments

One file per chain with every deployed address. Deploy scripts write it; `@egb/shared` reads it; nothing else
hard-codes an address. Only `sepolia.json` exists, because every contract is on Sepolia.

```json
{ "chainId": 11155111, "contracts": { "BoxRegistry": "0x…" } }
```

`ens` holds the ENSv2 contracts the Game Box names call, each with `address` and `source`: the file in
`ensdomains/contracts-v2` (branch `deploy/mainnet-v2-20261002`) or `ensdomains/verifiable-factory` its address and
source come from. `@egb/shared/names` reads it with `ensAddress(name)`.

Commit it after every deploy, in the same commit as the change that needed the deploy.
