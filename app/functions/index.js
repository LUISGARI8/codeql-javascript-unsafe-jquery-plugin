/**
 * Suscripción mensual del Rifa 07 con Mercado Pago (suscripciones / preapproval).
 *
 * Fuente de verdad: la suscripción se consulta SIEMPRE en la API de Mercado Pago con el
 * token del comercio; nunca se confía en lo que diga el navegador ni el cuerpo del webhook.
 * El acceso del usuario se guarda en usuarios/{uid}.suscripcion.vence (Timestamp), que las
 * reglas de Firestore exigen para crear o modificar rifas y números.
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET");
const APP_URL = defineString("APP_URL", { description: "URL pública de la app, p. ej. https://mi-proyecto.web.app" });

const PRECIO_COP = 10000;
const GRACIA_MS = 3 * 24 * 60 * 60 * 1000; // días extra tras la fecha de cobro, por si el cobro se demora
const ESTADO = { authorized: "activa", pending: "pendiente", paused: "pausada", cancelled: "cancelada" };
const opts = { secrets: [MP_ACCESS_TOKEN], region: "us-central1" };

async function mp(path, init = {}) {
  const res = await fetch("https://api.mercadopago.com" + path, {
    ...init,
    headers: { Authorization: "Bearer " + MP_ACCESS_TOKEN.value(), "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Mercado Pago error", { path, status: res.status, body });
    throw new Error("Mercado Pago respondió " + res.status + (body.message ? ": " + body.message : ""));
  }
  return body;
}

/** Guarda en Firestore el estado de una suscripción leída de la API de Mercado Pago. */
async function aplicar(pre) {
  const uid = pre.external_reference;
  if (!uid || typeof uid !== "string") return null;
  const ar = pre.auto_recurring || {};
  if (ar.currency_id !== "COP" || Number(ar.transaction_amount) < PRECIO_COP) {
    logger.warn("Suscripción con monto o moneda inesperados; se ignora", { id: pre.id, ar });
    return null;
  }
  const ref = db.doc("usuarios/" + uid);
  const actual = ((await ref.get()).get("suscripcion")) || {};
  let vence = actual.vence || null;
  if (pre.status === "authorized" && pre.next_payment_date) {
    const nuevo = Timestamp.fromMillis(Date.parse(pre.next_payment_date) + GRACIA_MS);
    if (!vence || nuevo.toMillis() > vence.toMillis()) vence = nuevo;
  }
  const suscripcion = {
    estado: ESTADO[pre.status] || pre.status,
    preapprovalId: pre.id,
    vence,
    proximoCobro: pre.next_payment_date || null,
    actualizada: FieldValue.serverTimestamp()
  };
  await ref.set({ suscripcion }, { merge: true });
  return suscripcion;
}

function requiereUsuario(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Inicia sesión primero.");
  return req.auth;
}

/** Crea la suscripción en Mercado Pago y devuelve el enlace de pago. */
exports.crearSuscripcion = onCall(opts, async (req) => {
  const { uid, token } = requiereUsuario(req);
  if (!token.email) throw new HttpsError("failed-precondition", "Tu cuenta no tiene correo electrónico.");
  const pre = await mp("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: "Rifa 07 - Plan mensual",
      external_reference: uid,
      payer_email: token.email,
      back_url: APP_URL.value().replace(/\/$/, "") + "/?suscripcion=volver",
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: PRECIO_COP, currency_id: "COP" },
      status: "pending"
    })
  });
  await db.doc("usuarios/" + uid).set({
    email: token.email,
    suscripcion: { estado: "pendiente", preapprovalId: pre.id, actualizada: FieldValue.serverTimestamp() }
  }, { merge: true });
  return { url: pre.init_point };
});

/** Vuelve a consultar en Mercado Pago la suscripción del usuario (botón «Ya pagué»). */
exports.sincronizarSuscripcion = onCall(opts, async (req) => {
  const { uid } = requiereUsuario(req);
  const id = (await db.doc("usuarios/" + uid).get()).get("suscripcion.preapprovalId");
  if (!id) return { activa: false, mensaje: "Aún no has iniciado una suscripción." };
  const pre = await mp("/preapproval/" + encodeURIComponent(id));
  if (pre.external_reference !== uid) throw new HttpsError("permission-denied", "La suscripción no corresponde a tu cuenta.");
  const s = await aplicar(pre);
  const activa = !!(s && s.vence && s.vence.toMillis() > Date.now());
  return { activa, estado: s && s.estado, mensaje: activa ? "" : "Mercado Pago aún no confirma el pago (estado: " + pre.status + "). Puede tardar unos minutos." };
});

/** Cancela los cobros futuros. El acceso sigue hasta la fecha ya pagada. */
exports.cancelarSuscripcion = onCall(opts, async (req) => {
  const { uid } = requiereUsuario(req);
  const id = (await db.doc("usuarios/" + uid).get()).get("suscripcion.preapprovalId");
  if (!id) throw new HttpsError("failed-precondition", "No tienes una suscripción activa.");
  const actual = await mp("/preapproval/" + encodeURIComponent(id));
  if (actual.external_reference !== uid) throw new HttpsError("permission-denied", "La suscripción no corresponde a tu cuenta.");
  const pre = await mp("/preapproval/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
  await aplicar(pre);
  return { ok: true };
});

/** Verifica la firma x-signature de Mercado Pago. */
function firmaValida(req, dataId) {
  const secret = MP_WEBHOOK_SECRET.value();
  const sig = req.get("x-signature") || "";
  const requestId = req.get("x-request-id") || "";
  const parts = Object.fromEntries(sig.split(",").map(p => p.trim().split("=")));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const esperado = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(esperado), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Webhook de Mercado Pago: configurar esta URL en «Tus integraciones > Webhooks». */
exports.webhookMercadoPago = onRequest({ ...opts, secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET] }, async (req, res) => {
  try {
    const tipo = req.body?.type || req.query.type || req.query.topic || "";
    const dataId = req.query["data.id"] || req.body?.data?.id || req.query.id;
    if (!dataId) return res.status(200).send("sin id");
    if (!firmaValida(req, dataId)) { logger.warn("Firma de webhook inválida", { tipo, dataId }); return res.status(401).send("firma inválida"); }

    let preapprovalId = null;
    if (/authorized_payment/.test(tipo)) {
      const pago = await mp("/authorized_payments/" + encodeURIComponent(dataId));
      preapprovalId = pago.preapproval_id;
    } else if (/preapproval/.test(tipo)) {
      preapprovalId = dataId;
    }
    if (preapprovalId) await aplicar(await mp("/preapproval/" + encodeURIComponent(preapprovalId)));
    res.status(200).send("ok");
  } catch (e) {
    logger.error("Error procesando webhook", e);
    res.status(500).send("error"); // Mercado Pago reintenta
  }
});
