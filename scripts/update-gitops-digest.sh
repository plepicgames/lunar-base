#!/bin/sh
set -eu

# Writes one published image digest into the live overlay of a checkout of
# `hannosirkel/deploys`.
#
# The promote job of `release.yml` runs this while it holds a write token for
# that repository. It changes the `digest:` line of the one image entry and
# refuses everything else. `test/update-gitops-digest.test.ts` exercises each
# refusal.

image='ghcr.io/plepicgames/lunar-base'
permitted_overlay='lunar-base/overlays/live'

reject() {
  printf 'digest update rejected: %s\n' "$1" >&2
  exit 1
}

if [ "$#" -ne 2 ]; then
  echo 'usage: update-gitops-digest.sh sha256:DIGEST OVERLAY_DIRECTORY' >&2
  exit 2
fi
digest="$1"
overlay_input="$2"

# The length first: `grep` reads lines, so a digest followed by a line break
# and more text would pass it.
case "$digest" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) reject 'malformed digest' ;;
esac
printf '%s' "$digest" | grep -Eqx 'sha256:[0-9a-f]{64}' || reject 'malformed digest'
# The all-zero digest is the sentinel of an image that was never built.
case "${digest#sha256:}" in
  *[!0]*) ;;
  *) reject 'the all-zero digest names no image' ;;
esac

# `CDPATH=` is a deliberate empty assignment: this `cd` ignores an inherited
# CDPATH.
# shellcheck disable=SC1007
overlay="$(CDPATH= cd "$overlay_input" 2>/dev/null && pwd -P)" || reject 'overlay is unavailable'
repository="$(git -C "$overlay" rev-parse --show-toplevel 2>/dev/null)" \
  || reject 'overlay is not in a Git worktree'
# shellcheck disable=SC1007
repository="$(CDPATH= cd "$repository" && pwd -P)"
[ "$overlay" = "$repository/$permitted_overlay" ] || reject 'overlay is not permitted'

kustomization="$overlay/kustomization.yaml"
if [ ! -f "$kustomization" ] || [ -L "$kustomization" ]; then
  reject 'kustomization is unavailable'
fi
[ -z "$(git -C "$repository" status --porcelain)" ] || reject 'checkout is not clean'
# `grep` and `sed` below read text. A NUL byte would make `grep` treat the
# file as binary and report matches in another form.
[ "$(tr -d '\000' <"$kustomization" | wc -c)" -eq "$(wc -c <"$kustomization")" ] \
  || reject 'kustomization is not text'

# The entry must be exactly the three documented lines, directly below the one
# top-level `images:` key and directly above the next top-level key. A second
# entry, a fourth key such as `newTag`, or another name is refused.
[ "$(grep -c '^images' "$kustomization" || true)" -eq 1 ] || reject 'expected one images block'
start="$(grep -nx 'images:' "$kustomization" | cut -d: -f1)"
case "$start" in
  '' | *[!0-9]*) reject 'expected one images block' ;;
esac
[ "$(grep -Ec '^[[:space:]-]*digest:' "$kustomization" || true)" -eq 1 ] \
  || reject 'expected one digest'

line() {
  sed -n "$1p" "$kustomization"
}
target=$((start + 3))
[ "$(line $((start + 1)))" = "  - name: $image" ] || reject 'unexpected image entry'
[ "$(line $((start + 2)))" = "    newName: $image" ] || reject 'unexpected image entry'
current="$(line "$target")"
printf '%s' "$current" | grep -Eqx '    digest: sha256:[0-9a-f]{64}' \
  || reject 'unexpected image entry'
# `sed -n '$='` counts a final line without a line break as a line; `wc -l`
# does not, and would let such a line follow the digest unchecked.
total="$(sed -n '$=' "$kustomization")"
if [ "$total" -gt "$target" ]; then
  line $((target + 1)) | grep -Eq '^[A-Za-z]' || reject 'unexpected image entry'
fi

wanted="    digest: $digest"
if [ "$current" = "$wanted" ]; then
  echo 'the overlay already records this digest: nothing to change'
  exit 0
fi

candidate="$(mktemp)"
others="$(mktemp)"
trap 'rm -f -- "$candidate" "$others"' EXIT HUP INT TERM

# The replacement is a validated digest: it holds no character `sed` reads.
sed "${target}s/.*/$wanted/" "$kustomization" >"$candidate"

# Every byte but that one line is the same, before the file is touched.
sed "${target}d" "$kustomization" >"$others"
sed "${target}d" "$candidate" | cmp -s - "$others" || reject 'replacement was not exact'
[ "$(sed -n "${target}p" "$candidate")" = "$wanted" ] || reject 'replacement was not exact'

# Written in place, so the file keeps its mode and its inode.
cat "$candidate" >"$kustomization"

expected="$(printf '1\t1\t%s/kustomization.yaml' "$permitted_overlay")"
[ "$(git -C "$repository" diff --numstat)" = "$expected" ] || reject 'unexpected diff'
echo "the overlay now records $digest"
