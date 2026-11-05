(function(){
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = v => "$" + Number(v||0).toLocaleString("es-CO");
const digits = s => String(s||"").replace(/\D/g,"");
function waPhone(p){ let d = digits(p); if (d.length === 10 && d[0] === "3") d = "57" + d; return d; }
function pad(n, total){ return String(n).padStart(String(total-1).length, "0"); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function fechaHoy(){ return new Date().toLocaleString("es-CO",{dateStyle:"medium",timeStyle:"short"}); }

/* ---------- Almacenamiento: base compartida (db) o este dispositivo ---------- */
function localStore(){
  const K = "talonario-v1";
  let state = { rifas:{}, numeros:{} };
  try { const raw = localStorage.getItem(K); if (raw) state = JSON.parse(raw); } catch(e){}
  const subsR = new Set(), subsN = new Map();
  const save = () => { try { localStorage.setItem(K, JSON.stringify(state)); } catch(e){} };
  const emitR = () => subsR.forEach(f => f(Object.values(state.rifas)));
  const emitN = id => (subsN.get(id)||new Set()).forEach(f => f({...(state.numeros[id]||{})}));
  return {
    online:false,
    watchRifas(cb){ subsR.add(cb); setTimeout(()=>cb(Object.values(state.rifas))); return ()=>subsR.delete(cb); },
    async saveRifa(r){ state.rifas[r.id] = r; save(); emitR(); },
    watchNumeros(id, cb){ if(!subsN.has(id)) subsN.set(id,new Set()); subsN.get(id).add(cb); setTimeout(()=>cb({...(state.numeros[id]||{})})); return ()=>subsN.get(id).delete(cb); },
    async getNumero(id, n){ return (state.numeros[id]||{})[n] || null; },
    async lock(){ return true; },
    async setNumero(id, n, data){ state.numeros[id] = state.numeros[id]||{}; state.numeros[id][n] = data; save(); emitN(id); },
    async delNumero(id, n){ if(state.numeros[id]) delete state.numeros[id][n]; save(); emitN(id); }
  };
}
function dbStore(db){
  const holder = uid();
  return {
    online:true,
    watchRifas(cb, onErr){
      return db.collection("rifas").onSnapshot(s => cb(s.docs.map(d => ({id:d.id, ...d.data()})), s), onErr);
    },
    async saveRifa(r){ const {id, ...rest} = r; await db.doc("rifas/"+id).set(rest); },
    watchNumeros(id, cb, onErr){
      return db.collection("rifas/"+id+"/numeros").onSnapshot(s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); cb(m, s); }, onErr);
    },
    async getNumero(id, n){ const s = await db.doc("rifas/"+id+"/numeros/"+n).get(); return s.exists ? s.data() : null; },
    async lock(id, n){ const r = await db.doc("rifas/"+id+"/numeros/"+n).acquire({holder, ttlMs:5000}); return r.acquired; },
    async setNumero(id, n, data){ await db.doc("rifas/"+id+"/numeros/"+n).set(data); },
    async delNumero(id, n){ await db.doc("rifas/"+id+"/numeros/"+n).delete(); }
  };
}

/* ---------- Estado de la vista ---------- */
let store = null, rifas = [], numeros = {}, activa = null, unsubN = null, filtro = "todos", busca = "";
let loadTimer = null, rifasLoaded = false;

function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(()=>t.hidden = true, 2600); }

function remember(id){ try { localStorage.setItem("talonario-activa", id); } catch(e){} }
function recalled(){ try { return localStorage.getItem("talonario-activa"); } catch(e){ return null; } }

function setRifas(list){
  rifasLoaded = true;
  rifas = list.slice().sort((a,b) => (b.creada||0) - (a.creada||0));
  const sel = $("#rifaSel");
  if (!rifas.length){ sel.innerHTML = '<option value="">Sin rifas todavía</option>'; }
  else sel.innerHTML = rifas.map(r => `<option value="${esc(r.id)}">${esc(r.nombre)}</option>`).join("");
  const want = activa?.id || (location.hash.startsWith("#r-") ? location.hash.slice(3) : null) || recalled();
  const found = rifas.find(r => r.id === want) || rifas[0] || null;
  selectRifa(found ? found.id : null);
}

