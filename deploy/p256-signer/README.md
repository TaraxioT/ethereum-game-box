# P-256 signer (HyperSecu HYP2003)

The Box's authority on chain is a P-256 key that lives on a HyperSecu HYP2003 USB token plugged into the Pi. The key
never leaves the token. `hyp2003_signer.py` is the small program that asks the token to sign a 32-byte digest through
PKCS#11. The Box server (`apps/box/src/server/`) starts it once from `P256_SIGNER_CMD` and keeps it running; it signs
every `Stake`, `Seat` and `Result` the Box sends through the relayer. The PIN file and the token stay on the Pi: nothing
here, and nothing in the repo, holds either.

| File | What |
|---|---|
| `hyp2003_signer.py` | the signer: `--serve` daemon, `<0xdigest>` one-shot, `--pubkey`. python3 stdlib + PyKCS11 only |
| `opensc-epass2003-hyp2003.patch` | one-hunk fix to OpenSC's ePass2003 driver that makes PIN login work on the HYP2003 |
| `build-opensc.sh` | builds that patched OpenSC into `/opt/gbx-opensc` |
| `install-libccid-id.sh` | adds the token's USB ID (`2ccf:080a`) to libccid's list |

## Setup on a fresh Pi (Debian trixie, arm64)

Everything below runs on the Pi, from this directory. Steps 1 to 3 are one-off.

1. **Packages.**

   ```sh
   sudo apt install pcscd libccid python3-pykcs11
   ```

   (`python3-cryptography` is only needed for the tests, not by the signer.)

2. **libccid must know the token.** Stock libccid has no entry for USB `2ccf:080a`, so pcscd ignores the token.

   ```sh
   deploy/p256-signer/install-libccid-id.sh
   ```

   It backs up `/etc/libccid_Info.plist` once (to `.bak-pre-hyp2003`), appends one `<string>` line to each of the
   `ifdVendorID`, `ifdProductID` and `ifdFriendlyName` arrays (`0x2CCF`, `0x080A`, `HYPERSECU USB TOKEN`) as a plain
   text insert so the file's comments survive, and restarts pcscd. Re-running it does nothing once the entry is there.
   Replug the token afterwards. If a libccid upgrade asks about the changed conffile, keep ours or re-run the script.

3. **Patched OpenSC.** Stock OpenSC logs in to this token and then loses the login (see the patch comment: the token
   answers the retries query after a good `VERIFY` with `6988` and drops the secure-messaging session). The patch skips
   that query.

   ```sh
   deploy/p256-signer/build-opensc.sh                       # add --remove-build-deps to apt-remove what it installed
   ```

   It installs the build dependencies, clones OpenSC at commit `3856d69` into a temp dir, applies
   `opensc-epass2003-hyp2003.patch`, runs `./bootstrap && ./configure --prefix=/opt/gbx-opensc
   --sysconfdir=/opt/gbx-opensc/etc --disable-doc --disable-man --disable-tests --disable-notify --disable-cmocka`,
   `make`, `make install`, then removes the temp dir. Finally it edits `share/opensc/epass2003.profile` (a `.orig` copy
   stays beside it): in the `onepin` option `protected` becomes `*=NEVER,READ=NONE, UPDATE=NONE, DELETE=NONE;` (see
   "Known limits"). It is idempotent: when `/opt/gbx-opensc/.build-stamp` matches the commit and patch it only re-checks
   the profile. `--force` rebuilds. It never touches the system OpenSC.

   The result: PKCS#11 module `/opt/gbx-opensc/lib/opensc-pkcs11.so`; the environment OpenSC needs is
   `LD_LIBRARY_PATH=/opt/gbx-opensc/lib` and `OPENSC_CONF=/opt/gbx-opensc/etc/opensc.conf`. `hyp2003_signer.py` sets
   both itself (it re-executes once if `LD_LIBRARY_PATH` lacks the lib dir), so callers don't have to. For the OpenSC
   command-line tools below you do:

   ```sh
   export LD_LIBRARY_PATH=/opt/gbx-opensc/lib OPENSC_CONF=/opt/gbx-opensc/etc/opensc.conf
   /opt/gbx-opensc/bin/pkcs11-tool --module /opt/gbx-opensc/lib/opensc-pkcs11.so -L
   ```

