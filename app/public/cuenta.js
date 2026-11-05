(function(){
"use strict";
const $ = s => document.querySelector(s);
const SCREENS = ["#authScreen", "#payScreen", "#appScreen", "#loadScreen"];
function show(id){ SCREENS.forEach(s => $(s).hidden = s !== id); }
function msg(el, text){ const e = $(el); e.textContent = text || ""; e.hidden = !text; }
function fechaLarga(ms){ return new Date(ms).toLocaleDateString("es-CO", { dateStyle: "long" }); }

/* ---------- App instalable en Android ---------- */
if ("serviceWorker" in navigator && location.protocol === "https:"){
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
let installEvt = null;
const yaDescartado = () => { try { return localStorage.getItem("talonario-instalar-no") === "1"; } catch(e){ return false; } };
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); installEvt = e;
  if (!yaDescartado()) $("#installBar").hidden = false;
});
$("#installBtn").onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null; $("#installBar").hidden = true;
};
$("#installNo").onclick = () => { $("#installBar").hidden = true; try { localStorage.setItem("talonario-instalar-no", "1"); } catch(e){} };
window.addEventListener("appinstalled", () => { $("#installBar").hidden = true; });

if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length){
  show("#authScreen");
  msg("#authErr", "La aplicación no está conectada a Firebase. Publícala con Firebase Hosting (ver README).");
  document.querySelectorAll("#authScreen button").forEach(b => b.disabled = true);
  return;
}

const auth = firebase.auth();
const fs = firebase.firestore();
const fn = firebase.app().functions("us-central1");
auth.languageCode = "es";

/* ---------- Mensajes de error en español ---------- */
const ERRORES = {
  "auth/invalid-email": "El correo no es válido.",
  "auth/missing-password": "Escribe tu contraseña.",
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "No hay una cuenta con ese correo.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Inicia sesión.",
  "auth/weak-password": "La contraseña debe tener mínimo 8 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e intenta de nuevo.",
  "auth/network-request-failed": "Sin conexión. Revisa tu internet.",
  "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
  "auth/account-exists-with-different-credential": "Ese correo ya está registrado con contraseña. Inicia sesión con tu correo."
};
const errTxt = e => ERRORES[e && e.code] || (e && e.message) || "Algo salió mal. Intenta de nuevo.";

/* ---------- Panel de acceso ---------- */
let modo = "login";
function setModo(m){
  modo = m;
  const reg = m === "registro";
  $("#tabLogin").setAttribute("aria-selected", String(!reg));
  $("#tabRegistro").setAttribute("aria-selected", String(reg));
  $("#authTitle").textContent = reg ? "Crea tu cuenta" : "Inicia sesión";
  $("#authSubmit").textContent = reg ? "Crear cuenta" : "Iniciar sesión";
  $("#nombreField").hidden = $("#pass2Field").hidden = $("#termsField").hidden = !reg;
  $("#olvideBtn").hidden = reg;
  $("#aPass").autocomplete = reg ? "new-password" : "current-password";
  msg("#authErr"); msg("#authOk");
}
$("#tabLogin").onclick = () => setModo("login");
$("#tabRegistro").onclick = () => setModo("registro");

$("#authForm").addEventListener("submit", async e => {
  e.preventDefault(); msg("#authErr"); msg("#authOk");
  const email = $("#aEmail").value.trim(), pass = $("#aPass").value;
  if (!email) return msg("#authErr", "Escribe tu correo.");
  if (pass.length < 8) return msg("#authErr", "La contraseña debe tener mínimo 8 caracteres.");
  const btn = $("#authSubmit"); btn.disabled = true;
  try {
    if (modo === "registro"){
      if (pass !== $("#aPass2").value) throw { message: "Las contraseñas no coinciden." };
      if (!$("#aTerms").checked) throw { message: "Debes aceptar los Términos de uso y la Política de privacidad." };
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      const nombre = $("#aNombre").value.trim();
      if (nombre) await cred.user.updateProfile({ displayName: nombre });
      cred.user.sendEmailVerification().catch(() => {});
    } else {
      await auth.signInWithEmailAndPassword(email, pass);
    }
  } catch(err){ msg("#authErr", errTxt(err)); }
  btn.disabled = false;
});

$("#olvideBtn").onclick = async () => {
  msg("#authErr"); msg("#authOk");
  const email = $("#aEmail").value.trim();
  if (!email) return msg("#authErr", "Escribe tu correo arriba y vuelve a tocar «Olvidé mi contraseña».");
  try { await auth.sendPasswordResetEmail(email); msg("#authOk", "Te enviamos un correo para crear una nueva contraseña. Revisa también la carpeta de spam."); }
  catch(err){ msg("#authErr", errTxt(err)); }
};

$("#googleBtn").onclick = async () => {
  msg("#authErr");
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try { await auth.signInWithPopup(provider); }
  catch(err){
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") return auth.signInWithRedirect(provider);
    msg("#authErr", errTxt(err));
  }
};
auth.getRedirectResult().catch(err => msg("#authErr", errTxt(err)));

document.addEventListener("click", e => { if (e.target.closest("[data-salir]")) auth.signOut().then(() => location.reload()); });

/* ---------- Suscripción ---------- */
const ESTADOS = { pendiente: "Tu pago está pendiente. Si ya pagaste en Mercado Pago, toca «Ya pagué».", pausada: "Tu suscripción está pausada en Mercado Pago.", cancelada: "Tu suscripción fue cancelada." };
let user = null, unsubUser = null, talonarioIniciado = false, venceMs = 0, estadoSub = "";

