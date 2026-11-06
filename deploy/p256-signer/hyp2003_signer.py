#!/usr/bin/env python3
"""P-256 signer for the Game Box: signs 32-byte digests with the key on the HyperSecu HYP2003 USB token.

Runs on the Pi, where the token is plugged in. Needs the patched OpenSC in /opt/gbx-opensc, python3-pykcs11, the PIN in
~/.config/gamebox/hyp2003-pins.env (HYP2003_PIN=...) and libccid knowing 2ccf:080a. See README.md.

  hyp2003_signer.py --serve        JSON-lines daemon on stdin/stdout (protocol: README.md, "Protocol")
  hyp2003_signer.py <0xdigest>     prints "0x<r> 0x<s>" (low-s), the signing time goes to stderr
  hyp2003_signer.py --pubkey       prints "0x<qx> 0x<qy>"

Exit codes: 0 clean (stdin EOF / SIGTERM, one-shot done), 1 token missing or can't be opened (retryable),
2 usage error, 3 the token rejected the PIN (NOT retryable: see the marker file below).

Options (each also has an environment variable):
  --module PATH     PKCS#11 module        P256_SIGNER_MODULE    default /opt/gbx-opensc/lib/opensc-pkcs11.so
  --pin-file PATH   file with HYP2003_PIN P256_SIGNER_PIN_FILE  default ~/.config/gamebox/hyp2003-pins.env
  --key-id HEX      PKCS#11 CKA_ID        P256_SIGNER_KEY_ID    default 01
  --pin-marker PATH marker file           P256_SIGNER_PIN_MARKER default ~/.config/gamebox/hyp2003-pin-rejected

When the token rejects the PIN, the marker file is written (mode 600: timestamp and error, never the PIN) and the process
exits 3. While the marker exists no process logs in to the token at all, so a supervisor that restarts the signer cannot
burn the token's PIN retries. Fix the PIN file, then delete the marker.

The OpenSC environment (LD_LIBRARY_PATH, OPENSC_CONF) is set here; callers don't need it. The PIN is only ever read
from the file: never printed, logged or passed on a command line. Nothing here writes to the token.
"""
import argparse
import json
import os
import re
import signal
import sys
import time

DEFAULT_MODULE = "/opt/gbx-opensc/lib/opensc-pkcs11.so"
DEFAULT_PIN_FILE = "~/.config/gamebox/hyp2003-pins.env"
DEFAULT_KEY_ID = "01"
DEFAULT_PIN_MARKER = "~/.config/gamebox/hyp2003-pin-rejected"
EXIT_PIN_REJECTED = 3
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
HALF_N = N // 2
DIGEST_RE = re.compile(r"0x[0-9a-fA-F]{64}")
REEXEC_MARK = "P256_SIGNER_ENV_READY"


def log(msg):
    print("[p256-signer] " + msg, file=sys.stderr, flush=True)


def prepare_environment(module):
    """Point the dynamic loader and OpenSC at the patched build. The loader reads LD_LIBRARY_PATH only at process
    start, so when it is missing the process re-executes itself once with it set (stdin/stdout are inherited)."""
    prefix = os.path.dirname(os.path.dirname(os.path.abspath(module)))  # <prefix>/lib/opensc-pkcs11.so
    libdir = os.path.dirname(os.path.abspath(module))
    conf = os.path.join(prefix, "etc", "opensc.conf")
    if os.path.exists(conf):
        os.environ.setdefault("OPENSC_CONF", conf)
    paths = [p for p in os.environ.get("LD_LIBRARY_PATH", "").split(":") if p]
    if libdir not in paths:
        if os.environ.get(REEXEC_MARK):
            return  # already re-executed once; don't loop
        os.environ["LD_LIBRARY_PATH"] = ":".join([libdir] + paths)
        os.environ[REEXEC_MARK] = "1"
        os.execv(sys.executable, [sys.executable] + sys.argv)


