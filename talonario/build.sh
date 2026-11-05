#!/usr/bin/env bash
# Genera, a partir de talonario.html (fuente única):
#   - talonario/index.html          versión que se abre directo en el navegador
#   - app/public/talonario.css/.js  el talonario dentro de la versión con cuentas
set -euo pipefail
cd "$(dirname "$0")"
SRC=talonario.html
{ printf '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="theme-color" content="#1f3b2f">\n<style>body{margin:0}</style>\n</head>\n<body>\n'; cat "$SRC"; printf '\n</body>\n</html>\n'; } > index.html
awk '/^<style>$/{f=1;next} /^<\/style>$/{f=0} f' "$SRC" > ../app/public/talonario.css
{ awk '/^<script>$/{f=1;next} /^const c = window.claude;$/{f=0} f' "$SRC"; printf 'window.Talonario = { start };\n})();\n'; } > ../app/public/talonario.js
sed -i 's|  m.textContent = s.online ? "Compartido en línea" : "Guardado en este dispositivo";|  m.textContent = s.label \|\| (s.online ? "Compartido en línea" : "Guardado en este dispositivo");|' ../app/public/talonario.js
node --check ../app/public/talonario.js
echo "Listo: index.html y app/public/talonario.{css,js} actualizados"
