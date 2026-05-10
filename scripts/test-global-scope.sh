#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "═══════════════════════════════════════════"
echo "  DevProfile — Teste de escopo global"
echo "═══════════════════════════════════════════"
echo ""

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — $result"
    FAIL=$((FAIL + 1))
  fi
}

# 1. Registro global em ~/.claude.json com type stdio
check "~/.claude.json com type: stdio" "$(python3 -c "
import json, os, sys
try:
    d = json.load(open(os.path.expanduser('~/.claude.json')))
    e = d.get('mcpServers', {}).get('devprofile', {})
    print('ok' if e.get('type') == 'stdio' else f'type={e.get(\"type\")}')
except Exception as ex:
    print(str(ex))
" 2>&1)"

# 2. Command é path absoluto sem ~
check "command sem ~ literal" "$(python3 -c "
import json, os
d = json.load(open(os.path.expanduser('~/.claude.json')))
cmd = d.get('mcpServers', {}).get('devprofile', {}).get('command', '')
print('ok' if cmd and '~' not in cmd else 'path com ~ ou ausente')
" 2>&1)"

# 3. args: ["server"]
check "args: [server]" "$(python3 -c "
import json, os
d = json.load(open(os.path.expanduser('~/.claude.json')))
args = d.get('mcpServers', {}).get('devprofile', {}).get('args', [])
print('ok' if args == ['server'] else f'args={args}')
" 2>&1)"

# 4. Slash command instalado
check "~/.claude/commands/devprofile.md" \
  "$([ -f "$HOME/.claude/commands/devprofile.md" ] && echo ok || echo 'não encontrado')"

# 5. Sem registros residuais em escopo de projeto (antes do teste)
# Only scan settings.json — .jsonl conversation logs may mention "devprofile" as text
check "sem registros em ~/.claude/projects/ (linha de base)" "$(
  FOUND=$(grep -rl '"devprofile"' "$HOME/.claude/projects/" --include="settings.json" 2>/dev/null | wc -l | tr -d ' ')
  [ "$FOUND" -eq 0 ] && echo ok || echo "$FOUND arquivo(s) com registro residual"
)"

# 6. Simula registro residual e valida migração via devprofile migrate-legacy
TEST_PROJECT=$(mktemp -d "$HOME/.claude/projects/test-XXXXXX")
cat > "$TEST_PROJECT/settings.json" <<'ENDJSON'
{
  "mcpServers": {
    "devprofile": {
      "type": "stdio",
      "command": "/tmp/devprofile",
      "args": ["server"]
    },
    "other-server": {
      "type": "stdio",
      "command": "/usr/local/bin/other",
      "args": []
    }
  }
}
ENDJSON

timeout 10 devprofile migrate-legacy > /dev/null 2>&1 || true

check "migração remove devprofile mas preserva other-server" "$(python3 -c "
import json
path = '$TEST_PROJECT/settings.json'
try:
    d = json.load(open(path))
    servers = d.get('mcpServers', {})
    has_devprofile = 'devprofile' in servers
    has_other = 'other-server' in servers
    if has_devprofile:
        print('devprofile não foi removido')
    elif not has_other:
        print('other-server foi removido incorretamente')
    else:
        print('ok')
except Exception as ex:
    print(str(ex))
" 2>&1)"

# Limpa projeto de teste
rm -rf "$TEST_PROJECT"

# 7. devprofile server responde em 7337
devprofile server > /dev/null 2>&1 &
SERVER_PID=$!
sleep 2
check "devprofile server responde em localhost:7337" \
  "$(curl -sf http://127.0.0.1:7337/health > /dev/null && echo ok || echo 'sem resposta')"
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null || true

# Resultado final
echo ""
echo "───────────────────────────────────────────"
echo "  Resultado: $PASS passou · $FAIL falhou"
echo "───────────────────────────────────────────"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