def read_pin(path):
    try:
        with open(path) as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k == "HYP2003_PIN" and v:
                    return v.strip("\"'")
    except OSError as e:
        raise FatalError("cannot read PIN file %s: %s" % (path, e.strerror or e))
    raise FatalError("HYP2003_PIN missing from " + path)


class SignerError(Exception):
    """A failure with a message that is safe to send to the client."""


class FatalError(SignerError):
    """A failure that retrying cannot fix (and might make worse, like a rejected PIN): never retried."""


class PinRejected(FatalError):
    """The token refused the PIN, or a marker says an earlier run saw that. The process exits 3."""


class Token:
    """One logged-in PKCS#11 session on the token, reopened on demand."""

    def __init__(self, module, pin_file, key_id, pin_marker):
        import PyKCS11  # imported late: the one dependency, and only after the environment is prepared

        self.P = PyKCS11
        self.module = module
        self.pin_file = pin_file
        self.pin_marker = pin_marker
        self.key_id = tuple(bytes.fromhex(key_id))
        self.lib = None
        self.session = None
        self.privkey = None
        self.qx = None
        self.qy = None
        self.pin_rejected = None  # set once the token refuses the PIN: every retry would burn a try

    # --- PIN-rejected marker -------------------------------------------------------------------------------------
    def check_marker(self):
        """Before any login: an earlier run saw the PIN rejected, so don't touch the token until the marker is deleted."""
        if os.path.exists(self.pin_marker):
            self.pin_rejected = "PIN marker %s exists (the token rejected the PIN earlier); fix the PIN file, then delete the marker" % self.pin_marker
            raise PinRejected(self.pin_rejected)

    def write_marker(self, error):
        try:
            os.makedirs(os.path.dirname(self.pin_marker), mode=0o700, exist_ok=True)
            fd = os.open(self.pin_marker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write("%s\n%s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S%z"), error))
            os.chmod(self.pin_marker, 0o600)
        except OSError as e:
            log("could not write the PIN marker %s: %s" % (self.pin_marker, e))

    # --- session lifecycle -------------------------------------------------------------------------------------
    def close(self):
        s, self.session, self.privkey = self.session, None, None
        if s is not None:
            try:
                s.logout()
            except Exception:
                pass
            try:
                s.closeSession()
            except Exception:
                pass

    def _unload(self):
        self.close()
        lib, self.lib = self.lib, None
        if lib is not None:
            try:
                lib.unload()
            except Exception:
                pass

    def open(self, fresh_lib=False):
        """(Re)open the session and log in. fresh_lib also reloads the PKCS#11 module, which re-scans readers."""
        P = self.P
        if self.pin_rejected:
            raise PinRejected(self.pin_rejected)
        self.check_marker()
        self.close()
        if fresh_lib:
            self._unload()
        try:
            if self.lib is None:
                lib = P.PyKCS11Lib()
                try:
                    lib.load(self.module)
                except P.PyKCS11Error as e:
                    # A half-loaded library crashes PyKCS11 on reuse, so don't keep it or retry.
                    raise FatalError("cannot load the PKCS#11 module %s: %s" % (self.module, e))
                self.lib = lib
            slots = self.lib.getSlotList(tokenPresent=True)
            if not slots:
                raise SignerError("no HYP2003 token present")
            session = self.lib.openSession(slots[0])
            self.session = session
            try:
                session.login(read_pin(self.pin_file))
            except P.PyKCS11Error as e:
                if e.value in (P.CKR_PIN_INCORRECT, P.CKR_PIN_LOCKED, P.CKR_PIN_EXPIRED, P.CKR_PIN_INVALID, P.CKR_PIN_LEN_RANGE):
                    self.write_marker(str(e))
                    self.pin_rejected = "the token rejected the PIN (%s); not retrying, fix the PIN file and delete %s" % (e, self.pin_marker)
                    raise PinRejected(self.pin_rejected)
                if e.value != P.CKR_USER_ALREADY_LOGGED_IN:
                    raise
            self.privkey = self._find(P.CKO_PRIVATE_KEY)
            qx, qy = self._read_pubkey()
            if self.qx is not None and (qx, qy) != (self.qx, self.qy):
                log("WARNING: the token's public key changed since start")
            self.qx, self.qy = qx, qy
        except Exception:
            self.close()
            raise

    def _find(self, cls):
        objs = self.session.findObjects([(self.P.CKA_CLASS, cls), (self.P.CKA_ID, self.key_id)])
        if not objs:
            raise SignerError("key id %s not found on the token" % bytes(self.key_id).hex())
        return objs[0]

    def _read_pubkey(self):
        P = self.P
        point = bytes(self.session.getAttributeValue(self._find(P.CKO_PUBLIC_KEY), [P.CKA_EC_POINT])[0])
        # DER OCTET STRING (04 41) wrapping the uncompressed point 04 || x || y.
        raw = point[2:] if point[:2] == b"\x04\x41" else point
        if len(raw) != 65 or raw[0] != 0x04:
            raise SignerError("unexpected EC point from the token: " + point.hex())
        return raw[1:33], raw[33:]

    # --- operations -----------------------------------------------------------------------------------------------
    def _with_retry(self, fn):
        """Run fn(); on any token error reopen the session and try once more (a second reopen reloads the module).
        If the token is gone the reopen raises, the request gets an error, and the next request tries again."""
        P = self.P
        try:
            if self.session is None:
                self.open()
            return fn()
        except FatalError:
            raise
        except (P.PyKCS11Error, SignerError) as first:
            log("token error (%s); reopening the session" % describe(first))
        try:
            self.open()
        except Exception as e:
            log("reopen failed (%s); reloading the PKCS#11 module" % describe(e))
            self.open(fresh_lib=True)
        return fn()

    def pubkey(self):
        if self.qx is None or self.session is None:
            self._with_retry(lambda: None)
        return self.qx, self.qy

    def sign(self, digest):
        """digest: 32 bytes. Returns (r, s, token_ms) with s normalised to low-s."""
        P = self.P

        def go():
            t = time.perf_counter()
            sig = bytes(self.session.sign(self.privkey, digest, P.Mechanism(P.CKM_ECDSA)))
            return sig, (time.perf_counter() - t) * 1000

        sig, ms = self._with_retry(go)
        if len(sig) != 64:
            raise SignerError("token returned a %d-byte signature, expected 64" % len(sig))
        r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
        if s > HALF_N:
            s = N - s
        return r, s, ms