function selectRifa(id){
  const r = rifas.find(x => x.id === id) || null;
  const changed = (r?.id) !== (activa?.id);
  activa = r;
  if (r){ $("#rifaSel").value = r.id; remember(r.id); }
  if (changed){
    if (unsubN) unsubN();
    unsubN = null; numeros = {};
    if (r){
      unsubN = store.watchNumeros(r.id, m => { numeros = m; render(); refreshSheet(); }, e => toast("No se pudieron leer los números: " + (e?.message||"")));
    }
  }
  render();
}

function counts(){
  const total = activa.cantidad;
  let paid = 0, res = 0;
  Object.values(numeros).forEach(v => { if (v.estado === "pagado") paid++; else if (v.estado === "apartado") res++; });
  return { total, paid, res, libres: total - paid - res };
}

function render(){
  const main = $("#main");
  if (!rifasLoaded) return;
  if (!activa){
    main.innerHTML = `<div class="empty"><h2>Crea tu primera rifa</h2>
      <p>Escribe el nombre de la rifa, el premio, el valor de cada número y tu Nequi. Después marcas cada número vendido y le envías el comprobante al cliente por WhatsApp.</p>
      <button class="primary" type="button" data-act="nueva">+ Nueva rifa</button></div>`;
    return;
  }
  const c = counts(), r = activa;
  let cells = "";
  for (let i = 0; i < r.cantidad; i++){
    const k = pad(i, r.cantidad), v = numeros[k];
    const st = v?.estado === "pagado" ? "paid" : v?.estado === "apartado" ? "res" : "free";
    if (filtro !== "todos" && filtro !== st) continue;
    if (busca && !k.includes(busca) && !(v && String(v.cliente||"").toLowerCase().includes(busca.toLowerCase()))) continue;
    const label = st === "paid" ? `Número ${k}, pagado` : st === "res" ? `Número ${k}, apartado` : `Número ${k}, libre`;
    const tip = v ? ` title="${esc(v.cliente)}"` : "";
    cells += `<button type="button" class="n ${st==='free'?'':st}" data-n="${k}" aria-label="${label}${v ? ", " + esc(v.cliente) : ""}"${tip}>${k}${st==='paid'?'<span class="tag">PAGO</span>':st==='res'?'<span class="tag">APART.</span>':''}</button>`;
  }
  main.innerHTML = `
  <section class="rifa">
    <div class="rifa-main">
      <span class="lbl">Rifa</span>
      <h2>${esc(r.nombre)}</h2>
      <div class="meta">
        <span>Premio: <b>${esc(r.premio)}</b></span>
        ${r.loteria ? `<span>Juega con: <b>${esc(r.loteria)}</b></span>` : ""}
        ${r.fecha ? `<span>Fecha: <b>${esc(r.fecha)}</b></span>` : ""}
        <span>Nequi: <b>${esc(r.nequi)}</b>${r.titular ? " · " + esc(r.titular) : ""}</span>
      </div>
    </div>
    <div class="rifa-stub"><span class="lbl">Valor del número</span><span class="big">${money(r.valor)}</span></div>
  </section>
  <section class="summary" aria-label="Resumen de ventas">
    <div class="progress-head">
      <span><b class="big">${c.paid}</b> de ${c.total} números pagados</span>
      <span><b class="big">${money(c.paid * r.valor)}</b> recaudado${c.res ? ` · <span class="pend">${money(c.res * r.valor)} por cobrar</span>` : ""}</span>
    </div>
    <div class="progress" role="progressbar" aria-label="Avance de ventas" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${c.paid}">
      <span class="p-paid" style="width:${c.paid / c.total * 100}%"></span><span class="p-res" style="width:${c.res / c.total * 100}%"></span>
    </div>
    <div class="legend" role="group" aria-label="Ver números por estado (toca para filtrar)">
      ${[["free","Libres",c.libres],["res","Apartados",c.res],["paid","Pagados",c.paid]].map(([k,l,n]) => `<button type="button" class="lg ${k}" data-f="${k}" aria-pressed="${filtro===k}"><span class="sw" aria-hidden="true"></span><span>${l}</span><b>${n}</b></button>`).join("")}
    </div>
  </section>
  ${c.paid + c.res === 0 ? `<ol class="guide" aria-label="Cómo vender un número">
    <li><span><b>Toca un número libre</b> en el talonario.</span></li>
    <li><span><b>Escribe el cliente</b> y dinos si ya pagó.</span></li>
    <li><span><b>Envíale el comprobante</b> por WhatsApp.</span></li>
  </ol>` : ""}
  <div class="search">
    <input id="busca" type="search" placeholder="Buscar número o nombre del cliente" value="${esc(busca)}" aria-label="Buscar número o nombre del cliente">
    ${filtro !== "todos" ? `<button type="button" class="ghost" data-f="todos">Ver todos</button>` : ""}
  </div>
  <section class="grid" aria-label="Números de la rifa">${cells || `<p class="note">No hay números ${filtro === "free" ? "libres" : filtro === "res" ? "apartados" : filtro === "paid" ? "pagados" : ""} ${busca ? "que coincidan con «" + esc(busca) + "»" : ""}.</p>`}</section>
  <p class="note">Toca cualquier número para venderlo, cobrarlo o reenviar su comprobante. Los pagados quedan bloqueados y nadie los puede volver a vender.</p>`;
  const b = $("#busca");
  if (render._focusBusca){ b.focus(); b.setSelectionRange(b.value.length, b.value.length); render._focusBusca = false; }
}

