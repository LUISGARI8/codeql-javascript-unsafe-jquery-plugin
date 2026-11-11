# Rifa 07 para Android (APK, sin internet)

App que se instala en el celular y funciona **sin internet**. Los datos quedan guardados en cada celular.
Se comparte el archivo `Rifa07.apk` (por WhatsApp, Drive o USB) y cada persona lo instala.

## Construir el APK
```bash
sudo apt-get install -y aapt zipalign apksigner android-sdk-platform-23 dalvik-exchange
KEYSTORE=/ruta/rifa07.keystore KS_PASS='la-clave' ./build-apk.sh
# Resultado: android/build/Rifa07.apk
```
- La página es `../talonario/talonario.html`: cualquier cambio allí entra en el APK al volver a construirlo.
- **La llave de firma (`rifa07.keystore`) no está en el repositorio a propósito.** Guárdela con su clave:
  sin ella no se pueden instalar actualizaciones encima de la app (habría que desinstalar y se perderían los datos).
- Para publicar una actualización, suba `android:versionCode` y `android:versionName` en `AndroidManifest.xml`.

## Qué hace el código nativo (`src/com/rifa07/app`)
- `MainActivity`: carga el talonario desde el APK, abre WhatsApp y enlaces fuera de la app,
  botón «atrás», galería para la foto del premio, y un puente `Rifa07Android` para compartir, guardar y copiar.
- `ImagenesProvider`: entrega a WhatsApp la imagen que se comparte (solo lectura).
