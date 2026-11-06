#!/bin/bash
# Teaches libccid (the PC/SC USB smart-card driver) about the HyperSecu HYP2003 token, USB ID 2ccf:080a.
#   deploy/p256-signer/install-libccid-id.sh
# libccid only drives readers listed in /etc/libccid_Info.plist, as three parallel arrays (ifdVendorID, ifdProductID,
# ifdFriendlyName) matched by position. This appends one <string> line to each array, as a plain text insert so the
# file's comments and layout survive (a plistlib rewrite would drop them), then restarts pcscd.
# Idempotent: does nothing when the entry is already there. Backs the file up once, to
# /etc/libccid_Info.plist.bak-pre-hyp2003. Needs sudo. A libccid package upgrade may ask about this conffile: keep ours,
# or re-run this script.
set -euo pipefail

PLIST=${LIBCCID_PLIST:-/etc/libccid_Info.plist}
BACKUP=$PLIST.bak-pre-hyp2003
VID=0x2CCF PID=0x080A NAME="HYPERSECU USB TOKEN"

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO=sudo
[ -f "$PLIST" ] || { echo "$PLIST not found (apt install pcscd libccid)" >&2; exit 1; }

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

# Exit 0 + new text in $tmp: inserted. Exit 10: already present. Any other exit: refused, nothing written.
set +e
python3 - "$PLIST" "$tmp" "$VID" "$PID" "$NAME" <<'PY'
import re, sys
path, out, vid, pid, name = sys.argv[1:6]
text = open(path, encoding="utf-8").read()
want = {"ifdVendorID": vid, "ifdProductID": pid, "ifdFriendlyName": name}
spans, values = {}, {}
for key in want:
    m = re.search(r"<key>%s</key>\s*<array>(.*?)</array>" % key, text, re.S)
    if not m:
        sys.exit("array %s not found in %s" % (key, path))
    spans[key] = m
    values[key] = re.findall(r"<string>(.*?)</string>", m.group(1))
if len({len(v) for v in values.values()}) != 1:
    sys.exit("the three arrays have different lengths; refusing to edit " + path)
rows = list(zip(values["ifdVendorID"], values["ifdProductID"], values["ifdFriendlyName"]))
if any(v.lower() == vid.lower() and p.lower() == pid.lower() and n == name for v, p, n in rows):
    sys.exit(10)
# Insert before each closing </array>, last array first so the earlier offsets stay valid. The new line copies the
# indentation of the array's last <string> line.
for key in sorted(want, key=lambda k: -spans[k].start()):
    m = spans[key]
    body = m.group(1)
    last = body.rstrip().rsplit("\n", 1)[-1]
    indent = re.match(r"\s*", last).group(0)
    end = m.end(1)  # offset of </array>
    prefix = text[:end]
    closing_indent = prefix[len(prefix.rstrip(" \t")):]  # whitespace before </array> on its own line
    prefix = prefix[: len(prefix) - len(closing_indent)]
    text = prefix + "%s<string>%s</string>\n" % (indent, want[key]) + closing_indent + text[end:]
open(out, "w", encoding="utf-8").write(text)
PY
rc=$?
set -e
if [ "$rc" -eq 10 ]; then
  echo "libccid already knows $VID:$PID ($NAME); nothing to do"
  exit 0
fi
[ "$rc" -eq 0 ] || exit "$rc"

# Sanity: the edited file must still parse as a plist with equal-length arrays and the new row last.
python3 - "$tmp" "$VID" "$PID" "$NAME" <<'PY'
import plistlib, sys
d = plistlib.load(open(sys.argv[1], "rb"))
v, p, n = d["ifdVendorID"], d["ifdProductID"], d["ifdFriendlyName"]
assert len(v) == len(p) == len(n), "array lengths differ after edit"
assert (v[-1].lower(), p[-1].lower(), n[-1]) == (sys.argv[2].lower(), sys.argv[3].lower(), sys.argv[4]), "new row not last"
PY

[ -e "$BACKUP" ] || $SUDO cp -p "$PLIST" "$BACKUP"
$SUDO install -m 644 "$tmp" "$PLIST"
echo "added $VID:$PID ($NAME) to $PLIST (backup: $BACKUP)"
$SUDO systemctl restart pcscd
echo "pcscd restarted; unplug and replug the token if it was already connected"
