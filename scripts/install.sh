#!/usr/bin/env bash
# Copy oh-my-mcode into the MiniMax Code local marketplace.
# Empirically on mcode 0.1.6, ~/.minimax/plugins/<name> auto-installs and enables.
# Packages cannot contain symlinks; this script copies files.
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
DEST_ROOT="${MINIMAX_HOME:-$HOME/.minimax}"
DEST="$DEST_ROOT/plugins/oh-my-mcode"

if [[ ! -f "$ROOT/plugin.json" || ! -f "$ROOT/.minimax-plugin/plugin.json" ]]; then
  echo "install: missing plugin manifests in $ROOT" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT/plugins"
rm -rf "$DEST"
mkdir -p "$DEST"

# Copy the plugin root. Exclude VCS and junk. Do not create symlinks.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --copy-links \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude '.minimax/runs/' \
    --exclude '.DS_Store' \
    "$ROOT/" "$DEST/"
else
  # Portable fallback: tar copy without preserving symlinks as links.
  tar -C "$ROOT" \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.minimax/runs' \
    -cf - . | tar -C "$DEST" -xf -
fi

# Flatten any accidental symlink that slipped through.
if command -v find >/dev/null 2>&1; then
  while IFS= read -r -d '' link; do
    target="$(readlink "$link" || true)"
    if [[ -n "$target" && -e "$link" ]]; then
      tmp="${link}.copy.$$"
      cp -R "$link" "$tmp"
      rm -f "$link"
      mv "$tmp" "$link"
    fi
  done < <(find "$DEST" -type l -print0)
fi

echo "Installed oh-my-mcode to $DEST"
echo
echo "This is a local marketplace drop-in. Official MiniMax catalog listing is separate"
echo "and this plugin does not claim to be listed there."
echo
echo "Confirm on mcode 0.2.7+:"
echo "  mcode --version"
echo "  mcode plugin list -m local"
echo "  mcode plugin list -m local --json"
echo
echo "Then in MiniMax Code (desktop or \`mcode\` TUI) say:"
echo "  max mode: <your task>"
echo
if command -v mcode >/dev/null 2>&1; then
  echo "mcode is on PATH: $(command -v mcode)"
  mcode --version 2>/dev/null || true
else
  echo "mcode is not on PATH in this shell. Open the MiniMax Code terminal or install the CLI, then re-run the list commands."
fi
