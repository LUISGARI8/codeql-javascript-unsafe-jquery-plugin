# Rifa 07 · versión con cuentas y suscripción

Aplicación web para vender rifas, con:
- **Inicio de sesión** con correo y contraseña o con **Google** (Firebase Authentication), recuperación de contraseña y verificación de correo.
- **Suscripción mensual de $10.000 COP** con cobro automático por **Mercado Pago** (suscripciones / *preapproval*). Sin suscripción vigente, el usuario puede ver sus rifas pero no crear ni marcar números.
- **Cancelación** desde la cuenta: se detienen los cobros y el acceso sigue hasta el final del mes pagado.
- **Talonario** con números apartados o pagados, comprobante en imagen y envío por WhatsApp.
- **Bloqueo en el servidor**: las reglas de Firestore impiden modificar o liberar un número pagado, y que un usuario se active la suscripción a sí mismo.

## Estructura
| Archivo | Qué es |
|---|---|
| `public/index.html` | Pantallas de acceso, suscripción y talonario |
| `public/cuenta.js` | Inicio de sesión, Google, suscripción, cancelación y conexión con Firestore |
| `public/talonario.js`, `talonario.css` | El talonario (el mismo de `../talonario/`) |
| `public/terminos.html`, `privacidad.html` | **Borradores** de Términos de uso y Política de datos (revisar antes de publicar) |
| `functions/index.js` | Servidor: crea, verifica y cancela la suscripción; recibe el webhook de Mercado Pago |
| `firestore.rules` | Reglas de seguridad de la base de datos |
| `public/manifest.webmanifest`, `sw.js`, `icon-*.png` | App instalable en Android («Agregar a la pantalla principal») |

> El talonario se edita en `../talonario/talonario.html`; después ejecute `../talonario/build.sh` para copiarlo aquí.

## Puesta en marcha (una sola vez)

**Cuentas necesarias:** Google/Firebase (plan **Blaze**, de pago por uso, requerido para Cloud Functions; el uso pequeño suele quedar dentro de la capa gratuita) y **Mercado Pago Colombia** como vendedor.

1. **Firebase**
   1. Cree un proyecto en https://console.firebase.google.com y actívele el plan Blaze.
   2. *Authentication › Método de acceso*: active **Correo electrónico/contraseña** y **Google**. En *Configuración › Dominios autorizados* agregue su dominio si usa uno propio.
   3. *Firestore Database*: créela en modo producción (región `southamerica-east1` o `us-central1`).
2. **Mercado Pago**
   1. En https://www.mercadopago.com.co/developers cree una aplicación y copie el **Access Token de producción**. Para probar, use las credenciales y usuarios de prueba.
   2. Instale Firebase CLI (`npm i -g firebase-tools`), ejecute `firebase login`, copie `.firebaserc.example` a `.firebaserc` y ponga el ID de su proyecto.
   3. Guarde los secretos:
      ```bash
      firebase functions:secrets:set MP_ACCESS_TOKEN
      firebase functions:secrets:set MP_WEBHOOK_SECRET   # la «clave secreta» del webhook (paso 4)
      ```
3. **Publicar**
   ```bash
   cd functions && npm install && cd ..
   firebase deploy        # pide APP_URL: ponga https://SU-PROYECTO.web.app
   ```
4. **Webhook**: en Mercado Pago › *Tus integraciones › Webhooks*, configure la URL de la función `webhookMercadoPago` (aparece al terminar el deploy) y marque los eventos de **Planes y suscripciones**. Copie la clave secreta que muestra Mercado Pago en el secreto `MP_WEBHOOK_SECRET` y vuelva a ejecutar `firebase deploy --only functions`.

## Cómo funciona el cobro
1. El usuario toca **Suscribirme**: el servidor crea la suscripción en Mercado Pago a nombre de su correo y lo lleva a pagar.
2. Mercado Pago cobra $10.000 cada mes y avisa al webhook. El servidor **vuelve a consultar** la suscripción en Mercado Pago (no confía en el aviso) y guarda la fecha hasta la que el usuario tiene acceso: próximo cobro + 3 días de gracia.
3. Si el cobro falla o el usuario cancela, el acceso termina en esa fecha. El botón **Ya pagué** fuerza la consulta si el aviso se demora.

> Mercado Pago puede exigir que el correo con que se paga sea el mismo de la cuenta del usuario. Si un pago no se asocia, revise ese punto.

## Pruebas
Las reglas de Firestore se probaron con el emulador de Firebase: suscripción activa, vencida e inexistente; bloqueo de números pagados; estados inválidos; acceso a datos ajenos. Las funciones de Mercado Pago **no** se probaron contra Mercado Pago real: hágalo con credenciales de prueba antes de cobrar.

Para repetir la prueba de reglas:
```bash
npm i -D @firebase/rules-unit-testing@3.0.4 firebase@10.12.2
firebase emulators:exec --only firestore --project demo-talonario "node tests/reglas.test.js"
```
