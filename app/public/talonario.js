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

/* ---------- Navegación: Inicio (#) ↔ talonario de una rifa (#r-<id>) ---------- */
let navDesdeInicio = false;
function setRifas(list){
  rifasLoaded = true;
  rifas = list.slice().sort((a,b) => (b.creada||0) - (a.creada||0));
  route();
}
function route(){
  const id = location.hash.startsWith("#r-") ? location.hash.slice(3) : null;
  selectRifa(id && rifas.find(r => r.id === id) ? id : null);
}
function abrirRifa(id){ navDesdeInicio = !activa; location.hash = "r-" + id; }
function irInicio(){
  if (navDesdeInicio){ navDesdeInicio = false; history.back(); }
  else location.hash = "";
}
function cerrarYLuego(fn){
  if (sheet && history.state && history.state.hoja){
    let hecho = false;
    const seguir = () => { if (hecho) return; hecho = true; window.removeEventListener("popstate", seguir); setTimeout(fn, 0); };
    window.addEventListener("popstate", seguir);
    setTimeout(seguir, 500);
    closeSheet();
  } else { closeSheet(); fn(); }
}

function selectRifa(id){
  const r = rifas.find(x => x.id === id) || null;
  const changed = (r?.id) !== (activa?.id);
  activa = r;
  $("#inicioBtn").hidden = !r;
  $("#nuevaBtn").hidden = !!r;
  $("#barTitle").textContent = r ? r.nombre : "Tus rifas";
  if (changed){
    if (unsubN) unsubN();
    unsubN = null; numeros = {}; filtro = "todos"; busca = "";
    if (r){
      unsubN = store.watchNumeros(r.id, m => { numeros = m; render(); refreshSheet(); syncConteo(); }, e => toast("No se pudieron leer los números: " + (e?.message||"")));
    }
    window.scrollTo(0, 0);
  }
  render();
}

