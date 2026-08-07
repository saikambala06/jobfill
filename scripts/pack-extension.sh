#!/usr/bin/env bash
# Build a Chrome Web Store upload package.
#
# The store rejects (or reviewers query) permissions that only make sense in
# development, so this strips the localhost host permission rather than shipping it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist"
STAGE="$OUT/extension"

rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -r "$ROOT/extension/." "$STAGE/"

# Drop the dev-only host permission from the staged copy, leaving the source untouched.
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.host_permissions = (m.host_permissions || []).filter(h => !h.includes("localhost"));
  m.content_scripts = (m.content_scripts || []).map(cs => ({
    ...cs,
    matches: cs.matches.filter(x => !x.includes("localhost")),
  }));
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  console.log("stripped localhost permissions; version " + m.version);
' "$STAGE/manifest.json"

# Sanity-check the pieces the side panel needs before we ship a broken build.
for required in sidepanel/sidepanel.html sidepanel/sidepanel.js sidepanel/sidepanel.css popup/popup.css; do
  [ -f "$STAGE/$required" ] || { echo "missing $required" >&2; exit 1; }
done
node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!m.side_panel?.default_path) throw new Error("manifest is missing side_panel");
  if (!m.permissions.includes("sidePanel")) throw new Error("manifest is missing the sidePanel permission");
  if (m.action?.default_popup) throw new Error("default_popup would stop the side panel opening on click");
  console.log("side panel wiring verified");
' "$STAGE/manifest.json"

( cd "$STAGE" && zip -qr "$OUT/jobfill-extension.zip" . -x '.*' )
rm -rf "$STAGE"

echo "→ $OUT/jobfill-extension.zip"
echo "  Upload at https://chrome.google.com/webstore/devconsole"
