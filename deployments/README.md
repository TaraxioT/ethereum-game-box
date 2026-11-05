# deployments

One file per chain with every deployed address. Deploy scripts write it; `@egb/shared` reads it; nothing else
hard-codes an address. Only `sepolia.json` exists, because every contract is on Sepolia.

```json
{ "chainId": 11155111, "contracts": { "BoxRegistry": "0x…" } }
```

Commit it after every deploy, in the same commit as the change that needed the deploy.