def describe(e):
    """Short, PIN-free text for a failure."""
    if isinstance(e, SignerError):
        return str(e)
    if hasattr(e, "value") and hasattr(e, "args") and e.__class__.__name__ == "PyKCS11Error":
        return "token error: " + str(e)
    return "%s: %s" % (e.__class__.__name__, e)


# --- JSON-lines daemon --------------------------------------------------------------------------------------------
def hex32(v):
    return "0x%064x" % v if isinstance(v, int) else "0x" + v.hex()


def handle(token, req):
    """req: parsed JSON value. Returns the response dict (without id)."""
    if not isinstance(req, dict):
        raise SignerError("bad request: expected a JSON object")
    op = req.get("op")
    if op == "pubkey":
        qx, qy = token.pubkey()
        return {"qx": hex32(qx), "qy": hex32(qy)}
    if op is not None and op != "sign":
        raise SignerError("bad request: unknown op %s" % json.dumps(op)[:40])
    digest = req.get("digest")
    if not isinstance(digest, str) or not DIGEST_RE.fullmatch(digest):
        raise SignerError("bad digest: expected 0x followed by 64 hex characters (32 bytes)")
    r, s, ms = token.sign(bytes.fromhex(digest[2:]))
    return {"r": hex32(r), "s": hex32(s), "ms": round(ms, 1)}