async function llamar(nombre, data){
  const r = await fn.httpsCallable(nombre)(data || {});
  return r.data;
}

$("#suscribirBtn").onclick = async () => {
  msg("#payErr"); const b = $("#suscribirBtn"); b.disabled = true; b.textContent = "Abriendo Mercado Pago…";
  try { const { url } = await llamar("crearSuscripcion"); location.href = url; }
  catch(err){ msg("#payErr", "No se pudo iniciar el pago: " + (err.message || "intenta de nuevo")); b.disabled = false; b.textContent = "Suscribirme con Mercado Pago"; }
};
$("#verificarBtn").onclick = verificar;
async function verificar(){
  msg("#payErr"); const b = $("#verificarBtn"); b.disabled = true;
  try { const r = await llamar("sincronizarSuscripcion"); if (!r.activa) msg("#payErr", r.mensaje || "Todavía no vemos tu pago. Puede tardar unos minutos."); }
  catch(err){ msg("#payErr", err.message || "No se pudo verificar."); }
  b.disabled = false;
}

function pintarCuenta(){
  const nombre = user.displayName || user.email;
  const plan = estadoSub === "cancelada" ? `Acceso hasta el <b>${fechaLarga(venceMs)}</b> (cancelada)` : `Plan activo · próximo cobro cerca del <b>${fechaLarga(venceMs - 3*864e5)}</b>`;
  $("#account").innerHTML = "";
  const s1 = document.createElement("span"); s1.textContent = nombre;
  const s2 = document.createElement("span"); s2.innerHTML = plan;
  $("#account").append(s1, s2);
  if (estadoSub !== "cancelada"){
    const c = document.createElement("button"); c.type = "button"; c.className = "ghost"; c.textContent = "Cancelar suscripción";
    c.onclick = () => { $("#cancelHasta").textContent = fechaLarga(venceMs); msg("#cancelErr"); $("#cancelBox").hidden = false; };
    $("#account").append(c);
  }
  const s = document.createElement("button"); s.type = "button"; s.className = "ghost"; s.textContent = "Cerrar sesión"; s.dataset.salir = "";
  $("#account").append(s);
}
$("#cancelNo").onclick = () => $("#cancelBox").hidden = true;
$("#cancelSi").onclick = async () => {
  const b = $("#cancelSi"); b.disabled = true; msg("#cancelErr");
  try { await llamar("cancelarSuscripcion"); $("#cancelBox").hidden = true; }
  catch(err){ msg("#cancelErr", err.message || "No se pudo cancelar. Intenta de nuevo."); }
  b.disabled = false;
};

/* Almacén del talonario en Firestore, dentro de la cuenta del usuario */
function firestoreStore(uid){
  const rifas = fs.collection("usuarios").doc(uid).collection("rifas");
  const numRef = (id, n) => rifas.doc(id).collection("numeros").doc(n);
  return {
    online: true, label: "Guardado en tu cuenta",
    watchRifas(cb, onErr){ return rifas.onSnapshot(s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })), s), onErr); },
    async saveRifa(r){ const { id, ...rest } = r; await rifas.doc(id).set(rest); },
    watchNumeros(id, cb, onErr){ return rifas.doc(id).collection("numeros").onSnapshot(s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); cb(m, s); }, onErr); },
    async getNumero(id, n){ const s = await numRef(id, n).get(); return s.exists ? s.data() : null; },
    async lock(){ return true; },
    async setNumero(id, n, data){
      await fs.runTransaction(async t => {
        const s = await t.get(numRef(id, n));
        if (s.exists && s.data().estado === "pagado") throw new Error("Este número ya fue pagado por " + s.data().cliente + ". No se puede volver a vender.");
        t.set(numRef(id, n), data);
      });
    },
    async delNumero(id, n){
      await fs.runTransaction(async t => {
        const s = await t.get(numRef(id, n));
        if (s.exists && s.data().estado === "pagado") throw new Error("Un número pagado no se puede liberar.");
        t.delete(numRef(id, n));
      });
    }
  };
}

auth.onAuthStateChanged(u => {
  if (unsubUser){ unsubUser(); unsubUser = null; }
  user = u;
  if (!u){ if (talonarioIniciado) return location.reload(); setModo(modo); return show("#authScreen"); }
  show("#loadScreen");
  $("#payHola").textContent = "Hola" + (u.displayName ? ", " + u.displayName.split(" ")[0] : "") + ". Suscríbete para empezar a vender tus rifas.";
  $("#payEmail").textContent = u.email || "";
  const volviendo = new URLSearchParams(location.search).has("suscripcion");
  if (volviendo){ history.replaceState(null, "", location.pathname + location.hash); }
  let primera = true;
  unsubUser = fs.collection("usuarios").doc(u.uid).onSnapshot(snap => {
    const sub = (snap.exists && snap.data().suscripcion) || {};
    estadoSub = sub.estado || "";
    venceMs = sub.vence && sub.vence.toMillis ? sub.vence.toMillis() : 0;
    const activa = venceMs > Date.now();
    if (activa){
      show("#appScreen"); pintarCuenta();
      if (!talonarioIniciado){ talonarioIniciado = true; window.Talonario.start(firestoreStore(u.uid)); }
    } else {
      if (talonarioIniciado) return location.reload();
      show("#payScreen");
      const t = ESTADOS[estadoSub]; $("#payEstado").textContent = t || ""; $("#payEstado").hidden = !t;
      if (primera && volviendo) verificar();
    }
    primera = false;
  }, err => { show("#payScreen"); msg("#payErr", "No se pudo leer tu cuenta: " + err.message); });
});
})();
