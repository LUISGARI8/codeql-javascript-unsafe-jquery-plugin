#!/usr/bin/env bash
# Construye android/build/Rifa07.apk a partir de talonario/talonario.html.
# Requiere (Ubuntu): apt-get install -y aapt zipalign apksigner android-sdk-platform-23 dalvik-exchange
# Firma: KEYSTORE=/ruta/rifa07.keystore KS_PASS=clave ./build-apk.sh
#   Guarde siempre la MISMA llave: Android solo instala actualizaciones firmadas con ella.
set -euo pipefail
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk/platforms/android-23/android.jar
: "${KEYSTORE:?Indique KEYSTORE con la ruta de la llave de firma}"
: "${KS_PASS:?Indique KS_PASS con la clave de la llave}"
OUT=build
rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/assets"

# 1. Página del talonario con las fuentes incluidas (funciona sin internet)
python3 - "$OUT/assets/index.html" <<'PY'
import re, sys
src = open("../talonario/talonario.html", encoding="utf-8").read()
src = re.sub(r'<link rel="preconnect"[^>]*>\n?', "", src)
src = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', '<link rel="stylesheet" href="fonts/fonts.css">', src)
assert "fonts.googleapis.com" not in src
head = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="theme-color" content="#1f3b2f">\n<style>body{margin:0}</style>\n</head>\n<body>\n')
open(sys.argv[1], "w", encoding="utf-8").write(head + src + "\n</body>\n</html>\n")
PY
cp -r assets/fonts "$OUT/assets/"

# 2. Código Java -> dex
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$SDK" -d "$OUT/classes" src/com/rifa07/app/*.java
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"

# 3. Empaquetar, alinear y firmar
aapt package -f -0 arsc -M AndroidManifest.xml -S res -A "$OUT/assets" -I "$SDK" -F "$OUT/sin-firmar.apk"
(cd "$OUT" && aapt add sin-firmar.apk classes.dex)
zipalign -f -p 4 "$OUT/sin-firmar.apk" "$OUT/alineado.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass env:KS_PASS --out "$OUT/Rifa07.apk" "$OUT/alineado.apk"
apksigner verify "$OUT/Rifa07.apk"
rm -f "$OUT/sin-firmar.apk" "$OUT/alineado.apk"
echo "Listo: $(pwd)/$OUT/Rifa07.apk"