def serve(token):
    out = sys.stdout

    def send(obj):
        out.write(json.dumps(obj, separators=(",", ":")) + "\n")
        out.flush()

    t0 = time.perf_counter()
    try:
        token.open()
    except PinRejected as e:
        log("fatal: " + str(e))
        send({"fatal": "pin_rejected", "error": str(e)})
        return EXIT_PIN_REJECTED
    except Exception as e:
        log("cannot open the token: " + describe(e))
        return 1
    send({"ready": True, "qx": hex32(token.qx), "qy": hex32(token.qy)})
    log("ready in %.0f ms" % ((time.perf_counter() - t0) * 1000))

    def stop(*_):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while True:
            line = sys.stdin.readline()
            if not line:
                return 0  # EOF
            line = line.strip()
            if not line:
                continue
            rid = None
            try:
                try:
                    req = json.loads(line)
                except ValueError:
                    raise SignerError("bad request: invalid JSON")
                if isinstance(req, dict):
                    rid = req.get("id")
                resp = handle(token, req)
            except PinRejected as e:
                log("fatal: " + str(e))
                send({"id": rid, "fatal": "pin_rejected", "error": str(e)})
                return EXIT_PIN_REJECTED
            except SignerError as e:
                resp = {"error": str(e)}
            except Exception as e:  # token / library failures that survived the retry
                log("request failed: " + describe(e))
                resp = {"error": describe(e)}
            send({"id": rid, **resp})
    except BrokenPipeError:
        return 0
    finally:
        token.close()


def main():
    ap = argparse.ArgumentParser(description="HYP2003 P-256 signer", usage="%(prog)s (--serve | --pubkey | 0xDIGEST) [options]")
    ap.add_argument("digest", nargs="?", help="0x-prefixed 32-byte digest to sign (prints '0xr 0xs')")
    ap.add_argument("--serve", action="store_true", help="JSON-lines daemon on stdin/stdout")
    ap.add_argument("--pubkey", action="store_true", help="print '0xqx 0xqy'")
    ap.add_argument("--module", default=os.environ.get("P256_SIGNER_MODULE", DEFAULT_MODULE))
    ap.add_argument("--pin-file", default=os.environ.get("P256_SIGNER_PIN_FILE", DEFAULT_PIN_FILE))
    ap.add_argument("--key-id", default=os.environ.get("P256_SIGNER_KEY_ID", DEFAULT_KEY_ID), help="hex CKA_ID (default 01)")
    ap.add_argument("--pin-marker", default=os.environ.get("P256_SIGNER_PIN_MARKER", DEFAULT_PIN_MARKER),
                    help="file written when the token rejects the PIN; while it exists the token is not touched (exit 3)")
    args = ap.parse_args()
    if sum([args.serve, args.pubkey, args.digest is not None]) != 1:
        ap.error("give exactly one of --serve, --pubkey or a 0x digest")
    try:
        bytes.fromhex(args.key_id)
    except ValueError:
        ap.error("--key-id must be hex")

    module = os.path.expanduser(args.module)
    prepare_environment(module)
    token = Token(module, os.path.expanduser(args.pin_file), args.key_id,
                  os.path.abspath(os.path.expanduser(args.pin_marker)))

    if args.serve:
        return serve(token)
    try:
        if args.pubkey:
            qx, qy = token.pubkey()
            print(hex32(qx), hex32(qy))
        else:
            if not DIGEST_RE.fullmatch(args.digest):
                print("digest must be 0x followed by 64 hex characters (32 bytes)", file=sys.stderr)
                return 2
            r, s, ms = token.sign(bytes.fromhex(args.digest[2:]))
            print(hex32(r), hex32(s))
            print("sign_ms=%.1f" % ms, file=sys.stderr)
        return 0
    except PinRejected as e:
        print("fatal: " + str(e), file=sys.stderr)
        return EXIT_PIN_REJECTED
    except Exception as e:
        print("error: " + describe(e), file=sys.stderr)
        return 1
    finally:
        token.close()


if __name__ == "__main__":
    sys.exit(main())