/* ---------- Mensajes ---------- */
function codigo(r, k){ return "RF-" + r.id.slice(-4).toUpperCase() + "-" + k + "-" + Date.now().toString(36).slice(-4).toUpperCase(); }
function msgPago(r, k, cliente){
  return `Hola ${cliente||""}! Apartaste el número *${k}* de la rifa *${r.nombre}*.\n` +
    `Premio: ${r.premio}\nValor: ${money(r.valor)}\n\n` +
    `Paga por Nequi al *${r.nequi}*${r.titular ? " (" + r.titular + ")" : ""} y envíame la captura del pago para confirmar tu número.`;
}
function msgRecibo(r, k, v){
  return `*COMPROBANTE DE PAGO*\nRifa: ${r.nombre}\nNúmero: *${k}*\nCliente: ${v.cliente}\nValor pagado: ${money(r.valor)}\n` +
    `Medio: Nequi ${r.nequi}${v.ref ? "\nReferencia Nequi: " + v.ref : ""}\nFecha de pago: ${v.pagadoEn}\nCódigo: ${v.codigo}\n` +
    `Premio: ${r.premio}${r.loteria ? "\nJuega con: " + r.loteria : ""}${r.fecha ? "\nFecha del sorteo: " + r.fecha : ""}\n\n` +
    `Tu número ${k} quedó registrado y bloqueado a tu nombre. ¡Mucha suerte!`;
}
/* ---------- Imagen del comprobante ---------- */
const RC = { paper:"#efe7d2", stock:"#fffaf0", ink:"#1f3b2f", soft:"#5d7468", rule:"#e4dac2", ochre:"#c98a12", ochreBg:"#fbedc9", paid:"#1f6b45", white:"#fffaf0" };
const FD = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif', FB = '"Figtree", system-ui, sans-serif', FM = '"Courier Prime", "Courier New", monospace';
async function fontsReady(){
  try { await Promise.all(['800 100px "Big Shoulders Display"','700 40px "Figtree"','600 40px "Figtree"','400 40px "Figtree"','700 40px "Courier Prime"'].map(f => document.fonts.load(f))); } catch(e){}
}
function wrapText(ctx, text, maxW){
  const words = String(text).split(/\s+/), lines = []; let line = "";
  for (const w of words){ const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function rr(ctx, x, y, w, h, r){ ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function spacing(ctx, px){ if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }
async function reciboPNG(r, k, v){
  await fontsReady();
  const W = 1080, M = 56, CW = W - 2*M, PX = 72, X = M + PX, XR = M + CW - PX;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `800 80px ${FD}`;
  const title = wrapText(meas, String(r.nombre).toUpperCase(), CW - 2*PX).slice(0, 3);
  const rows = [["Cliente", v.cliente], ["Valor pagado", money(r.valor)], ["Pagado por Nequi a", r.nequi + (r.titular ? " · " + r.titular : "")],
    ["Referencia Nequi", v.ref], ["Fecha de pago", v.pagadoEn], ["Premio", r.premio], ["Juega con", r.loteria], ["Fecha del sorteo", r.fecha]].filter(x => x[1]);
  meas.font = `700 34px ${FB}`;
  const rowsL = rows.map(([l, val]) => [l, wrapText(meas, val, CW - 2*PX - 330).slice(0, 3)]);
  const headH = 120 + title.length * 84 + 40, numH = 330;
  const rowsH = rowsL.reduce((s, [, ls]) => s + 46 + ls.length * 44, 0) + 24;
  const stubH = 270, cardH = headH + numH + rowsH + 40 + stubH, H = cardH + 2*M;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); ctx.textBaseline = "alphabetic";
  ctx.fillStyle = RC.paper; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.shadowColor = "rgba(31,59,47,.18)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  rr(ctx, M, M, CW, cardH, 30); ctx.fillStyle = RC.stock; ctx.fill(); ctx.restore();
  ctx.save(); rr(ctx, M, M, CW, cardH, 30); ctx.clip();
  /* encabezado */
  ctx.fillStyle = RC.ink; ctx.fillRect(M, M, CW, headH);
  let y = M + 82;
  ctx.fillStyle = RC.ochre; ctx.font = `700 28px ${FB}`; spacing(ctx, 5); ctx.textAlign = "left";
  ctx.fillText("COMPROBANTE DE PAGO", X, y); spacing(ctx, 0);
  ctx.fillStyle = RC.white; ctx.font = `800 80px ${FD}`;
  title.forEach(line => { y += 84; ctx.fillText(line, X, y); });
  /* número */
  const ny = M + headH;
  ctx.fillStyle = RC.soft; ctx.font = `700 28px ${FB}`; spacing(ctx, 5); ctx.fillText("NÚMERO", X, ny + 78); spacing(ctx, 0);
  ctx.fillStyle = RC.paid; ctx.font = `800 240px ${FD}`; ctx.fillText(k, X - 8, ny + 296);
  /* sello */
  ctx.save(); ctx.translate(XR - 165, ny + 180); ctx.rotate(-0.17);
  ctx.strokeStyle = RC.paid; ctx.lineWidth = 8; rr(ctx, -165, -72, 330, 144, 18); ctx.stroke();
  ctx.lineWidth = 2.5; rr(ctx, -150, -57, 300, 114, 12); ctx.stroke();
  ctx.fillStyle = RC.paid; ctx.font = `800 92px ${FD}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; spacing(ctx, 4);
  ctx.fillText("PAGADO", 4, 6); spacing(ctx, 0); ctx.restore();
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  /* filas */
  y = ny + numH;
  rowsL.forEach(([label, lines]) => {
    ctx.strokeStyle = RC.rule; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, y); ctx.lineTo(XR, y); ctx.stroke();
    ctx.fillStyle = RC.soft; ctx.font = `600 27px ${FB}`; ctx.textAlign = "left"; ctx.fillText(label, X, y + 56);
    ctx.fillStyle = RC.ink; ctx.font = `700 34px ${FB}`; ctx.textAlign = "right";
    lines.forEach((ln, i) => ctx.fillText(ln, XR, y + 56 + i*44));
    y += 46 + lines.length * 44;
  });
  ctx.textAlign = "left";
  /* talón desprendible */
  const yP = M + headH + numH + rowsH + 40;
  ctx.fillStyle = RC.ochreBg; ctx.fillRect(M, yP, CW, cardH + M - yP);
  ctx.strokeStyle = RC.ochre; ctx.lineWidth = 3; ctx.setLineDash([16, 12]);
  ctx.beginPath(); ctx.moveTo(M + 40, yP); ctx.lineTo(M + CW - 40, yP); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = RC.soft; ctx.font = `700 26px ${FB}`; spacing(ctx, 5); ctx.fillText("CÓDIGO DE VERIFICACIÓN", X, yP + 72); spacing(ctx, 0);
  ctx.fillStyle = RC.ink; ctx.font = `700 60px ${FM}`; ctx.fillText(v.codigo || "", X, yP + 146);
  ctx.fillStyle = RC.soft; ctx.font = `400 28px ${FB}`;
  wrapText(ctx, `El número ${k} quedó registrado y bloqueado a nombre de ${v.cliente}. ¡Mucha suerte!`, CW - 2*PX).slice(0, 2)
    .forEach((ln, i) => ctx.fillText(ln, X, yP + 204 + i*38));
  ctx.restore();
  /* muescas de perforación */
  ctx.fillStyle = RC.paper;
  [M, M + CW].forEach(cx => { ctx.beginPath(); ctx.arc(cx, yP, 26, 0, Math.PI*2); ctx.fill(); });
  return new Promise(res => cv.toBlob(res, "image/png"));
}
async function descargar(){
  const blob = sheet.blob, name = sheet.fileName;
  try {
    const dl = window.claude?.use ? await window.claude.use("downloads") : null;
    if (dl){ await dl.save({ filename: name, data: blob }); toast("Imagen guardada"); return; }
  } catch(e){ if (e?.code === "declined") return; }
  try {
    const a = document.createElement("a"); a.href = sheet.imgUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    toast("Imagen descargada");
  } catch(e){ toast("Mantenga presionada la imagen para guardarla"); }
}
function waLink(phone, text){ return "https://wa.me/" + waPhone(phone) + "?text=" + encodeURIComponent(text); }

/* ---------- Hoja de detalle ---------- */
let sheet = null; // {type:'num', k} | {type:'nueva'}
function openSheet(s){
  if (!sheet){ try { history.pushState({ hoja: 1 }, ""); } catch(e){} }
  sheet = s; $("#overlay").hidden = false; document.body.classList.add("lock"); drawSheet();
}
function closeSheet(fromBack){
  if (!sheet) return;
  sheet = null; $("#overlay").hidden = true; document.body.classList.remove("lock");
  if (!fromBack && history.state && history.state.hoja){ try { history.back(); } catch(e){} }
}
function vibrar(p){ try { navigator.vibrate && navigator.vibrate(p); } catch(e){} }
function refreshSheet(){ if (sheet?.type === "num" && !sheet.busy) drawSheet(true); }

function drawSheet(soft){
  const body = $("#sheetBody"), title = $("#sheetTitle");
  if (sheet.type === "nueva"){
    title.textContent = "Nueva rifa";
    body.innerHTML = `
    <form id="fRifa" class="sheet-body" style="padding:0">
      <div class="field"><label for="rNombre">Nombre de la rifa</label><input id="rNombre" required maxlength="80" placeholder="Rifa pro-fondos Junta de Acción Comunal"></div>
      <div class="field"><label for="rPremio">Premio</label><input id="rPremio" required maxlength="120" placeholder="Moto Honda CB 125"></div>
      <div class="row">
        <div class="field"><label for="rValor">Valor por número (COP)</label><input id="rValor" required inputmode="numeric" placeholder="10000"></div>
        <div class="field"><label for="rCant">Números del talonario</label><select id="rCant"><option value="100">100 (00 a 99)</option><option value="1000">1000 (000 a 999)</option></select></div>
      </div>
      <div class="row">
        <div class="field"><label for="rNequi">Número Nequi</label><input id="rNequi" required inputmode="tel" placeholder="300 123 4567"></div>
        <div class="field"><label for="rTitular">Titular del Nequi</label><input id="rTitular" maxlength="60" placeholder="María Pérez"></div>
      </div>
      <div class="row">
        <div class="field"><label for="rLoteria">Juega con (lotería)</label><input id="rLoteria" maxlength="60" placeholder="Lotería de Medellín, 2 últimas cifras"></div>
        <div class="field"><label for="rFecha">Fecha del sorteo</label><input id="rFecha" type="date"></div>
      </div>
      <p id="rErr" class="err" hidden></p>
      <div class="actions"><button type="button" class="ghost" data-act="cerrar">Cancelar</button><button class="primary" type="submit">Crear talonario</button></div>
    </form>`;
    $("#rNombre").focus();
    return;
  }
  const r = activa, k = sheet.k, v = numeros[k];
  title.textContent = "Número " + k;
  const st = v?.estado || "libre";
  if (soft && sheet.lastSt === st && st !== "libre") return;
  if (soft && st === "libre" && sheet.lastSt === "libre") return;
  sheet.lastSt = st;
  if (st === "pagado"){
    const text = msgRecibo(r, k, v);
    body.innerHTML = `
      <div><span class="pill paid">Pagado · bloqueado</span></div>
      <div class="step">Envíale el comprobante a ${esc(v.cliente)} · ${esc(fmtTel(v.telefono))}</div>
      <button type="button" class="primary full big-btn" data-act="compartir" disabled>Enviar imagen por WhatsApp</button>
      <p class="note">Se abre el menú de compartir del celular: escoge <b>WhatsApp</b> y el chat del cliente.</p>
      <div class="recibo-img" id="rcBox"><span class="note">Preparando la imagen del comprobante…</span></div>
      <div class="actions">
        <a class="btn" href="${esc(waLink(v.telefono, text))}" target="_blank" rel="noopener">Enviar en texto</a>
        <button type="button" data-act="descargar" disabled>Guardar imagen</button>
      </div>
      <button type="button" class="ghost full" data-act="otro">Vender otro número a ${esc(String(v.cliente).split(" ")[0])}</button>
      <details class="txt"><summary>Ver comprobante en texto</summary>
        <div class="recibo"><span class="sello">PAGADO</span>${esc(text.replace(/\*/g,""))}</div>
        <button type="button" class="ghost" data-act="copiar">Copiar texto</button>
      </details>
      <p class="note">Este número quedó bloqueado: ya no se puede apartar, vender ni liberar.</p>`;
    sheet.copyText = text;
    const want = sheet;
    reciboPNG(r, k, v).then(blob => {
      if (sheet !== want || !blob) return;
      sheet.blob = blob; sheet.fileName = "comprobante-rifa-numero-" + k + ".png";
      if (sheet.imgUrl) URL.revokeObjectURL(sheet.imgUrl);
      sheet.imgUrl = URL.createObjectURL(blob);
      const box = $("#rcBox");
      box.innerHTML = `<img src="${sheet.imgUrl}" alt="Comprobante de pago del número ${esc(k)} de la rifa ${esc(r.nombre)}">`;
      document.querySelectorAll('[data-act="compartir"],[data-act="descargar"]').forEach(b => b.disabled = false);
    }).catch(() => { const box = $("#rcBox"); if (box) box.innerHTML = '<p class="err">No se pudo crear la imagen. Use el comprobante en texto.</p>'; });
    return;
  }
  if (st === "apartado"){
    body.innerHTML = `
      <div><span class="pill res">Apartado · falta el pago</span></div>
      <p style="margin:0"><b>${esc(v.cliente)}</b> · WhatsApp ${esc(fmtTel(v.telefono))}</p>
      <div class="step">Paso 1 · Pídele el pago</div>
      <a class="btn wa" href="${esc(waLink(v.telefono, msgPago(r,k,v.cliente)))}" target="_blank" rel="noopener">Enviar mi Nequi por WhatsApp</a>
      <div class="step">Paso 2 · Cuando te pague</div>
      <div class="field"><label for="nRef">Referencia del pago Nequi (opcional)</label><input id="nRef" maxlength="40" placeholder="M1234567"></div>
      <p id="nErr" class="err" hidden></p>
      <button type="button" class="primary full" data-act="pagar">Confirmar pago y crear comprobante</button>
      <button type="button" class="linkbtn" data-act="liberar-pre">El cliente no va a pagar: liberar este número</button>
      <div id="libConfirm" class="confirm-sm" hidden>
        <p>¿Liberar el número ${esc(k)}? Quedará libre para otro cliente.</p>
        <div class="actions"><button type="button" class="ghost" data-act="liberar-no">No, dejarlo apartado</button><button type="button" class="warn" data-act="liberar">Sí, liberar</button></div>
      </div>`;
    return;
  }
  const pago = sheet.pago !== false;
  body.innerHTML = `
    <div><span class="pill">Libre</span></div>
    ${lastCliente ? `<div class="recent">¿Mismo cliente? <button type="button" data-act="usar-ultimo">${esc(lastCliente.cliente)} · ${esc(fmtTel(lastCliente.telefono))}</button></div>` : ""}
    <div class="field"><label for="nCliente">Nombre del cliente</label><input id="nCliente" maxlength="60" autocomplete="off" placeholder="Carlos Gómez"></div>
    <div class="field"><label for="nTel">WhatsApp del cliente</label><input id="nTel" inputmode="tel" autocomplete="off" placeholder="310 555 1234"></div>
    <div class="field"><span class="flabel" id="pagoLbl">¿El cliente ya te pagó?</span>
      <div class="seg" role="group" aria-labelledby="pagoLbl">
        <button type="button" data-pago="si" aria-pressed="${pago}">Sí, ya pagó</button>
        <button type="button" data-pago="no" aria-pressed="${!pago}">Todavía no</button>
      </div>
    </div>
    <div class="field" id="refField"${pago ? "" : " hidden"}><label for="nRef">Referencia del pago Nequi (opcional)</label><input id="nRef" maxlength="40" placeholder="M1234567"></div>
    <p id="nErr" class="err" hidden></p>
    <button type="button" class="primary full" id="nGo" data-act="${pago ? "pagar" : "apartar"}">${pago ? "Marcar pagado y crear comprobante" : "Apartar número"}</button>
    <p class="note" id="nHint">${pago ? "El número queda bloqueado a nombre del cliente y se crea el comprobante para enviarle." : "El número queda reservado. Después le envías tu Nequi por WhatsApp y confirmas cuando pague."}</p>`;
  $("#nCliente").focus();
}
function setPago(si){
  sheet.pago = si;
  document.querySelectorAll("[data-pago]").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.pago === "si") === si)));
  $("#refField").hidden = !si;
  const go = $("#nGo"); go.dataset.act = si ? "pagar" : "apartar";
  go.textContent = si ? "Marcar pagado y crear comprobante" : "Apartar número";
  $("#nHint").textContent = si ? "El número queda bloqueado a nombre del cliente y se crea el comprobante para enviarle." : "El número queda reservado. Después le envías tu Nequi por WhatsApp y confirmas cuando pague.";
}
function fmtTel(t){ const d = digits(t); return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3") : String(t || ""); }
let lastCliente = null;

function showErr(id, msg){ const e = $(id); if (e){ e.textContent = msg; e.hidden = !msg; } }

async function cambiarNumero(kind){
  const r = activa, k = sheet.k, cur = numeros[k];
  let cliente = cur?.cliente, telefono = cur?.telefono;
  if (!cur){
    cliente = ($("#nCliente")?.value || "").trim();
    telefono = ($("#nTel")?.value || "").trim();
    if (!cliente) return showErr("#nErr", "Escribe el nombre del cliente.");
    if (digits(telefono).length < 10) return showErr("#nErr", "Escribe el WhatsApp del cliente con 10 dígitos, por ejemplo 310 555 1234.");
  }
  const ref = ($("#nRef")?.value || "").trim();
  sheet.busy = true;
  const btns = document.querySelectorAll("#sheetBody button"); btns.forEach(b => b.disabled = true);
  try {
    if (!(await store.lock(r.id, k))) throw new Error("Otra persona está marcando este número en este momento. Intenta en unos segundos.");
    const now = await store.getNumero(r.id, k);
    if (now?.estado === "pagado") throw new Error("Este número ya fue pagado por " + now.cliente + ". No se puede volver a vender.");
    if (kind === "liberar"){
      await store.delNumero(r.id, k); toast("Número " + k + " liberado");
    } else if (kind === "apartar"){
      if (now) throw new Error("Este número ya está apartado por " + now.cliente + ".");
      await store.setNumero(r.id, k, { estado:"apartado", cliente, telefono, apartadoEn: fechaHoy() });
      lastCliente = { cliente, telefono };
      vibrar(30);
      toast("Número " + k + " apartado para " + cliente);
    } else {
      if (!cur && now) throw new Error("Este número acaba de ser apartado por " + now.cliente + ".");
      const data = { estado:"pagado", cliente, telefono, ref, pagadoEn: fechaHoy(), codigo: codigo(r, k) };
      await store.setNumero(r.id, k, data);
      numeros[k] = data;
      lastCliente = { cliente, telefono };
      vibrar([40, 60, 40]);
      toast("Número " + k + " pagado y bloqueado");
    }
    sheet.busy = false; sheet.lastSt = null;
    if (kind === "liberar") closeSheet(); else drawSheet();
    render();
  } catch(e){
    sheet.busy = false;
    btns.forEach(b => b.disabled = false);
    showErr("#nErr", e?.message || "No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
  }
}

async function crearRifa(ev){
  ev.preventDefault();
  const g = id => ($(id).value || "").trim();
  const valor = Number(digits(g("#rValor")));
  if (!valor) return showErr("#rErr", "Escribe el valor de cada número en pesos, por ejemplo 10000.");
  if (digits(g("#rNequi")).length < 10) return showErr("#rErr", "El número Nequi debe tener 10 dígitos.");
  const fecha = g("#rFecha");
  const r = { id: uid(), nombre: g("#rNombre"), premio: g("#rPremio"), valor, cantidad: Number($("#rCant").value),
    nequi: g("#rNequi"), titular: g("#rTitular"), loteria: g("#rLoteria"),
    fecha: fecha ? new Date(fecha + "T12:00").toLocaleDateString("es-CO",{dateStyle:"long"}) : "", creada: Date.now() };
  try {
    await store.saveRifa(r);
    activa = null; remember(r.id);
    if (!rifas.find(x => x.id === r.id)) setRifas([...rifas, r]);
    selectRifa(r.id);
    closeSheet(); toast("Talonario creado");
  } catch(e){ showErr("#rErr", "No se pudo crear la rifa: " + (e?.message||"revisa tu conexión")); }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button, [data-act]");
  if (!t) { if (e.target.id === "overlay") closeSheet(); return; }
  if (t.dataset.n){ openSheet({type:"num", k:t.dataset.n}); return; }
  if (t.dataset.f){ filtro = (t.dataset.f === filtro && t.dataset.f !== "todos") ? "todos" : t.dataset.f; render(); return; }
  if (t.dataset.pago) return setPago(t.dataset.pago === "si");
  const a = t.dataset.act;
  if (t.id === "nuevaBtn" || a === "nueva") return openSheet({type:"nueva"});
  if (t.id === "closeBtn" || a === "cerrar") return closeSheet();
  if (a === "usar-ultimo" && lastCliente){ $("#nCliente").value = lastCliente.cliente; $("#nTel").value = fmtTel(lastCliente.telefono); return; }
  if (a === "liberar-pre"){ $("#libConfirm").hidden = false; t.hidden = true; return; }
  if (a === "liberar-no"){ $("#libConfirm").hidden = true; $('[data-act="liberar-pre"]').hidden = false; return; }
  if (a === "otro"){ closeSheet(); toast("Toca el siguiente número para " + (lastCliente?.cliente || "el cliente")); return; }
  if (a === "apartar" || a === "pagar" || a === "liberar") return cambiarNumero(a);
  if (a === "compartir" && sheet?.blob){
    const file = new File([sheet.blob], sheet.fileName, {type:"image/png"});
    try {
      if (navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({files:[file], text:"Comprobante de pago · Rifa " + activa.nombre + " · Número " + sheet.k});
        return;
      }
    } catch(err){ if (err && err.name === "AbortError") return; }
    toast("Este navegador no deja compartir la imagen. Descárguela y adjúntela en WhatsApp.");
    return descargar();
  }
  if (a === "descargar" && sheet?.blob) return descargar();
  if (a === "copiar"){
    try { await navigator.clipboard.writeText(sheet.copyText); toast("Comprobante copiado"); }
    catch(_){ const sel = getSelection(), range = document.createRange(); range.selectNodeContents($(".recibo")); sel.removeAllRanges(); sel.addRange(range); toast("Texto seleccionado: cópialo"); }
  }
});
document.addEventListener("submit", e => { if (e.target.id === "fRifa") crearRifa(e); });
document.addEventListener("input", e => {
  const el = e.target;
  if (el.id === "busca"){ busca = el.value.trim(); render._focusBusca = true; render(); return; }
  if (el.id === "nTel" || el.id === "rNequi"){
    const d = digits(el.value).slice(0, 10);
    el.value = d.length > 6 ? d.replace(/(\d{3})(\d{3})(\d*)/, "$1 $2 $3") : d.length > 3 ? d.replace(/(\d{3})(\d*)/, "$1 $2") : d;
  }
  if (el.id === "rValor"){ const d = digits(el.value).slice(0, 9); el.value = d ? Number(d).toLocaleString("es-CO") : ""; }
});
/* Botón «atrás» de Android: cierra la ventana abierta en vez de salir de la app */
window.addEventListener("popstate", () => { if (sheet) closeSheet(true); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet) closeSheet(); });
$("#rifaSel").addEventListener("change", e => selectRifa(e.target.value));

/* ---------- Arranque ---------- */
function start(s){
  store = s;
  const m = $("#mode");
  m.textContent = s.label || (s.online ? "Compartido en línea" : "Guardado en este dispositivo");
  m.classList.toggle("online", s.online);
  loadTimer = setTimeout(() => { if (!rifasLoaded){ $("#main").innerHTML = '<div class="empty"><h2>Sin conexión todavía</h2><p>No se pudo leer el talonario. Revisa tu conexión; la página seguirá intentando.</p></div>'; } }, 10000);
  s.watchRifas((list, snap) => { if (!snap || !snap.metadata?.fromCache) clearTimeout(loadTimer); setRifas(list); },
    err => { clearTimeout(loadTimer); $("#main").innerHTML = '<div class="empty"><h2>No se pudo abrir el talonario</h2><p>' + esc(err?.message || "Error desconocido") + '</p></div>'; });
}
window.Talonario = { start };
})();
