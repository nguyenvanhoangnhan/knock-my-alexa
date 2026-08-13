#!/usr/bin/env bash
# Scans for credentials before they can reach git history.
#   --staged   scan files staged for commit (default; used by the pre-commit hook)
#   --tracked  scan every tracked file (used before push)
set -euo pipefail

mode="${1:---staged}"
cd "$(git rev-parse --show-toplevel)"

# These files contain the detection patterns themselves.
self_re='^(scripts/check-secrets\.sh|\.githooks/pre-commit|\.claude/settings\.json)$'

# Secret stores that must never be tracked at all.
banned_re='(^|/)\.dev\.vars$|(^|/)\.env(\.[^/]*)?$|\.pem$|\.key$|\.p12$|\.pfx$'

if [ "$mode" = "--tracked" ]; then
  files="$(git ls-files)"
else
  files="$(git diff --cached --name-only --diff-filter=ACMR)"
fi

[ -n "$files" ] || { echo "check-secrets: nothing to scan ($mode)"; exit 0; }

status=0

banned="$(printf '%s\n' "$files" | grep -E "$banned_re" || true)"
if [ -n "$banned" ]; then
  {
    echo "check-secrets: secret-store files must never be committed:"
    printf '%s\n' "$banned" | sed 's/^/  /'
  } >&2
  status=1
fi

patterns=(
  'amzn1\.oa2-cs\.'                      # Login with Amazon client secret
  'Atz[ar]\|'                            # LWA access/refresh token
  'AKIA[0-9A-Z]{16}'                     # AWS access key id
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  '(secret|password|api_?key|token)[a-z_]*[[:space:]"'"'"']*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/_.-]{20,}'
)
# Lines that are clearly placeholders/templates, not real values.
allow_re='<[A-Za-z0-9_-]+>|\$\{|\$\(|example|placeholder|changeme|your[-_]|xxxx|dummy'

while IFS= read -r f; do
  [ -n "$f" ] || continue
  printf '%s\n' "$f" | grep -qE "$self_re" && continue
  if [ "$mode" = "--tracked" ]; then
    content="$(cat "$f" 2>/dev/null || true)"
  else
    content="$(git show ":$f" 2>/dev/null || true)"
  fi
  [ -n "$content" ] || continue
  for p in "${patterns[@]}"; do
    hits="$(printf '%s\n' "$content" | grep -inE -e "$p" | grep -ivE -e "$allow_re" || true)"
    if [ -n "$hits" ]; then
      {
        echo "check-secrets: possible credential in $f:"
        printf '%s\n' "$hits" | head -5 | sed 's/^/  /'
      } >&2
      status=1
    fi
  done
done <<< "$files"

if [ "$status" -ne 0 ]; then
  echo "check-secrets: FAILED — move real values to .dev.vars / wrangler secret, use placeholders in tracked files." >&2
else
  echo "check-secrets: clean ($mode)"
fi
exit "$status"