4. **The PIN file.** The signer reads the token PIN from `~/.config/gamebox/hyp2003-pins.env`, mode 600, one line
   `HYP2003_PIN=<pin>`. It never prints, logs or passes the PIN on a command line. Create it without leaving the PIN in
   shell history:

   ```sh
   mkdir -p ~/.config/gamebox && umask 077
   read -rsp 'HYP2003 PIN: ' p && printf 'HYP2003_PIN=%s\n' "$p" > ~/.config/gamebox/hyp2003-pins.env; unset p
   ```

5. **Check.**

   ```sh
   python3 deploy/p256-signer/hyp2003_signer.py --pubkey                  # 0x<qx> 0x<qy>
   python3 deploy/p256-signer/hyp2003_signer.py 0x$(printf '11%.0s' $(seq 32))   # 0x<r> 0x<s>
   ```

   The Box's token key is `qx = 0xedd9b952...e2a055`, `qy = 0x678bf55e...129c0c`. It is `mumbai-01`'s registered key:
   `GameBoxNames.boxKey("mumbai-01")` on Sepolia, and the `boxKey` record of `mumbai-01.gamebox.eth`.

### Initialising a blank token (documentation only: this ERASES the token)

The token that is in the Box was initialised once with these commands, with the environment from step 3 exported.
**Do not run them on a token that holds a key you want to keep: the first one erases the whole token, and the key
cannot be recovered.** The signer itself never writes to the token.

```sh
# 1. ERASES everything on the token
/opt/gbx-opensc/bin/pkcs15-init --erase-card --use-default-transport-keys
# 2. creates an empty PKCS#15 structure with one PIN (add the PIN / PUK options it asks for)
/opt/gbx-opensc/bin/pkcs15-init --create-pkcs15 --profile pkcs15+onepin --use-default-transport-keys
# 3. generates the P-256 key on the token (PKCS#11 id 01); slot 0, label gbx-test-p256
/opt/gbx-opensc/bin/pkcs11-tool --module /opt/gbx-opensc/lib/opensc-pkcs11.so --login \
    --keypairgen --key-type EC:prime256v1 --id 01 --label gbx-test-p256
```

A new key means a new `qx`/`qy`: the Box's name then needs `GameBoxNames.setBoxKey` (the licensor's call), which moves
`mumbai-01` to the new key's `P256Account`.

### Known limits

- **A correct PIN does not gate the key on this token.** The PIN-protected PKCS#15 files stay unreadable even after a
  correct PIN, so the `onepin` profile is relaxed to `UPDATE=NONE, DELETE=NONE` (step 3) and the files carry no PIN
  condition. The result: whoever holds the token can use the key. Keep the token physically in the Box.
- **8 key slots** on the token.
- **About half of the raw signatures have high-s** (the token returns either of `s` and `n - s`). The signer
  normalises to low-s (`s <= n/2`), which the contracts (`P256.sol`) require, so callers never see a high-s.
- A rejected PIN is never retried, by this process or by a restarted one (a retry loop would lock the token). See
  "Rejected PIN" below.
- One token session at a time is the happy path. Running a one-shot (`<0xdigest>`, `--pubkey`) while the daemon is live
  works, but it disturbs the daemon's session; the daemon's next request then logs a `token error`, reopens the session
  and succeeds (one extra ~20 ms).

## Options

| Option | Env | Default |
|---|---|---|
| `--module PATH` | `P256_SIGNER_MODULE` | `/opt/gbx-opensc/lib/opensc-pkcs11.so` |
| `--pin-file PATH` | `P256_SIGNER_PIN_FILE` | `~/.config/gamebox/hyp2003-pins.env` |
| `--key-id HEX` | `P256_SIGNER_KEY_ID` | `01` |
| `--pin-marker PATH` | `P256_SIGNER_PIN_MARKER` | `~/.config/gamebox/hyp2003-pin-rejected` |

## Exit codes

| Code | Meaning | Restart it? |
|---|---|---|
| 0 | clean: stdin EOF, SIGTERM or SIGINT in `--serve`; the one-shot forms succeeded | |
| 1 | the token is missing or can't be opened (also a missing PIN file or module): retryable | yes |
| 2 | usage error, or a malformed digest given to the one-shot form | no |
| 3 | the token rejected the PIN (or the marker below exists): **fatal, not retryable** | **no** |

## Rejected PIN

The token locks after a few wrong PIN tries, and a supervisor that restarts a crashing signer would burn them in
minutes. So a rejected PIN stops everything until a person intervenes:

