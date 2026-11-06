# The Box key

`BoxSigner` (`signer.ts`): signs a 32-byte digest raw with P-256 and a low `s`, the form every Box-signed message
(`Stake`, `Seat`, `Result`) takes.

| Module | What it is |
|---|---|
| `hyp2003.ts` | `processSigner(P256_SIGNER_CMD, log)`: the HYP2003 token's daemon (`deploy/p256-signer/hyp2003_signer.py --serve`), kept running, over JSON lines. It is started again 5 s after it exits, except after a `fatal` line or exit 3 (the token refused the PIN), when the Box stops asking rather than lock the token. The PIN never passes through here: the daemon reads it on the Pi. |
| `software.ts` | `softwareSigner(scalar)`: a key in memory, for the simulator and the tests only. |

Tests: `hyp2003.test.ts` runs the client against a stand-in daemon with the same protocol: ready and the key, a
signature that verifies, an error passed on, a restart after an exit, and no restart after a refused PIN.