/* Guarda en la rifa cuántos números van pagados/apartados, para mostrarlo en Inicio */
let syncPend = false;
function syncConteo(){
  if (!activa || activa.estado === "finalizada" || syncPend) return;
  const c = counts(), cur = activa.conteo || {};
  if (cur.pagados === c.paid && cur.apartados === c.res) return;
  syncPend = true;
  store.saveRifa({ ...activa, conteo: { pagados: c.paid, apartados: c.res } }).catch(() => {}).finally(() => { syncPend = false; });
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
  if (!activa) return renderInicio();
  const c = counts(), r = activa, fin = r.estado === "finalizada", g = r.ganador || {};
  let cells = "";
  for (let i = 0; i < r.cantidad; i++){
    const k = pad(i, r.cantidad), v = numeros[k];
    const st = v?.estado === "pagado" ? "paid" : v?.estado === "apartado" ? "res" : "free";
    if (filtro !== "todos" && filtro !== st) continue;
    if (busca && !k.includes(busca) && !(v && String(v.cliente||"").toLowerCase().includes(busca.toLowerCase()))) continue;
    const label = st === "paid" ? `Número ${k}, pagado` : st === "res" ? `Número ${k}, apartado` : `Número ${k}, libre`;
    const tip = v ? ` title="${esc(v.cliente)}"` : "";
    cells += `<button type="button" class="n ${st==='free'?'':st}${fin && g.numero === k ? ' win' : ''}" data-n="${k}" aria-label="${label}${v ? ", " + esc(v.cliente) : ""}"${tip}>${k}${st==='paid'?'<span class="tag">PAGO</span>':st==='res'?'<span class="tag">APART.</span>':''}</button>`;
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
  ${fin ? `<section class="resultado" aria-label="Resultado del sorteo">
    <div class="res-num"><span class="lbl">Número ganador</span><b>${esc(g.numero)}</b></div>
    <div class="res-txt">
      ${g.sinGanador
        ? `<p><b>Ese número no se vendió.</b> La rifa terminó sin ganador.</p>`
        : `<p>Ganador: <b>${esc(g.cliente)}</b> · ${esc(fmtTel(g.telefono))}</p>
           <button type="button" class="primary" data-act="ver-ganador">Mensaje al ganador</button>`}
      <p class="note">Rifa realizada${r.finalizadaTxt ? " el " + esc(r.finalizadaTxt) : ""}. Ya no se pueden vender ni cambiar números.</p>
    </div>
  </section>` : `<button type="button" class="win-btn" data-act="ganador"><span>¿Ya jugó la lotería?</span><b>Registrar número ganador</b></button>`}
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
  ${c.paid + c.res === 0 && !fin ? `<ol class="guide" aria-label="Cómo vender un número">
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

/* ---------- Inicio: rifas en venta, rifas realizadas e historial ---------- */
let limpiarAbierto = false;
function renderInicio(){
  const main = $("#main");
  if (!rifas.length){
    main.innerHTML = `<div class="empty"><h2>Crea tu primera rifa</h2>
      <p>Escribe el nombre de la rifa, el premio, el valor de cada número y tu Nequi. Después marcas cada número vendido y le envías el comprobante al cliente por WhatsApp.</p>
      <button class="primary" type="button" data-act="nueva">+ Nueva rifa</button></div>`;
    return;
  }
  const enVenta = rifas.filter(r => r.estado !== "finalizada");
  const hechas = rifas.filter(r => r.estado === "finalizada" && !r.archivada);
  const todas = rifas.filter(r => r.estado === "finalizada").sort((a,b) => (b.finalizadaEn||0) - (a.finalizadaEn||0));
  const totalHist = todas.reduce((s, r) => s + (r.resumen?.recaudado || 0), 0);
  const ganadorTxt = r => r.ganador?.sinGanador ? `Cayó el <b>${esc(r.ganador.numero)}</b>: no se vendió` : `Ganó el <b>${esc(r.ganador?.numero)}</b> · ${esc(r.ganador?.cliente)}`;
  const cardVenta = r => {
    const cn = r.conteo || {}, p = cn.pagados || 0, a = cn.apartados || 0;
    return `<button type="button" class="rcard" data-open="${esc(r.id)}">
      <span class="rc-top"><b class="rc-name">${esc(r.nombre)}</b><span class="pill">En venta</span></span>
      <span class="rc-meta">${esc(r.premio)}${r.fecha ? " · Sorteo: " + esc(r.fecha) : ""}</span>
      <span class="progress"><span class="p-paid" style="width:${p / r.cantidad * 100}%"></span><span class="p-res" style="width:${a / r.cantidad * 100}%"></span></span>
      <span class="rc-foot"><span>${p} de ${r.cantidad} pagados${a ? " · " + a + " apartados" : ""}</span><b>${money(p * r.valor)}</b></span>
    </button>`;
  };
  const cardHecha = r => `<button type="button" class="rcard done" data-open="${esc(r.id)}">
      <span class="rc-top"><b class="rc-name">${esc(r.nombre)}</b><span class="pill paid">Realizada</span></span>
      <span class="rc-win">${ganadorTxt(r)}</span>
      <span class="rc-foot"><span>${r.fecha ? "Sorteo: " + esc(r.fecha) : "Realizada " + esc(r.finalizadaTxt || "")}</span><b>${money(r.resumen?.recaudado)}</b></span>
    </button>`;
  main.innerHTML = `
  <section class="home-sec" aria-labelledby="hVenta">
    <div class="sec-head"><h2 id="hVenta">En venta</h2><span class="count">${enVenta.length}</span></div>
    ${enVenta.length ? `<div class="cards">${enVenta.map(cardVenta).join("")}</div>`
      : `<p class="note">No tienes rifas en venta. Toca <b>+ Nueva rifa</b> para empezar otra.</p>`}
  </section>
  <section class="home-sec" aria-labelledby="hHechas">
    <div class="sec-head"><h2 id="hHechas">Rifas realizadas</h2>
      ${hechas.length ? `<button type="button" class="ghost" data-act="limpiar-pre">Limpiar pantalla</button>` : ""}</div>
    <div class="confirm-sm" id="limpiarBox"${limpiarAbierto && hechas.length ? "" : " hidden"}>
      <p>¿Quitar ${hechas.length === 1 ? "la rifa realizada" : "las " + hechas.length + " rifas realizadas"} de esta pantalla? No se borran: quedan guardadas en el <b>historial</b>.</p>
      <div class="actions"><button type="button" class="ghost" data-act="limpiar-no">No</button><button type="button" class="warn" data-act="limpiar-ok">Sí, limpiar pantalla</button></div>
    </div>
    ${hechas.length ? `<div class="cards">${hechas.map(cardHecha).join("")}</div>`
      : `<p class="note">${todas.length ? "Pantalla limpia. Tus rifas anteriores están en el historial." : "Cuando registres el número ganador de una rifa, aparecerá aquí."}</p>`}
  </section>
  ${todas.length ? `<section class="home-sec" aria-labelledby="hHist">
    <details class="hist"${todas.length && !hechas.length ? " open" : ""}>
      <summary><h2 id="hHist">Historial de rifas</h2><span class="count">${todas.length}</span></summary>
      <div class="tablewrap"><table>
        <thead><tr><th>Rifa</th><th>Sorteo</th><th>Ganador</th><th class="num">Recaudado</th><th></th></tr></thead>
        <tbody>${todas.map(r => `<tr>
          <td>${esc(r.nombre)}</td>
          <td>${esc(r.fecha || r.finalizadaTxt || "")}</td>
          <td><b class="tnum">${esc(r.ganador?.numero)}</b> ${r.ganador?.sinGanador ? "Sin ganador" : esc(r.ganador?.cliente)}</td>
          <td class="num">${money(r.resumen?.recaudado)}</td>
          <td><button type="button" class="ghost sm" data-open="${esc(r.id)}">Ver</button></td>
        </tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">Total recaudado en ${todas.length} ${todas.length === 1 ? "rifa" : "rifas"}</td><td class="num">${money(totalHist)}</td><td></td></tr></tfoot>
      </table></div>
    </details>
  </section>` : ""}`;
}

async function limpiarPantalla(){
  const hechas = rifas.filter(r => r.estado === "finalizada" && !r.archivada);
  const b = $('[data-act="limpiar-ok"]'); if (b) b.disabled = true;
  try {
    for (const r of hechas) await store.saveRifa({ ...r, archivada: true });
    limpiarAbierto = false;
    toast(hechas.length === 1 ? "Listo: la rifa pasó al historial" : "Listo: " + hechas.length + " rifas pasaron al historial");
  } catch(e){ toast("No se pudo limpiar: " + (e?.message || "revisa tu conexión")); if (b) b.disabled = false; }
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
function reciboPNG(r, k, v){
  return boletaPNG({ etiqueta: "COMPROBANTE DE PAGO", titulo: r.nombre, k, sello: "PAGADO", color: RC.paid,
    rows: [["Cliente", v.cliente], ["Valor pagado", money(r.valor)], ["Pagado por Nequi a", r.nequi + (r.titular ? " · " + r.titular : "")],
      ["Referencia Nequi", v.ref], ["Fecha de pago", v.pagadoEn], ["Premio", r.premio], ["Juega con", r.loteria], ["Fecha del sorteo", r.fecha]],
    codigo: v.codigo, pie: `El número ${k} quedó registrado y bloqueado a nombre de ${v.cliente}. ¡Mucha suerte!` });
}
function ganadorPNG(r){
  const g = r.ganador;
  return boletaPNG({ etiqueta: "RESULTADO DEL SORTEO", titulo: r.nombre, k: g.numero, numLabel: "NÚMERO GANADOR", sello: "GANADOR", color: RC.ochre,
    rows: [["Ganador", g.cliente], ["Premio", r.premio], ["Juega con", r.loteria], ["Fecha del sorteo", r.fecha]],
    codigo: g.codigo, pie: `¡Felicitaciones, ${g.cliente}! Comunícate con el organizador para recibir tu premio.` });
}
async function boletaPNG(o){
  await fontsReady();
  const k = o.k, v = { codigo: o.codigo };
  const W = 1080, M = 56, CW = W - 2*M, PX = 72, X = M + PX, XR = M + CW - PX;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `800 80px ${FD}`;
  const title = wrapText(meas, String(o.titulo).toUpperCase(), CW - 2*PX).slice(0, 3);
  const rows = o.rows.filter(x => x[1]);
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
  ctx.fillText(o.etiqueta, X, y); spacing(ctx, 0);
  ctx.fillStyle = RC.white; ctx.font = `800 80px ${FD}`;
  title.forEach(line => { y += 84; ctx.fillText(line, X, y); });
  /* número */
  const ny = M + headH;
  ctx.fillStyle = RC.soft; ctx.font = `700 28px ${FB}`; spacing(ctx, 5); ctx.fillText(o.numLabel || "NÚMERO", X, ny + 78); spacing(ctx, 0);
  ctx.fillStyle = o.color === RC.ochre ? RC.ink : o.color; ctx.font = `800 240px ${FD}`; ctx.fillText(k, X - 8, ny + 296);
  /* sello */
  ctx.save(); ctx.translate(XR - 165, ny + 180); ctx.rotate(-0.17);
  ctx.strokeStyle = o.color; ctx.lineWidth = 8; rr(ctx, -165, -72, 330, 144, 18); ctx.stroke();
  ctx.lineWidth = 2.5; rr(ctx, -150, -57, 300, 114, 12); ctx.stroke();
  ctx.fillStyle = o.color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; spacing(ctx, 4);
  let fs = 92; ctx.font = `800 ${fs}px ${FD}`;
  while (ctx.measureText(o.sello).width > 270 && fs > 40){ fs -= 4; ctx.font = `800 ${fs}px ${FD}`; }
  ctx.fillText(o.sello, 4, 6); spacing(ctx, 0); ctx.restore();
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
  wrapText(ctx, o.pie, CW - 2*PX).slice(0, 2)
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
function msgGanador(r){
  const g = r.ganador;
  return `🎉 ¡Felicitaciones, ${g.cliente}!\n\nTu número *${g.numero}* es el *GANADOR* de la rifa *${r.nombre}*.\n\n` +
    `Premio: ${r.premio}\n${r.loteria ? "Jugó con: " + r.loteria + "\n" : ""}${r.fecha ? "Fecha del sorteo: " + r.fecha + "\n" : ""}` +
    `${g.codigo ? "Código de tu boleta: " + g.codigo + "\n" : ""}\nEscríbeme por aquí para coordinar la entrega de tu premio.`;
}
function anuncioResultado(r){
  const g = r.ganador, partes = String(g.cliente || "").trim().split(/\s+/);
  const nombreCorto = partes[0] + (partes[1] ? " " + partes[1][0] + "." : "");
  return `*RESULTADO · ${r.nombre}*\n${r.loteria ? "Jugó con " + r.loteria + (r.fecha ? " del " + r.fecha : "") + "\n" : ""}` +
    `Número ganador: *${g.numero}*\n` + (g.sinGanador ? "Ese número no se vendió: la rifa queda sin ganador.\n" : `Ganador: ${nombreCorto}\n`) +
    `¡Gracias a todos por participar!`;
}
/* Muestra una imagen generada en el recuadro #rcBox y activa sus botones */
function cargarImagen(promesa, fileName, alt, shareText){
  const want = sheet;
  promesa.then(blob => {
    if (sheet !== want || !blob) return;
    sheet.blob = blob; sheet.fileName = fileName; sheet.shareText = shareText;
    if (sheet.imgUrl) URL.revokeObjectURL(sheet.imgUrl);
    sheet.imgUrl = URL.createObjectURL(blob);
    $("#rcBox").innerHTML = `<img src="${sheet.imgUrl}" alt="${esc(alt)}">`;
    document.querySelectorAll('[data-act="compartir"],[data-act="descargar"]').forEach(b => b.disabled = false);
  }).catch(() => { const box = $("#rcBox"); if (box) box.innerHTML = '<p class="err">No se pudo crear la imagen.</p>'; });
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
  if (sheet.type === "ganador") return drawGanador();
  if (sheet.type === "resultado") return drawResultado();
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
      ${r.estado === "finalizada" ? "" : `<button type="button" class="ghost full" data-act="otro">Vender otro número a ${esc(String(v.cliente).split(" ")[0])}</button>`}
      <details class="txt"><summary>Ver comprobante en texto</summary>
        <div class="recibo"><span class="sello">PAGADO</span>${esc(text.replace(/\*/g,""))}</div>
        <button type="button" class="ghost" data-act="copiar">Copiar texto</button>
      </details>
      <p class="note">Este número quedó bloqueado: ya no se puede apartar, vender ni liberar.</p>`;
    sheet.copyText = text;
    cargarImagen(reciboPNG(r, k, v), "comprobante-rifa-numero-" + k + ".png", `Comprobante de pago del número ${k} de la rifa ${r.nombre}`,
      "Comprobante de pago · Rifa " + r.nombre + " · Número " + k);
    return;
  }
  if (r.estado === "finalizada"){
    body.innerHTML = `<div><span class="pill">${st === "apartado" ? "Apartado sin pago" : "No vendido"}</span></div>
      <p style="margin:0">Esta rifa ya se realizó. Ya no se pueden vender, apartar ni liberar números.</p>
      ${v ? `<p class="note">Estaba apartado por ${esc(v.cliente)} · ${esc(fmtTel(v.telefono))}</p>` : ""}`;
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
/* ---------- Número ganador ---------- */
function drawGanador(){
  const r = activa, dig = String(r.cantidad - 1).length;
  $("#sheetTitle").textContent = "Registrar número ganador";
  $("#sheetBody").innerHTML = `
    <p style="margin:0">Escribe las <b>${dig} cifras</b> del número que cayó${r.loteria ? " en <b>" + esc(r.loteria) + "</b>" : ""}${r.fecha ? " el " + esc(r.fecha) : ""}.</p>
    <input id="gNum" class="gnum" inputmode="numeric" maxlength="${dig}" autocomplete="off" placeholder="${"0".repeat(dig)}" aria-label="Número ganador">
    <div id="gPrev" aria-live="polite"></div>
    <div id="gConfirm" class="confirm-sm" hidden>
      <p id="gConfirmTxt"></p>
      <div class="actions"><button type="button" class="ghost" data-act="g-no">Corregir</button><button type="button" class="primary" data-act="g-ok">Sí, cerrar la rifa</button></div>
    </div>
    <p id="gErr" class="err" hidden></p>`;
  $("#gNum").focus();
}
function previewGanador(){
  const r = activa, dig = String(r.cantidad - 1).length, k = digits($("#gNum").value).slice(0, dig);
  $("#gNum").value = k; $("#gConfirm").hidden = true; showErr("#gErr", "");
  const box = $("#gPrev");
  if (k.length < dig){ box.innerHTML = ""; return; }
  const v = numeros[k];
  if (v?.estado === "pagado"){
    box.innerHTML = `<div class="gcard ok"><span class="lbl">Lo compró</span><b>${esc(v.cliente)}</b><span>WhatsApp ${esc(fmtTel(v.telefono))} · pagado</span></div>
      <button type="button" class="primary full big-btn" data-act="g-pre">Confirmar ganador</button>`;
  } else {
    box.innerHTML = `<div class="gcard no"><b>${v ? "El " + esc(k) + " estaba apartado por " + esc(v.cliente) + ", pero no lo pagó." : "El " + esc(k) + " no se vendió."}</b>
      <span>La rifa quedaría sin ganador. Aplica lo que anunciaste a tus compradores para este caso.</span></div>
      <button type="button" class="warn full" data-act="g-pre">Cerrar la rifa sin ganador</button>`;
  }
}
async function finalizarRifa(){
  const r = activa, dig = String(r.cantidad - 1).length, k = digits($("#gNum").value).slice(0, dig);
  const v = numeros[k], pagado = v?.estado === "pagado", c = counts();
  const b = $('[data-act="g-ok"]'); b.disabled = true;
  const r2 = { ...r, estado: "finalizada", finalizadaEn: Date.now(), finalizadaTxt: fechaHoy(),
    ganador: pagado ? { numero: k, cliente: v.cliente, telefono: v.telefono, codigo: v.codigo || "" } : { numero: k, sinGanador: true },
    resumen: { pagados: c.paid, recaudado: c.paid * r.valor }, conteo: { pagados: c.paid, apartados: c.res } };
  try {
    await store.saveRifa(r2);
    activa = r2; render();
    vibrar([60, 80, 60, 80, 120]);
    if (pagado){ sheet = { type: "resultado" }; drawSheet(); }
    else { closeSheet(); toast("Rifa cerrada sin ganador"); }
  } catch(e){ b.disabled = false; showErr("#gErr", "No se pudo cerrar la rifa: " + (e?.message || "revisa tu conexión")); }
}
function drawResultado(){
  const r = activa, g = r.ganador;
  $("#sheetTitle").textContent = "¡Tenemos ganador!";
  $("#sheetBody").innerHTML = `
    <div class="win-head"><span class="lbl">Número ganador</span><b>${esc(g.numero)}</b><span>${esc(g.cliente)} · ${esc(fmtTel(g.telefono))}</span></div>
    <div class="step">Avísale al ganador</div>
    <a class="btn wa full big-btn" href="${esc(waLink(g.telefono, msgGanador(r)))}" target="_blank" rel="noopener">Enviar mensaje al ganador por WhatsApp</a>
    <p class="note">Se abre WhatsApp con el chat del ganador y el mensaje ya escrito. Solo toca <b>Enviar</b>.</p>
    <div class="recibo-img" id="rcBox"><span class="note">Preparando la imagen del ganador…</span></div>
    <div class="actions">
      <button type="button" data-act="compartir" disabled>Enviar imagen</button>
      <button type="button" data-act="descargar" disabled>Guardar imagen</button>
    </div>
    <div class="step">Cuéntales a todos</div>
    <button type="button" class="ghost full" data-act="copiar-anuncio">Copiar anuncio para grupos y estados</button>`;
  cargarImagen(ganadorPNG(r), "ganador-rifa-numero-" + g.numero + ".png", `Imagen del ganador de la rifa ${r.nombre}: número ${g.numero}`,
    "¡Ganador de la rifa " + r.nombre + "! Número " + g.numero);
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
  if (r.estado === "finalizada") return showErr("#nErr", "Esta rifa ya se realizó: no se pueden cambiar números.");
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
    if (!rifas.find(x => x.id === r.id)) rifas = [r, ...rifas];
    cerrarYLuego(() => abrirRifa(r.id));
    toast("Talonario creado");
  } catch(e){ showErr("#rErr", "No se pudo crear la rifa: " + (e?.message||"revisa tu conexión")); }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button, [data-act]");
  if (!t) { if (e.target.id === "overlay") closeSheet(); return; }
  if (t.dataset.n){ openSheet({type:"num", k:t.dataset.n}); return; }
  if (t.dataset.f){ filtro = (t.dataset.f === filtro && t.dataset.f !== "todos") ? "todos" : t.dataset.f; render(); return; }
  if (t.dataset.pago) return setPago(t.dataset.pago === "si");
  if (t.dataset.open) return abrirRifa(t.dataset.open);
  if (t.id === "inicioBtn") return irInicio();
  const a = t.dataset.act;
  if (a === "ganador") return openSheet({ type: "ganador" });
  if (a === "ver-ganador") return openSheet({ type: "resultado" });
  if (a === "g-pre"){
    const k = $("#gNum").value, v = numeros[k];
    $("#gConfirmTxt").innerHTML = `¿Confirmas que cayó el <b>${esc(k)}</b>${v?.estado === "pagado" ? " y que ganó <b>" + esc(v.cliente) + "</b>" : ""}? La rifa se cierra: ya no se podrán vender ni cambiar números.`;
    $("#gConfirm").hidden = false; t.hidden = true; return;
  }
  if (a === "g-no"){ $("#gConfirm").hidden = true; const p = $('[data-act="g-pre"]'); if (p) p.hidden = false; $("#gNum").focus(); return; }
  if (a === "g-ok") return finalizarRifa();
  if (a === "copiar-anuncio"){
    try { await navigator.clipboard.writeText(anuncioResultado(activa)); toast("Anuncio copiado: pégalo en tus grupos o estados"); }
    catch(_){ toast("No se pudo copiar en este navegador"); }
    return;
  }
  if (a === "limpiar-pre"){ limpiarAbierto = true; $("#limpiarBox").hidden = false; return; }
  if (a === "limpiar-no"){ limpiarAbierto = false; $("#limpiarBox").hidden = true; return; }
  if (a === "limpiar-ok") return limpiarPantalla();
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
        await navigator.share({files:[file], text: sheet.shareText || ""});
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
  if (el.id === "gNum") return previewGanador();
  if (el.id === "nTel" || el.id === "rNequi"){
    const d = digits(el.value).slice(0, 10);
    el.value = d.length > 6 ? d.replace(/(\d{3})(\d{3})(\d*)/, "$1 $2 $3") : d.length > 3 ? d.replace(/(\d{3})(\d*)/, "$1 $2") : d;
  }
  if (el.id === "rValor"){ const d = digits(el.value).slice(0, 9); el.value = d ? Number(d).toLocaleString("es-CO") : ""; }
});
/* Botón «atrás» de Android: cierra la ventana abierta en vez de salir de la app */
window.addEventListener("popstate", () => { if (sheet) closeSheet(true); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet) closeSheet(); });
window.addEventListener("hashchange", () => { if (rifasLoaded) route(); });

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