1. When the token answers `CKR_PIN_INCORRECT` or `CKR_PIN_LOCKED` (in `--serve`, the one-shot or `--pubkey`; the other
   PIN errors, expired, invalid and bad length, count too) the signer first writes the marker file
   `~/.config/gamebox/hyp2003-pin-rejected` (mode 600: the time and the PKCS#11 error, never the PIN).
2. In `--serve` it then prints one line on stdout, `{"fatal":"pin_rejected","error":"…"}` (with an `"id"` added if a
   request was in flight), logs the reason to stderr and exits **3**. The one-shot forms print the reason to stderr and
   exit 3.
3. While the marker exists, every start (any mode) prints the same fatal line (`--serve`) and exits 3 **before any
   login**, without touching the token. A rejection mid-run, after a session reopen, ends the same way.

A client that sees exit code 3 or a `fatal` line must not restart the signer.

Recover: fix the PIN in `~/.config/gamebox/hyp2003-pins.env` (and check the token's remaining tries with
`pkcs11-tool`/`pkcs15-tool` before guessing again), then delete the marker:

```sh
rm ~/.config/gamebox/hyp2003-pin-rejected
```

and restart whatever runs the signer (for the Box: `systemctl --user restart egb-server`).

## Protocol (`--serve`)

JSON lines on stdin/stdout, one request, one response, in order. stdout is flushed after every line. Logs go to stderr
only. EOF on stdin ends the daemon with exit code 0 (so does SIGTERM or SIGINT).

```
→ (on start)                       {"ready":true,"qx":"0x…","qy":"0x…"}
← {"id":1,"digest":"0x<64 hex>"}   → {"id":1,"r":"0x<64 hex>","s":"0x<64 hex>","ms":11.2}     (s already low-s)
← {"id":2,"op":"pubkey"}           → {"id":2,"qx":"0x…","qy":"0x…"}
any failure                         → {"id":n,"error":"…"}
```

- `digest` must be `0x` plus exactly 64 hex characters. It is signed as is (raw ECDSA over the 32 bytes, no extra
  hashing). `r` and `s` are 32-byte big-endian, 0x-prefixed and zero-padded. `ms` is the time the token took.
- `id` is echoed back unchanged (`null` when the request had none or was not valid JSON).
- Errors do not stop the daemon. Error strings:
  `bad request: invalid JSON`, `bad request: expected a JSON object`, `bad request: unknown op "…"`,
  `bad digest: expected 0x followed by 64 hex characters (32 bytes)`, `no HYP2003 token present`,
  `token error: CKR_… (0x…)`, `key id NN not found on the token`.
- One logged-in PKCS#11 session is kept. On a token error the session is reopened (and the PKCS#11 module reloaded if that
  fails) and the request is retried once. If the token is unplugged, the request gets an error, and every later request
  tries to reopen it, so replugging heals it without a restart.
- If the token can't be opened at startup (missing, no PIN file, module not found) the daemon logs the reason to
  stderr and exits 1 without printing `ready`. If the PIN is rejected, or the marker exists, it prints the `fatal` line
  (see "Rejected PIN") and exits 3.
- Start-up takes about 0.2 to 0.3 s to the `ready` line. A signature takes about 11 ms on the token, about 11 ms as the
  client sees it on the Pi, about 16 ms over `ssh` on the LAN.

The one-shot forms: `hyp2003_signer.py 0x<digest>` prints `0x<r> 0x<s>` (signing time on stderr), `--pubkey` prints
`0x<qx> 0x<qy>`.

## `P256_SIGNER_CMD`

The Box server reads it from `~/.config/egb/env` (`deploy/pi/env.example`) and runs it with no shell, split on spaces.
On the Pi (the server unit's user is `pi`, which already reads the PIN file; no extra environment is needed):

```
P256_SIGNER_CMD=python3 /home/pi/egb/current/deploy/p256-signer/hyp2003_signer.py --serve
```

`~/egb/current` is the symlink the `egb-server` unit runs from (`WorkingDirectory=%h/egb/current`), so the signer
arrives with every release (`deploy/pi/`). A signer that exits is started again after a pause, except after exit 3
(the PIN): then the Box stops asking and says so in its log.

From a Mac, for dev (the Pi on the LAN as `pi`, the token stays on the Pi):

```
P256_SIGNER_CMD=ssh -o BatchMode=yes -o ServerAliveInterval=15 pi python3 /home/pi/egb/current/deploy/p256-signer/hyp2003_signer.py --serve
```

Closing the command's stdin ends the ssh session and the daemon. Use absolute paths in the command (no `~`): it isn't
run through a shell. Without `P256_SIGNER_CMD` the server signs with nothing and sends nothing to the chain; only the
tests and the simulator use a software key.
