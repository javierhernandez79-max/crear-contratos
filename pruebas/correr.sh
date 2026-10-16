#!/usr/bin/env bash
# Corre todas las pruebas (o las que contengan el texto del primer argumento):
#   ./correr.sh            todas
#   ./correr.sh lote       solo las que tienen "lote" en el nombre
# Requiere Node 18+, Python 3 y Chromium de Playwright (npx playwright install chromium),
# o la variable CHROMIUM con la ruta de un Chromium ya instalado.
set -u
cd "$(dirname "$0")"
RAIZ=$(cd .. && pwd)
filtro="${1:-}"

[ -d node_modules ] || npm install --silent || exit 1

SRV=""
if ! curl -s -o /dev/null http://localhost:5173/; then
  python3 -m http.server 5173 --directory "$RAIZ" >/dev/null 2>&1 &
  SRV=$!
  trap '[ -n "$SRV" ] && kill $SRV 2>/dev/null' EXIT
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://localhost:5173/ && break; sleep 0.5; done
fi

# Carpeta de trabajo: datos ficticios + material del despacho (si existe). Las pruebas corren desde salida/t
rm -rf salida && mkdir -p salida/t salida/shots
cp -R datos/. salida/
[ -d privado ] && cp -R privado/. salida/ 2>/dev/null

pasan=0; fallan=(); sinmat=()
for f in *-e2e.mjs *-unit.mjs; do
  [ -n "$filtro" ] && [[ "$f" != *"$filtro"* ]] && continue
  falta=""
  for p in $(grep -oE "marco/out/[a-z-]+\.json|fmt/formatos-cps\.json|sug/u-marco-servicios\.json|cti/original\.docx|p1-dl\.xlsx|p1/entrega" "$f" | sort -u); do
    [ -e "salida/$p" ] || falta="$p"
  done
  if [ -n "$falta" ]; then sinmat+=("$f ($falta)"); printf 'SIN MATERIAL  %s\n' "$f"; continue; fi
  log="salida/${f%.mjs}.log"
  (cd salida/t && timeout 300 node ../../correr-una.mjs "../../$f" ..) >"$log" 2>&1
  rc=$?
  if [ $rc -ne 0 ] || grep -qE "^FAIL|ERRORES: |errors: \[ *'|^Error: " "$log"; then
    fallan+=("$f"); printf 'FALLA         %s\n' "$f"
  else
    pasan=$((pasan + 1)); printf 'ok            %s\n' "$f"
  fi
done

echo
echo "Pasan: $pasan · Fallan: ${#fallan[@]} · Sin material del despacho: ${#sinmat[@]}"
for f in "${fallan[@]}"; do echo "  FALLA  $f  → salida/${f%.mjs}.log"; done
for f in "${sinmat[@]}"; do echo "  SIN MATERIAL  $f"; done
[ ${#fallan[@]} -eq 0 ]
