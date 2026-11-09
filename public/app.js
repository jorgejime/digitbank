// =============================================================================
// Cliente Web Financiera Digitbank — PRD v1.0 & QFD Anexo 2
// Modern Web Baseline: <dialog closedby="any">, fetch ES2024, tabular-nums
// =============================================================================

const TOKEN_KEY = 'digitbank_token';
const USER_KEY = 'digitbank_user';

let estadoAdmin = null;
let expedienteClienteActual = null;
let expedienteCajaActual = null;
let filasExcelPendientes = [];

function $(id) {
  return document.getElementById(id);
}

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
}

function mostrarBanner(texto, ok = false) {
  const box = $('app-banner');
  if (!box) return;
  if (!texto) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="banner-msg ${ok ? 'ok' : 'err'}">${esc(texto)}</div>`;
  setTimeout(() => {
    if (box.innerHTML.includes(esc(texto))) box.innerHTML = '';
  }, 6500);
}

function usuarioSesion() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const tk = localStorage.getItem(TOKEN_KEY);
  if (tk) headers.Authorization = `Bearer ${tk}`;
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const resp = await fetch(`/api${path}`, { ...opts, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401) {
      cerrarSesionLocal();
    }
    throw new Error(data.error || `Error HTTP ${resp.status}`);
  }
  return data;
}

function cerrarSesionLocal() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  $('vista-app').classList.add('hidden');
  $('vista-landing').classList.remove('hidden');
}

// =============================================================================
// 1. SIMULADOR DE PRÉSTAMO (RF-12)
// =============================================================================
async function actualizarSimulador() {
  const monto = Number($('sim-monto').value || 1000000);
  const plazo_meses = Number($('sim-plazo').value || 12);
  const frecuencia = $('sim-frecuencia').value;
  const tasa_maxima_legal = Number($('sim-tasa').value || 2.3);
  const tiene_referente = $('sim-referente').checked;

  try {
    const plan = await api('/simulador', {
      method: 'POST',
      body: { monto, plazo_meses, frecuencia, tasa_maxima_legal, tiene_referente }
    });
    const t = plan.tasas;
    let html = `
      <div class="kpi-grid" style="margin-top:12px">
        <div class="kpi accent">
          <div class="kpi-label">Cuota sugerida (${esc(plan.frecuencia)})</div>
          <div class="kpi-val">${fmt(plan.cuota_valor)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Número de cuotas</div>
          <div class="kpi-val">${plan.num_cuotas}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Aporte acumulado a su Fondo</div>
          <div class="kpi-val">${fmt(plan.totales.fondo)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Total proyectado</div>
          <div class="kpi-val">${fmt(plan.totales.total_pagar)}</div>
        </div>
      </div>
      <p class="hint">
        <strong>Reparto de la deducción total del 10% mensual:</strong>
        Tasa máxima legal <strong>${t.tasaMaximaLegal}%</strong> +
        Uso de plataforma <strong>${t.pctPlataforma}%</strong> +
        Comisión referente <strong>${t.pctReferente}%</strong> +
        Fondo de garantías crediticias <strong>${t.pctFondo}%</strong> = <strong>10.0%</strong>.
        Todo el excedente de la cuota amortiza capital. Mora: $0 · Días de gracia: 0.
      </p>
      <details>
        <summary style="cursor:pointer;font-weight:500;font-size:13px;margin-bottom:8px">Ver programación completa de las ${plan.num_cuotas} cuotas</summary>
        <div class="table-wrap" style="max-height:260px;overflow-y:auto">
          <table>
            <thead>
              <tr><th>#</th><th>Vencimiento</th><th>Saldo ini.</th><th>Interés</th><th>Fondo</th><th>Plataforma</th><th>Referente</th><th>Capital</th><th>Cuota</th><th>Saldo final</th></tr>
            </thead>
            <tbody>
              ${plan.cuotas
                .map(
                  (q) => `<tr>
                    <td class="num">${q.numero}</td>
                    <td>${esc(q.fecha_vencimiento)}</td>
                    <td class="num">${fmt(q.saldo_inicial)}</td>
                    <td class="num">${fmt(q.interes)}</td>
                    <td class="num">${fmt(q.fondo)}</td>
                    <td class="num">${fmt(q.plataforma)}</td>
                    <td class="num">${fmt(q.referente)}</td>
                    <td class="num">${fmt(q.capital)}</td>
                    <td class="num"><strong>${fmt(q.cuota)}</strong></td>
                    <td class="num">${fmt(q.saldo_final)}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </details>
    `;
    $('sim-resultado').innerHTML = html;
  } catch (e) {
    $('sim-resultado').innerHTML = `<div class="banner-msg err">${esc(e.message)}</div>`;
  }
}

async function actualizarPrevisualizacionSolicitud() {
  const monto = Number($('sol-monto').value || 1000000);
  const plazo_meses = Number($('sol-plazo').value || 12);
  const frecuencia = $('sol-frecuencia').value || 'mensual';
  const tiene_referente = Boolean(($('sol-referente').value || '').trim());
  try {
    const plan = await api('/simulador', {
      method: 'POST',
      body: { monto, plazo_meses, frecuencia, tiene_referente }
    });
    $('sol-resumen-cuota').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <span class="hint" style="margin:0">Cuota estimada (${esc(plan.frecuencia)} · ${plan.num_cuotas} cuotas)</span>
          <strong class="num" style="font-size:18px">${fmt(plan.cuota_valor)}</strong>
        </div>
        <div style="text-align:right">
          <span class="hint" style="margin:0">Acumulación estimada en su Fondo</span>
          <strong class="num" style="color:var(--ok)">${fmt(plan.totales.fondo)}</strong>
        </div>
      </div>
    `;
  } catch {
    $('sol-resumen-cuota').innerHTML = '';
  }
}

// =============================================================================
// 2. PANEL DEL CLIENTE (PRD §4 · «Mi crédito» y «Mi portafolio»)
// =============================================================================
async function cargarPanelCliente() {
  try {
    const exp = await api('/cliente/expediente');
    expedienteClienteActual = exp;
    const c = exp.cliente;
    const e = exp.estado_credito;

    // Cabecera básica al entrar con los dos botones solicitados en PRD §4: «Mi crédito» y «Mi portafolio»
    $('cliente-cabecera').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px">
        <div>
          <span class="badge gold">Código personal: ${esc(e.codigo_personal)}</span>
          <h2 style="margin:8px 0 4px;font-size:22px;font-weight:600">${esc(c.nombre)}</h2>
          <p class="hint" style="margin:0">
            C.C. ${esc(c.cedula)} · ${esc(c.ciudad || 'Colombia')} · Tel: ${esc(c.telefono || '—')} ·
            Referido por: <strong>${esc(e.nombre_referente)} (${esc(e.codigo_referente)})</strong>
          </p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" data-ir-cliente="credito">Mi crédito</button>
          <button type="button" class="btn btn-dark" data-ir-cliente="portafolio">Mi portafolio</button>
        </div>
      </div>
      <div class="kpi-grid" style="margin-top:16px;margin-bottom:0">
        <div class="kpi accent">
          <div class="kpi-label">Saldo actual de mi crédito</div>
          <div class="kpi-val">${fmt(e.saldo_credito)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Mi fondo de garantías (281020)</div>
          <div class="kpi-val">${fmt(e.saldo_fondo_garantias)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Mi nota en tiempo real / Promedio</div>
          <div class="kpi-val">${e.nota_pago.toFixed(2)} / ${e.nota_promedio.toFixed(2)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Próximo pago (${esc(e.proximo_pago_fecha)})</div>
          <div class="kpi-val">${fmt(e.proximo_pago_valor)}</div>
        </div>
      </div>
    `;

    pintarClienteMiCredito(exp);
    pintarClienteMiPortafolio(exp);
    pintarClienteRetiroAhorro(exp);
  } catch (err) {
    mostrarBanner(err.message);
  }
}

function pintarClienteMiCredito(exp) {
  const e = exp.estado_credito;
  let html = `
    <div class="card">
      <h3 class="card-title">Estado completo de mi crédito y cupos</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Cupo personal del crédito</div><div class="kpi-val">${fmt(e.cupo_personal)}</div></div>
        <div class="kpi"><div class="kpi-label">Disponible crédito personal</div><div class="kpi-val">${fmt(e.disponible_credito_personal)}</div></div>
        <div class="kpi"><div class="kpi-label">Disponible para referir</div><div class="kpi-val">${fmt(e.disponible_para_referir)}</div></div>
        <div class="kpi"><div class="kpi-label">Cuotas pagadas / faltantes</div><div class="kpi-val">${e.cuotas_pagadas} / ${e.cuotas_faltantes}</div></div>
        <div class="kpi"><div class="kpi-label">Fecha último reembolso</div><div class="kpi-val">${esc(e.fecha_ultimo_reembolso)}</div></div>
        <div class="kpi"><div class="kpi-label">Saldo anterior</div><div class="kpi-val">${fmt(e.saldo_anterior)}</div></div>
      </div>
    </div>
  `;

  // Cuentas contables discriminadas del titular (PRD §7.2)
  html += `
    <div class="card">
      <h3 class="card-title">Plan de cuentas contables de mi crédito (PRD §7.2)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cuenta PUC</th><th>Concepto</th><th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Saldo discriminado</th></tr></thead>
          <tbody>
            ${exp.plan_cuentas
              .map(
                (ct) => `<tr>
                  <td class="num"><strong>${esc(ct.codigo)}</strong></td>
                  <td>${esc(ct.concepto)}</td>
                  <td class="num">${fmt(ct.debito)}</td>
                  <td class="num">${fmt(ct.credito)}</td>
                  <td class="num"><strong>${fmt(ct.valor)}</strong></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Créditos y tabla de cuotas + formulario para reportar pago con comprobante
  if (!exp.creditos.length) {
    html += `<div class="card"><p class="hint">Actualmente no tiene créditos activos registrados.</p></div>`;
  } else {
    for (const cr of exp.creditos) {
      html += `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <h3 class="card-title" style="margin:0">
              Crédito #${cr.id} · Monto ${fmt(cr.monto)} · Cuota ${fmt(cr.cuota_valor)} (${esc(cr.frecuencia)})
            </h3>
            <span class="badge ${cr.estado === 'pagado' ? 'ok' : 'gold'}">
              Estado: ${esc(cr.estado.toUpperCase())} · Nota: ${Number(cr.nota || 5).toFixed(2)}
            </span>
          </div>
          <p class="hint">
            Reparto deducción 10%: Tasa máxima legal <strong>${cr.tasa_maxima_legal}%</strong> ·
            Plataforma <strong>${cr.pct_plataforma}%</strong> ·
            Referente <strong>${cr.pct_referente}%</strong> ·
            Fondo garantías <strong>${cr.pct_fondo}%</strong>.
          </p>
          <div class="table-wrap" style="margin-bottom:14px">
            <table>
              <thead>
                <tr><th>#</th><th>Vencimiento</th><th class="num">Cuota</th><th class="num">Interés</th><th class="num">Fondo</th><th class="num">Capital</th><th class="num">Pagado</th><th>Estado</th></tr>
              </thead>
              <tbody>
                ${cr.cuotas
                  .map(
                    (q) => `<tr>
                      <td class="num">${q.numero}</td>
                      <td>${esc(q.fecha_vencimiento)}</td>
                      <td class="num">${fmt(q.cuota)}</td>
                      <td class="num">${fmt(q.interes)}</td>
                      <td class="num">${fmt(q.fondo)}</td>
                      <td class="num">${fmt(q.capital)}</td>
                      <td class="num">${fmt(q.pagado)}</td>
                      <td><span class="badge ${q.estado === 'pagada' ? 'ok' : q.estado === 'vencida' ? 'danger' : 'warn'}">${esc(q.estado)}</span></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>

          <form class="form-reportar-pago-cliente" data-credito-id="${cr.id}">
            <h4 style="margin:0 0 8px;font-size:14.5px">Reportar pago por transferencia (con comprobante)</h4>
            <div class="grid-3">
              <div class="field">
                <label>Valor transferido (COP)</label>
                <input type="number" name="monto" min="1000" value="${cr.proxima_cuota ? Math.max(0, cr.proxima_cuota.cuota - cr.proxima_cuota.pagado) : cr.cuota_valor}" required>
              </div>
              <div class="field">
                <label>Referencia / Comprobante</label>
                <input type="text" name="referencia" placeholder="N.º transferencia" required>
              </div>
              <div class="field">
                <label>Adjuntar comprobante (imagen o PDF)</label>
                <input type="file" name="soporte" accept="image/*,application/pdf">
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Enviar comprobante para confirmación</button>
          </form>
        </div>
      `;
    }
  }

  // Historial de pagos y tickets del cliente
  html += `
    <div class="card">
      <h3 class="card-title">Mis pagos y tickets emitidos</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ticket</th><th>Fecha</th><th class="num">Valor</th><th class="num">Aplicado</th><th>Estado</th><th class="num">Nota del pago</th><th>Comprobante</th></tr></thead>
          <tbody>
            ${
              exp.pagos.length
                ? exp.pagos
                    .map(
                      (p) => `<tr>
                        <td><strong>${esc(p.ticket_numero || '—')}</strong></td>
                        <td>${esc(p.fecha)}</td>
                        <td class="num">${fmt(p.monto)}</td>
                        <td class="num">${fmt(p.aplicado)}</td>
                        <td><span class="badge ${p.estado === 'confirmado' ? 'ok' : 'warn'}">${esc(p.estado)}</span></td>
                        <td class="num">${p.nota_pago ? Number(p.nota_pago).toFixed(2) : '—'}</td>
                        <td>${p.soporte_id ? `<a href="/api/soportes/${p.soporte_id}" target="_blank" rel="noopener">Ver soporte</a>` : '—'}</td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="7" class="hint">Aún no hay pagos registrados.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('vista-cli-credito').innerHTML = html;
}

function pintarClienteMiPortafolio(exp) {
  const e = exp.estado_credito;
  const refs = exp.portafolio_referidos || [];

  let html = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div>
          <h3 class="card-title" style="margin:0">Mi portafolio financiero · Red de referidos directos (RF-08, RF-15)</h3>
          <p class="hint" style="margin:4px 0 0">Solo se muestran sus referidos directos. Por privacidad no se exponen referidos de segundo nivel.</p>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi accent">
          <div class="kpi-label">Cupo total referido</div>
          <div class="kpi-val">${fmt(e.cupo_total_referido)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Saldo del valor referido</div>
          <div class="kpi-val">${fmt(e.saldo_valor_referido)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Nota promedio de mi grupo</div>
          <div class="kpi-val">${e.nota_grupo.toFixed(2)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Número de referidos directos</div>
          <div class="kpi-val">${e.numero_referidos}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referido directo</th>
              <th class="num">Cupo</th>
              <th class="num">Saldo actual</th>
              <th>Último reembolso</th>
              <th>Última fecha pago</th>
              <th>Próxima fecha pago</th>
              <th class="num">Disponible referir</th>
              <th class="num">Nota</th>
              <th>Estado de cuenta</th>
            </tr>
          </thead>
          <tbody>
            ${
              refs.length
                ? refs
                    .map(
                      (r, idx) => `<tr>
                        <td><strong>${esc(r.nombre)}</strong><br><span class="hint">C.C. ${esc(r.cedula)}</span></td>
                        <td class="num">${fmt(r.cupo_personal)}</td>
                        <td class="num">${fmt(r.saldo_credito)}</td>
                        <td>${esc(r.fecha_ultimo_reembolso)} (${fmt(r.valor_ultimo_reembolso)})</td>
                        <td>${esc(r.ultima_fecha_pago)}</td>
                        <td>${esc(r.proxima_fecha_pago)} (${fmt(r.proximo_valor_pago)})</td>
                        <td class="num">${fmt(r.disponible_para_referir)}</td>
                        <td class="num"><strong>${r.nota_promedio.toFixed(2)}</strong></td>
                        <td><button type="button" class="btn btn-outline btn-sm" data-ver-ref-idx="${idx}">Ver movimientos</button></td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="9" class="hint">Aún no tiene referidos directos asociados a su código personal.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Solicitud de nuevo referido</h3>
      <form id="form-nuevo-referido-cliente">
        <div class="grid-3">
          <div class="field">
            <label>Nombre completo del referido</label>
            <input type="text" name="nombre" required>
          </div>
          <div class="field">
            <label>Número de cédula</label>
            <input type="text" name="cedula" required>
          </div>
          <div class="field">
            <label>Teléfono / WhatsApp</label>
            <input type="tel" name="telefono" required>
          </div>
          <div class="field">
            <label>Correo electrónico</label>
            <input type="email" name="email">
          </div>
          <div class="field">
            <label>Valor solicitado ($500.000 a $2.000.000)</label>
            <input type="number" name="monto" min="500000" max="2000000" step="50000" value="1000000" required>
          </div>
          <div class="field">
            <label>Frecuencia de pago</label>
            <select name="frecuencia">
              <option value="mensual">Mensual</option>
              <option value="quincenal">Quincenal</option>
              <option value="semanal">Semanal</option>
              <option value="diaria">Diaria</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Enviar solicitud de nuevo referido</button>
      </form>
    </div>
  `;

  $('vista-cli-portafolio').innerHTML = html;
}

function pintarClienteRetiroAhorro(exp) {
  const r = exp.retiro_ahorro;
  let html = `
    <div class="card">
      <h3 class="card-title">Retiro del ahorro / Fondo de garantías (RF-13)</h3>
      <p class="hint">
        Regla aprobada en el PRD: el sistema habilita para retiro únicamente el ahorro que supere el
        <strong>200% del total del cupo referido</strong>.
      </p>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Saldo en mi Fondo de Garantías</div><div class="kpi-val">${fmt(r.saldo_fondo)}</div></div>
        <div class="kpi"><div class="kpi-label">Cupo total referido actual</div><div class="kpi-val">${fmt(r.cupo_total_referido)}</div></div>
        <div class="kpi"><div class="kpi-label">200% de respaldo requerido</div><div class="kpi-val">${fmt(r.umbral_200_pct)}</div></div>
        <div class="kpi accent"><div class="kpi-label">Ahorro disponible para retiro hoy</div><div class="kpi-val">${fmt(r.disponible_retiro)}</div></div>
      </div>

      <form id="form-solicitar-retiro">
        <div class="grid-2">
          <div class="field">
            <label>Monto a retirar (máximo ${fmt(r.disponible_retiro)})</label>
            <input type="number" name="monto" min="1000" max="${Math.max(0, r.disponible_retiro)}" value="${r.disponible_retiro}" ${r.disponible_retiro <= 0 ? 'disabled' : ''} required>
          </div>
          <div class="field">
            <label>Billetera o cuenta destino</label>
            <input type="text" name="destino_billetera" value="${esc(exp.cliente.billetera || '')}" placeholder="Nequi / Daviplata / Cuenta bancaria" ${r.disponible_retiro <= 0 ? 'disabled' : ''} required>
          </div>
        </div>
        <button type="submit" class="btn btn-primary" ${r.disponible_retiro <= 0 ? 'disabled' : ''}>Solicitar retiro de ahorro disponible</button>
      </form>
    </div>
  `;
  $('vista-cli-ahorro').innerHTML = html;
}

// =============================================================================
// 3. PANEL ADMINISTRATIVO Y FLUJO DE CAJA POR CÉDULA §7.1
// =============================================================================
async function cargarPanelAdmin() {
  try {
    const data = await api('/admin/resumen');
    estadoAdmin = data;
    pintarAdminCajaCedula();
    pintarAdminCartera(data);
    pintarAdminCreditos(data);
    pintarAdminClientes(data);
    pintarAdminPagos(data);
    pintarAdminSolicitudes(data);
    pintarAdminMigracion();
    const u = usuarioSesion();
    if (u?.rol === 'superadmin') {
      $('tab-btn-superadmin').classList.remove('hidden');
      await cargarSuperAdmin();
    }
  } catch (e) {
    mostrarBanner(e.message);
  }
}

function pintarAdminCajaCedula() {
  const sec = $('admin-sec-cedula');
  sec.innerHTML = `
    <div class="card">
      <h3 class="card-title">Recepción de pago por WhatsApp · Búsqueda inmediata por Cédula (PRD §7.1)</h3>
      <p class="hint">
        Al ingresar el número de cédula del cliente se muestran de inmediato todas las cuentas contables de su crédito con los valores discriminados, sus datos personales, notas, cupos, disponibles, fondo, referidos y formulario de confirmación con ticket.
      </p>
      <form id="form-buscar-cedula" style="display:flex;gap:10px;flex-wrap:wrap">
        <input id="input-buscar-cedula" type="search" inputmode="numeric" placeholder="Digite el número de cédula del cliente..." style="flex:1;min-width:240px" required>
        <button type="submit" class="btn btn-primary">Consultar expediente completo</button>
      </form>
    </div>
    <div id="caja-cedula-resultado"></div>
  `;
  if (expedienteCajaActual) {
    renderizarExpedienteEnCaja(expedienteCajaActual);
  }
}

function renderizarExpedienteEnCaja(exp) {
  const c = exp.cliente;
  const e = exp.estado_credito;
  const crActivo = exp.creditos.find((x) => x.estado === 'activo') || exp.creditos[0] || null;

  let html = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        <div>
          <span class="badge gold">Código personal: ${esc(e.codigo_personal)} · Referente: ${esc(e.codigo_referente)}</span>
          <h3 style="margin:6px 0 2px;font-size:20px">${esc(c.nombre)} · C.C. ${esc(c.cedula)}</h3>
          <p class="hint" style="margin:0">
            Tel/WhatsApp: ${esc(c.whatsapp || c.telefono || '—')} · Correo: ${esc(c.email || '—')} ·
            Ciudad: ${esc(c.ciudad || '—')} · Billetera: ${esc(c.billetera || '—')}
          </p>
        </div>
        <div style="text-align:right">
          <span class="badge ok">Nota pago: ${e.nota_pago.toFixed(2)}</span>
          <span class="badge ok">Nota prom: ${e.nota_promedio.toFixed(2)}</span>
          <span class="badge gold">Nota grupo: ${e.nota_grupo.toFixed(2)}</span>
        </div>
      </div>

      <!-- Los 18 indicadores exigidos en PRD §7.1 -->
      <div class="kpi-grid">
        <div class="kpi accent"><div class="kpi-label">Próximo pago (${esc(e.proximo_pago_fecha)})</div><div class="kpi-val">${fmt(e.proximo_pago_valor)}</div></div>
        <div class="kpi"><div class="kpi-label">Saldo actual del crédito</div><div class="kpi-val">${fmt(e.saldo_credito)}</div></div>
        <div class="kpi"><div class="kpi-label">Saldo anterior</div><div class="kpi-val">${fmt(e.saldo_anterior)}</div></div>
        <div class="kpi"><div class="kpi-label">Saldo fondo de garantías</div><div class="kpi-val">${fmt(e.saldo_fondo_garantias)}</div></div>
        <div class="kpi"><div class="kpi-label">Cupo personal</div><div class="kpi-val">${fmt(e.cupo_personal)}</div></div>
        <div class="kpi"><div class="kpi-label">Disponible crédito personal</div><div class="kpi-val">${fmt(e.disponible_credito_personal)}</div></div>
        <div class="kpi"><div class="kpi-label">Disponible para referir</div><div class="kpi-val">${fmt(e.disponible_para_referir)}</div></div>
        <div class="kpi"><div class="kpi-label">Saldo del valor referido</div><div class="kpi-val">${fmt(e.saldo_valor_referido)}</div></div>
        <div class="kpi"><div class="kpi-label">Cuotas pagadas / faltantes</div><div class="kpi-val">${e.cuotas_pagadas} / ${e.cuotas_faltantes}</div></div>
        <div class="kpi"><div class="kpi-label">Fecha último reembolso</div><div class="kpi-val">${esc(e.fecha_ultimo_reembolso)}</div></div>
        <div class="kpi"><div class="kpi-label">N.º de referidos directos</div><div class="kpi-val">${e.numero_referidos}</div></div>
        <div class="kpi"><div class="kpi-label">Calificación prom. grupo</div><div class="kpi-val">${e.nota_grupo.toFixed(2)}</div></div>
      </div>

      <h4 style="margin:16px 0 8px;font-size:15px">Cuentas contables del crédito con valores discriminados (PRD §7.2)</h4>
      <div class="table-wrap" style="margin-bottom:16px">
        <table>
          <thead><tr><th>Cuenta</th><th>Concepto contable</th><th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Valor neto</th></tr></thead>
          <tbody>
            ${exp.plan_cuentas
              .map(
                (ct) => `<tr>
                  <td class="num"><strong>${esc(ct.codigo)}</strong></td>
                  <td>${esc(ct.concepto)}</td>
                  <td class="num">${fmt(ct.debito)}</td>
                  <td class="num">${fmt(ct.credito)}</td>
                  <td class="num"><strong>${fmt(ct.valor)}</strong></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      ${
        crActivo
          ? `
          <form id="form-caja-registrar-pago" data-credito-id="${crActivo.id}" style="background:var(--canvas-light);padding:16px;border-radius:var(--r-md)">
            <h4 style="margin:0 0 10px;font-size:15px">Registrar y confirmar pago con ticket · Crédito #${crActivo.id}</h4>
            <div class="grid-3">
              <div class="field">
                <label>Valor recibido (COP)</label>
                <input type="number" name="monto" min="1000" value="${e.proximo_pago_valor || crActivo.cuota_valor}" required>
              </div>
              <div class="field">
                <label>Fecha del pago</label>
                <input type="date" name="fecha" value="${new Date().toISOString().slice(0, 10)}" required>
              </div>
              <div class="field">
                <label>Referencia bancaria / WhatsApp</label>
                <input type="text" name="referencia" placeholder="Comprobante transferencia" required>
              </div>
            </div>
            <div class="field">
              <label>Adjuntar imagen o PDF del comprobante enviado por WhatsApp</label>
              <input type="file" name="soporte" accept="image/*,application/pdf">
            </div>
            <button type="submit" class="btn btn-primary">Confirmar pago, actualizar nota en tiempo real y emitir Ticket</button>
          </form>
        `
          : `<p class="hint">Este cliente aún no tiene un crédito activo. Puede abrirlo en la pestaña «Créditos».</p>`
      }
    </div>
  `;
  $('caja-cedula-resultado').innerHTML = html;
}

function pintarAdminCartera(data) {
  const m = data.metricas;
  $('admin-sec-cartera').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi accent"><div class="kpi-label">Cartera activa (Capital)</div><div class="kpi-val">${fmt(m.cartera_capital)}</div></div>
      <div class="kpi"><div class="kpi-label">Recaudo confirmado</div><div class="kpi-val">${fmt(m.recaudo_total)}</div></div>
      <div class="kpi"><div class="kpi-label">Fondo de garantías en custodia</div><div class="kpi-val">${fmt(m.fondo_garantias_total)}</div></div>
      <div class="kpi"><div class="kpi-label">Clientes / Créditos activos</div><div class="kpi-val">${m.total_clientes} / ${m.creditos_activos}</div></div>
      <div class="kpi"><div class="kpi-label">Cuotas vencidas (Mora $0)</div><div class="kpi-val">${m.cuotas_vencidas} (${fmt(m.monto_vencido)})</div></div>
      <div class="kpi"><div class="kpi-label">Pagos por confirmar</div><div class="kpi-val">${m.pagos_por_confirmar}</div></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <h3 class="card-title" style="margin:0">Balance Global del Plan de Cuentas (PRD §7.2)</h3>
        <button type="button" class="btn btn-outline btn-sm" id="btn-disparar-avisos-vencimientos">Enviar avisos de vencimientos por correo ahora (RF-09)</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cuenta PUC</th><th>Concepto</th><th class="num">Total Débitos</th><th class="num">Total Créditos</th></tr></thead>
          <tbody>
            ${data.plan_cuentas_global
              .map(
                (c) => `<tr>
                  <td class="num"><strong>${esc(c.codigo)}</strong></td>
                  <td>${esc(c.concepto)}</td>
                  <td class="num">${fmt(c.total_debito)}</td>
                  <td class="num">${fmt(c.total_credito)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Reporte de vencimientos próximos y cuotas vencidas (RF-11)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Vencimiento</th><th>Cliente</th><th>Cédula</th><th>Teléfono</th><th>Cuota #</th><th class="num">Valor pendiente</th><th>Estado</th></tr></thead>
          <tbody>
            ${
              data.vencimientos.length
                ? data.vencimientos
                    .map(
                      (q) => `<tr>
                        <td><strong>${esc(q.fecha_vencimiento)}</strong></td>
                        <td>${esc(q.cliente_nombre)}</td>
                        <td class="num">${esc(q.cliente_cedula)}</td>
                        <td>${esc(q.cliente_telefono || '—')}</td>
                        <td class="num">#${q.numero} (${esc(q.frecuencia)})</td>
                        <td class="num">${fmt(q.cuota - q.pagado)}</td>
                        <td><span class="badge ${q.estado === 'vencida' ? 'danger' : 'warn'}">${esc(q.estado)}</span></td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="7" class="hint">No hay cuotas vencidas ni próximas a vencer en los siguientes 7 días.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pintarAdminCreditos(data) {
  $('admin-sec-creditos').innerHTML = `
    <div class="card">
      <h3 class="card-title">Abrir nuevo crédito · Motor del 10% (RF-01, RF-02)</h3>
      <form id="form-admin-nuevo-credito">
        <div class="grid-3">
          <div class="field">
            <label>Cliente titular</label>
            <select name="cliente_id" required>
              <option value="">Seleccione un cliente...</option>
              ${data.clientes
                .map(
                  (c) =>
                    `<option value="${c.id}">${esc(c.nombre)} · C.C. ${esc(c.cedula)} ${
                      c.referido_por_id ? '(Con referente)' : '(Sin referente)'
                    }</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>Monto ($500.000 a $2.000.000)</label>
            <input type="number" name="monto" min="500000" max="2000000" step="50000" value="1000000" required>
          </div>
          <div class="field">
            <label>Frecuencia de pago</label>
            <select name="frecuencia" required>
              <option value="mensual">Mensual</option>
              <option value="quincenal">Quincenal</option>
              <option value="semanal">Semanal</option>
              <option value="diaria">Diaria</option>
            </select>
          </div>
          <div class="field">
            <label>Plazo (1 a 24 meses)</label>
            <input type="number" name="plazo_meses" min="1" max="24" value="12" required>
          </div>
          <div class="field">
            <label>Tasa máxima legal al abrir el crédito (%)</label>
            <input type="number" name="tasa_maxima_legal" step="0.01" min="0.5" max="6.5" value="2.3" required>
          </div>
          <div class="field">
            <label>Fecha de inicio</label>
            <input type="date" name="fecha_inicio" value="${new Date().toISOString().slice(0, 10)}" required>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Aprobar crédito, programar cuotas y contabilizar en PUC</button>
      </form>
    </div>

    <div class="card">
      <h3 class="card-title">Créditos registrados</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Titular</th><th>Cédula</th><th class="num">Monto</th><th>Frecuencia</th><th class="num">Cuota</th><th>Tasas (T/Plat/Ref/Fondo)</th><th class="num">Saldo capital</th><th class="num">Nota</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            ${
              data.creditos.length
                ? data.creditos
                    .map(
                      (c) => `<tr>
                        <td class="num">#${c.id}</td>
                        <td><strong>${esc(c.cliente_nombre)}</strong></td>
                        <td class="num">${esc(c.cliente_cedula)}</td>
                        <td class="num">${fmt(c.monto)}</td>
                        <td>${esc(c.frecuencia)} (${c.cuotas_pagadas}/${c.num_cuotas})</td>
                        <td class="num">${fmt(c.cuota_valor)}</td>
                        <td class="num">${c.tasa_maxima_legal}% / ${c.pct_plataforma}% / ${c.pct_referente}% / ${c.pct_fondo}%</td>
                        <td class="num"><strong>${fmt(c.saldo_capital)}</strong></td>
                        <td class="num">${Number(c.nota || 5).toFixed(2)}</td>
                        <td><span class="badge ${c.estado === 'activo' ? 'gold' : 'ok'}">${esc(c.estado)}</span></td>
                        <td>
                          <button type="button" class="btn btn-outline btn-sm" data-ir-cedula="${esc(c.cliente_cedula)}">Ver en Caja</button>
                          ${
                            c.estado === 'activo'
                              ? `<button type="button" class="btn btn-outline btn-sm" data-cerrar-credito="${c.id}">Cerrar</button>`
                              : ''
                          }
                        </td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="11" class="hint">Base en blanco: aún no hay créditos creados.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pintarAdminClientes(data) {
  $('admin-sec-clientes').innerHTML = `
    <div class="card">
      <h3 class="card-title">Registrar nuevo cliente y crear su clave de acceso</h3>
      <form id="form-admin-nuevo-cliente">
        <div class="grid-3">
          <div class="field"><label>Nombre completo</label><input type="text" name="nombre" required></div>
          <div class="field"><label>Cédula (será su usuario inicial)</label><input type="text" name="cedula" required></div>
          <div class="field"><label>Clave inicial (opcional, por defecto su cédula)</label><input type="text" name="password" placeholder="Por defecto igual a la cédula"></div>
          <div class="field"><label>Teléfono / WhatsApp</label><input type="tel" name="telefono"></div>
          <div class="field"><label>Correo electrónico</label><input type="email" name="email"></div>
          <div class="field"><label>Ciudad</label><input type="text" name="ciudad"></div>
          <div class="field"><label>Dirección</label><input type="text" name="direccion"></div>
          <div class="field"><label>Billetera electrónica</label><input type="text" name="billetera"></div>
          <div class="field"><label>Cupo personal (COP)</label><input type="number" name="cupo_personal" value="2000000" step="100000"></div>
          <div class="field">
            <label>Referido por (opcional)</label>
            <select name="referido_por_id">
              <option value="">Sin referente (Directo)</option>
              ${data.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)} (${esc(c.codigo_personal)})</option>`).join('')}
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Guardar cliente</button>
      </form>
    </div>

    <div class="card">
      <h3 class="card-title">Directorio de clientes (${data.clientes.length})</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Cédula</th><th>Código</th><th>Referido por</th><th class="num">Cupo</th><th class="num">Fondo garantías</th><th class="num">Nota prom.</th><th>Acción</th></tr></thead>
          <tbody>
            ${
              data.clientes.length
                ? data.clientes
                    .map(
                      (c) => `<tr>
                        <td><strong>${esc(c.nombre)}</strong><br><span class="hint">${esc(c.email || c.telefono || '')}</span></td>
                        <td class="num">${esc(c.cedula)}</td>
                        <td><span class="badge gold">${esc(c.codigo_personal)}</span></td>
                        <td>${esc(c.referido_por_nombre || 'Directo')}</td>
                        <td class="num">${fmt(c.cupo_personal)}</td>
                        <td class="num">${fmt(c.saldo_fondo_garantias)}</td>
                        <td class="num"><strong>${Number(c.nota_promedio || 5).toFixed(2)}</strong></td>
                        <td><button type="button" class="btn btn-outline btn-sm" data-ir-cedula="${esc(c.cedula)}">Abrir en Caja</button></td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="8" class="hint">Base en blanco: lista para crear clientes o migrar los 210 del Excel original.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pintarAdminPagos(data) {
  $('admin-sec-pagos').innerHTML = `
    <div class="card">
      <h3 class="card-title">Pagos reportados y confirmados con Ticket (RF-03)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ticket</th><th>Fecha</th><th>Cliente</th><th>Cédula</th><th class="num">Valor</th><th class="num">Nota</th><th>Soporte</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            ${
              data.pagos.length
                ? data.pagos
                    .map(
                      (p) => `<tr>
                        <td><strong>${esc(p.ticket_numero || '—')}</strong></td>
                        <td>${esc(p.fecha)}</td>
                        <td>${esc(p.cliente_nombre)}</td>
                        <td class="num">${esc(p.cliente_cedula)}</td>
                        <td class="num">${fmt(p.monto)}</td>
                        <td class="num">${p.nota_pago ? Number(p.nota_pago).toFixed(2) : '—'}</td>
                        <td>${p.soporte_id ? `<a href="/api/soportes/${p.soporte_id}" target="_blank" rel="noopener">Ver comprobante</a>` : '—'}</td>
                        <td><span class="badge ${p.estado === 'confirmado' ? 'ok' : 'warn'}">${esc(p.estado)}</span></td>
                        <td>
                          ${
                            p.estado === 'reportado'
                              ? `<button type="button" class="btn btn-primary btn-sm" data-confirmar-pago="${p.id}">Confirmar y emitir ticket</button>`
                              : 'Confirmado'
                          }
                        </td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="9" class="hint">Aún no hay pagos registrados.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pintarAdminSolicitudes(data) {
  $('admin-sec-solicitudes').innerHTML = `
    <div class="card">
      <h3 class="card-title">Solicitudes de crédito y de nuevos referidos (RF-16)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Nombre</th><th>Cédula</th><th>Contacto</th><th class="num">Monto</th><th>Frecuencia</th><th>Referente</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            ${
              data.solicitudes.length
                ? data.solicitudes
                    .map(
                      (s) => `<tr>
                        <td>${esc((s.creado_en || '').slice(0, 10))}</td>
                        <td><span class="badge gold">${esc(s.tipo)}</span></td>
                        <td><strong>${esc(s.nombre)}</strong></td>
                        <td class="num">${esc(s.cedula || '—')}</td>
                        <td>${esc(s.telefono || '')}<br><span class="hint">${esc(s.email || '')}</span></td>
                        <td class="num">${fmt(s.monto)}</td>
                        <td>${esc(s.frecuencia)} (${s.plazo_meses || 12} m)</td>
                        <td>${esc(s.codigo_referente || 'Directo')}</td>
                        <td><span class="badge ${s.estado === 'nueva' ? 'warn' : 'ok'}">${esc(s.estado)}</span></td>
                        <td>
                          ${
                            s.estado === 'nueva'
                              ? `<button type="button" class="btn btn-outline btn-sm" data-atender-sol="${s.id}">Marcar atendida</button>`
                              : '—'
                          }
                        </td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="10" class="hint">No hay solicitudes pendientes.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Solicitudes de retiro de ahorro sobre el 200% del cupo referido (RF-13)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Cliente</th><th class="num">Monto retiro</th><th class="num">Cupo referido momento</th><th class="num">Disponible momento</th><th>Destino</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            ${
              data.retiros.length
                ? data.retiros
                    .map(
                      (r) => `<tr>
                        <td>${esc((r.creado_en || '').slice(0, 10))}</td>
                        <td><strong>${esc(r.cliente_nombre)}</strong> (${esc(r.cliente_cedula)})</td>
                        <td class="num"><strong>${fmt(r.monto)}</strong></td>
                        <td class="num">${fmt(r.cupo_referido_momento)}</td>
                        <td class="num">${fmt(r.retirable_maximo_momento)}</td>
                        <td>${esc(r.destino_billetera || '—')}</td>
                        <td><span class="badge ${r.estado === 'pagado' ? 'ok' : 'warn'}">${esc(r.estado)}</span></td>
                        <td>
                          ${
                            r.estado === 'solicitado'
                              ? `<button type="button" class="btn btn-primary btn-sm" data-pagar-retiro="${r.id}">Aprobar y descontar del fondo</button>`
                              : '—'
                          }
                        </td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="8" class="hint">No hay solicitudes de retiro registradas.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =============================================================================
// 4. MIGRACIÓN Y VALIDACIÓN DEL EXCEL DE 21 COLUMNAS / 210 CLIENTES (RF-10)
// =============================================================================
function pintarAdminMigracion() {
  $('admin-sec-migracion').innerHTML = `
    <div class="card">
      <h3 class="card-title">Migración de los 210 clientes desde el Excel actual (.xlsx o .csv · 21 columnas · RF-10)</h3>
      <p class="hint">
        Columnas reconocidas automáticamente (PRD §7.3):
        <code>nombre, cedula, genero, telefono, direccion, ciudad, correo_electronico, whatsapp, billetera_electronica, cupo_personal_del_credito, fecha_de_inicio_del_credito, saldo_del_credito, fecha_del_ultimo_reembolso, numero_de_cuotas_del_credito, numero_de_restantes, nota_del_pago, nota_promedio_del_cliente, nota_promedio_del_grupo_de_referidos, saldo_disponible_para_credito_personal, saldo_disponible_para_referir, saldo_del_fondo_para_garantias_crediticias</code>.
      </p>
      <div class="grid-2">
        <div class="field">
          <label for="file-excel-migracion">Seleccionar archivo Excel (.xlsx) o CSV</label>
          <input id="file-excel-migracion" type="file" accept=".xlsx,.xls,.csv">
        </div>
        <div style="display:flex;align-items:flex-end;gap:10px;padding-bottom:14px">
          <button type="button" class="btn btn-outline" id="btn-validar-excel">1. Validar en seco (Dry-run)</button>
          <button type="button" class="btn btn-primary" id="btn-ejecutar-migracion" disabled>2. Importar a la base de datos</button>
        </div>
      </div>
      <div id="migracion-resultado"></div>
    </div>
  `;
}

function normalizarClaveColumna(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function leerArchivoExcelOCsv(file) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(normalizarClaveColumna);
    return lines.slice(1).map((line) => {
      const cols = line.split(sep);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (cols[i] || '').trim();
      });
      return obj;
    });
  }
  // Carga dinámica de SheetJS solo cuando el administrador sube un .xlsx
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rawRows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[normalizarClaveColumna(k)] = v;
    }
    return out;
  });
}

// =============================================================================
// 5. PANEL SUPER ADMIN (RF-06 · ROLES, PERMISOS, CORREOS, DEJAR EN BLANCO)
// =============================================================================
async function cargarSuperAdmin() {
  const d = await api('/superadmin/estado');
  $('admin-sec-superadmin').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h3 class="card-title" style="margin:0">Configuración global y correos administrativos (PRD §8)</h3>
          <p class="hint" style="margin:4px 0 0">Permite definir múltiples correos administrativos separados por coma y la tasa máxima legal por defecto.</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="btn-limpiar-bd-migracion">Dejar base en blanco para migración</button>
      </div>
      <form id="form-superadmin-config" style="margin-top:12px">
        <div class="grid-2">
          <div class="field">
            <label>Correos administrativos (separados por coma)</label>
            <input type="text" name="correos_admin" value="${esc(d.config.correos_admin || 'financieradigitbank@gmail.com')}" required>
          </div>
          <div class="field">
            <label>Tasa máxima legal mensual por defecto (%)</label>
            <input type="number" step="0.01" name="tasa_maxima_default" value="${esc(d.config.tasa_maxima_default || '2.3')}" required>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Guardar configuración</button>
      </form>
    </div>

    <div class="card">
      <h3 class="card-title">Usuarios y roles del sistema (Cliente, Admin, Super Admin, usuario1, usuario2, usuario3 · PRD §3)</h3>
      <form id="form-superadmin-usuario" style="margin-bottom:14px">
        <div class="grid-3">
          <div class="field"><label>Nombre</label><input type="text" name="nombre" required></div>
          <div class="field"><label>Usuario</label><input type="text" name="usuario" required></div>
          <div class="field"><label>Clave</label><input type="password" name="password" required minlength="6"></div>
          <div class="field"><label>Correo</label><input type="email" name="email"></div>
          <div class="field">
            <label>Rol</label>
            <select name="rol" required>
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
              <option value="usuario1">usuario 1</option>
              <option value="usuario2">usuario 2</option>
              <option value="usuario3">usuario 3</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Crear usuario con rol</button>
      </form>

      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Nombre</th><th>Usuario</th><th>Rol</th><th>2FA</th><th>Estado</th></tr></thead>
          <tbody>
            ${d.usuarios
              .map(
                (u) => `<tr>
                  <td class="num">${u.id}</td>
                  <td><strong>${esc(u.nombre)}</strong></td>
                  <td>${esc(u.usuario)}</td>
                  <td><span class="badge gold">${esc(u.rol)}</span></td>
                  <td>${u.totp_activo ? '<span class="badge ok">2FA Activo</span>' : '<span class="badge">Inactivo</span>'}</td>
                  <td>${u.activo ? '<span class="badge ok">Activo</span>' : '<span class="badge danger">Inactivo</span>'}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Bitácora de accesos y auditoría (PRD §8)</h3>
      <div class="table-wrap" style="max-height:280px;overflow-y:auto">
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead>
          <tbody>
            ${d.bitacora
              .map(
                (b) => `<tr>
                  <td>${esc(b.creado_en)}</td>
                  <td>${esc(b.usuario_nombre || 'público')}</td>
                  <td><strong>${esc(b.accion)}</strong></td>
                  <td>${esc(b.detalle || '')}</td>
                  <td class="num">${esc(b.ip || '')}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =============================================================================
// 6. EVENTOS Y NAVEGACIÓN SIN MANEJADORES INLINE
// =============================================================================
function iniciarAppSegunSesion() {
  const u = usuarioSesion();
  if (!u || !localStorage.getItem(TOKEN_KEY)) {
    $('vista-app').classList.add('hidden');
    $('vista-landing').classList.remove('hidden');
    return;
  }
  $('vista-landing').classList.add('hidden');
  $('vista-app').classList.remove('hidden');
  $('badge-rol-activo').textContent = `${u.nombre} · ${u.rol.toUpperCase()}`;

  if (u.rol === 'cliente') {
    $('panel-admin').classList.add('hidden');
    $('panel-cliente').classList.remove('hidden');
    cargarPanelCliente();
  } else {
    $('panel-cliente').classList.add('hidden');
    $('panel-admin').classList.remove('hidden');
    cargarPanelAdmin();
  }
}

function cambiarSubvistaCliente(cual) {
  ['credito', 'portafolio', 'ahorro'].forEach((k) => {
    $(`tab-cli-${k}`).classList.toggle('active', k === cual);
    $(`vista-cli-${k}`).classList.toggle('hidden', k !== cual);
  });
}

function cambiarPestanaAdmin(cual) {
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    const k = btn.getAttribute('data-admin-tab');
    btn.classList.toggle('active', k === cual);
    const sec = $(`admin-sec-${k}`);
    if (sec) sec.classList.toggle('hidden', k !== cual);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Botones de la pantalla inicial (PRD §4)
  $('btn-abrir-solicitud').addEventListener('click', () => {
    actualizarPrevisualizacionSolicitud();
    $('dlg-solicitud').showModal();
  });

  $('btn-abrir-login').addEventListener('click', () => {
    $('dlg-login-titulo').textContent = 'Ingreso de Cliente';
    $('login-user').placeholder = 'Su número de cédula';
    $('dlg-login').showModal();
  });

  $('btn-abrir-admin-login').addEventListener('click', () => {
    $('dlg-login-titulo').textContent = 'Ingreso de Administración';
    $('login-user').value = 'adminfdigitb';
    $('dlg-login').showModal();
  });

  $('btn-abrir-simulador').addEventListener('click', () => {
    actualizarSimulador();
    $('dlg-simulador').showModal();
  });

  $('btn-header-simulador').addEventListener('click', () => {
    actualizarSimulador();
    $('dlg-simulador').showModal();
  });

  $('btn-abrir-privacidad').addEventListener('click', () => {
    $('dlg-privacidad').showModal();
  });

  $('btn-salir').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    cerrarSesionLocal();
  });

  // Configurar 2FA TOTP
  $('btn-header-2fa').addEventListener('click', async () => {
    const dlg = $('dlg-2fa');
    const body = $('dlg-2fa-body');
    body.innerHTML = `<p class="hint">Generando clave secreta TOTP...</p>`;
    dlg.showModal();
    try {
      const r = await api('/2fa/setup', { method: 'POST' });
      body.innerHTML = `
        <p class="hint">Agregue esta clave en Google Authenticator o Authy e ingrese el código de 6 dígitos para activar el doble factor:</p>
        <div class="card" style="background:var(--canvas-light)">
          <div><strong>Secreto Base32:</strong> <code>${esc(r.secret)}</code></div>
          <div class="hint" style="margin-top:6px">Código vigente en este instante: <strong>${esc(r.codigo_prueba_actual)}</strong></div>
        </div>
        <form id="form-activar-2fa">
          <div class="field">
            <label>Código de verificación (6 dígitos)</label>
            <input type="text" name="code" value="${esc(r.codigo_prueba_actual)}" required pattern="[0-9]{6}">
          </div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn btn-primary">Activar 2FA</button>
            <button type="button" class="btn btn-outline" id="btn-desactivar-2fa">Desactivar 2FA</button>
          </div>
        </form>
      `;
    } catch (e) {
      body.innerHTML = `<div class="banner-msg err">${esc(e.message)}</div>`;
    }
  });

  // Reactividad del simulador y formulario de solicitud pública
  ['sim-monto', 'sim-plazo', 'sim-frecuencia', 'sim-tasa', 'sim-referente'].forEach((id) => {
    $(id).addEventListener('input', actualizarSimulador);
    $(id).addEventListener('change', actualizarSimulador);
  });

  ['sol-monto', 'sol-plazo', 'sol-frecuencia', 'sol-referente'].forEach((id) => {
    $(id).addEventListener('input', actualizarPrevisualizacionSolicitud);
    $(id).addEventListener('change', actualizarPrevisualizacionSolicitud);
  });

  // Envío de solicitud pública de crédito (RF-16)
  $('form-solicitud-publica').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const payload = {
      nombre: f.nombre.value,
      cedula: f.cedula.value,
      telefono: f.telefono.value,
      email: f.email.value,
      ciudad: f.ciudad.value,
      direccion: f.direccion.value,
      billetera: f.billetera.value,
      codigo_referente: f.codigo_referente.value,
      monto: Number(f.monto.value),
      frecuencia: f.frecuencia.value,
      plazo_meses: Number(f.plazo_meses.value),
      genero: f.genero.value,
      acepto_datos: $('sol-acepto').checked
    };
    try {
      await api('/solicitudes-publicas', { method: 'POST', body: payload });
      $('sol-msg').innerHTML = `<div class="banner-msg ok">Solicitud enviada correctamente. Nuestro equipo la revisará a la brevedad.</div>`;
      f.reset();
    } catch (e) {
      $('sol-msg').innerHTML = `<div class="banner-msg err">${esc(e.message)}</div>`;
    }
  });

  // Login con soporte 2FA
  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = $('login-user').value.trim();
    const password = $('login-pass').value;
    const totp_code = $('login-totp').value.trim();
    try {
      const r = await api('/login', {
        method: 'POST',
        body: { username, password, totp_code: totp_code || undefined }
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem(USER_KEY, JSON.stringify(r.user));
      if (r.requiere_2fa) {
        $('field-login-2fa').classList.remove('hidden');
        $('login-msg').innerHTML = `<div class="banner-msg ok">Ingrese su código de 6 dígitos de doble factor (2FA).</div>`;
        return;
      }
      $('dlg-login').close();
      $('login-msg').innerHTML = '';
      iniciarAppSegunSesion();
    } catch (e) {
      $('login-msg').innerHTML = `<div class="banner-msg err">${esc(e.message)}</div>`;
    }
  });

  // Pestañas del panel cliente
  $('tab-cli-credito').addEventListener('click', () => cambiarSubvistaCliente('credito'));
  $('tab-cli-portafolio').addEventListener('click', () => cambiarSubvistaCliente('portafolio'));
  $('tab-cli-ahorro').addEventListener('click', () => cambiarSubvistaCliente('ahorro'));

  // Pestañas del panel admin
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => cambiarPestanaAdmin(btn.getAttribute('data-admin-tab')));
  });

  // Delegación global de clicks y formularios dinámicos
  document.addEventListener('click', async (ev) => {
    const btnCli = ev.target.closest('[data-ir-cliente]');
    if (btnCli) {
      cambiarSubvistaCliente(btnCli.getAttribute('data-ir-cliente'));
      return;
    }

    const btnRefDet = ev.target.closest('[data-ver-ref-idx]');
    if (btnRefDet && expedienteClienteActual) {
      const idx = Number(btnRefDet.getAttribute('data-ver-ref-idx'));
      const ref = expedienteClienteActual.portafolio_referidos[idx];
      if (ref) {
        $('ref-det-titulo').textContent = `${ref.nombre} · C.C. ${ref.cedula}`;
        $('ref-det-body').innerHTML = `
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">Saldo crédito</div><div class="kpi-val">${fmt(ref.saldo_credito)}</div></div>
            <div class="kpi"><div class="kpi-label">Último reembolso</div><div class="kpi-val">${esc(ref.fecha_ultimo_reembolso)} (${fmt(ref.valor_ultimo_reembolso)})</div></div>
            <div class="kpi"><div class="kpi-label">Próxima fecha de pago</div><div class="kpi-val">${esc(ref.proxima_fecha_pago)}</div></div>
            <div class="kpi"><div class="kpi-label">Disponible para referir</div><div class="kpi-val">${fmt(ref.disponible_para_referir)}</div></div>
          </div>
          <h4 style="margin:12px 0 8px">Movimientos contables del referido</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Cuenta</th><th>Descripción</th><th class="num">Débito</th><th class="num">Crédito</th></tr></thead>
              <tbody>
                ${
                  ref.movimientos.length
                    ? ref.movimientos
                        .map(
                          (m) => `<tr>
                            <td>${esc((m.fecha || '').slice(0, 10))}</td>
                            <td class="num">${esc(m.cuenta)}</td>
                            <td>${esc(m.descripcion || '')}</td>
                            <td class="num">${fmt(m.debito)}</td>
                            <td class="num">${fmt(m.credito)}</td>
                          </tr>`
                        )
                        .join('')
                    : '<tr><td colspan="5" class="hint">Sin movimientos contables registrados.</td></tr>'
                }
              </tbody>
            </table>
          </div>
        `;
        $('dlg-referido-detalle').showModal();
      }
      return;
    }

    const btnIrCedula = ev.target.closest('[data-ir-cedula]');
    if (btnIrCedula) {
      const ced = btnIrCedula.getAttribute('data-ir-cedula');
      cambiarPestanaAdmin('cedula');
      $('input-buscar-cedula').value = ced;
      const exp = await api(`/admin/cedula?cedula=${encodeURIComponent(ced)}`);
      expedienteCajaActual = exp;
      renderizarExpedienteEnCaja(exp);
      return;
    }

    const btnConfirmarPago = ev.target.closest('[data-confirmar-pago]');
    if (btnConfirmarPago) {
      const id = btnConfirmarPago.getAttribute('data-confirmar-pago');
      try {
        const r = await api(`/pagos/${id}/confirmar`, { method: 'POST' });
        mostrarBanner(`Pago confirmado · Ticket ${r.ticket_numero} · Nota ${r.nota_pago}`, true);
        await cargarPanelAdmin();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    const btnCerrarCr = ev.target.closest('[data-cerrar-credito]');
    if (btnCerrarCr) {
      const id = btnCerrarCr.getAttribute('data-cerrar-credito');
      await api(`/creditos/${id}/cerrar`, { method: 'POST' });
      mostrarBanner(`Crédito #${id} cerrado.`, true);
      await cargarPanelAdmin();
      return;
    }

    const btnAtenderSol = ev.target.closest('[data-atender-sol]');
    if (btnAtenderSol) {
      const id = btnAtenderSol.getAttribute('data-atender-sol');
      await api(`/solicitudes/${id}`, { method: 'POST', body: { estado: 'atendida' } });
      await cargarPanelAdmin();
      return;
    }

    const btnPagarRet = ev.target.closest('[data-pagar-retiro]');
    if (btnPagarRet) {
      const id = btnPagarRet.getAttribute('data-pagar-retiro');
      await api(`/retiros/${id}`, { method: 'POST', body: { estado: 'pagado' } });
      mostrarBanner('Retiro aprobado y descontado del fondo de garantías.', true);
      await cargarPanelAdmin();
      return;
    }

    if (ev.target.id === 'btn-disparar-avisos-vencimientos') {
      try {
        const r = await api('/cron/vencimientos', { method: 'POST' });
        mostrarBanner(
          `Barrido completado: ${r.proximas_a_vencer} próximas a vencer, ${r.cuotas_vencidas} vencidas, ${r.notificaciones_procesadas} correos procesados.`,
          true
        );
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (ev.target.id === 'btn-validar-excel') {
      const file = $('file-excel-migracion')?.files?.[0];
      if (!file) {
        mostrarBanner('Seleccione primero el archivo .xlsx o .csv de los 210 clientes.');
        return;
      }
      try {
        filasExcelPendientes = await leerArchivoExcelOCsv(file);
        const r = await api('/migracion/importar', {
          method: 'POST',
          body: { filas: filasExcelPendientes, dry_run: true }
        });
        $('btn-ejecutar-migracion').disabled = r.validos === 0;
        $('migracion-resultado').innerHTML = `
          <div class="banner-msg ${r.errores.length ? 'err' : 'ok'}">
            Validación en seco completada: <strong>${r.validos} clientes válidos</strong> de ${r.total_recibidos} filas leídas · Errores: ${r.errores.length}.
          </div>
        `;
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (ev.target.id === 'btn-ejecutar-migracion') {
      try {
        const r = await api('/migracion/importar', {
          method: 'POST',
          body: { filas: filasExcelPendientes, dry_run: false }
        });
        mostrarBanner(`Migración finalizada: ${r.insertados} nuevos, ${r.actualizados} actualizados.`, true);
        await cargarPanelAdmin();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (ev.target.id === 'btn-limpiar-bd-migracion') {
      if (!window.confirm('¿Dejar la base de datos completamente en blanco (conservando solo el Super Admin y la configuración) lista para migrar el Excel original?')) return;
      await api('/superadmin/limpiar-para-migracion', { method: 'POST' });
      expedienteCajaActual = null;
      mostrarBanner('Base de datos limpia y en blanco, lista para la migración original.', true);
      await cargarPanelAdmin();
      return;
    }

    if (ev.target.id === 'btn-desactivar-2fa') {
      await api('/2fa/desactivar', { method: 'POST' });
      $('dlg-2fa').close();
      mostrarBanner('Doble factor desactivado.', true);
    }
  });

  // Formularios dinámicos por delegación
  document.addEventListener('submit', async (ev) => {
    const f = ev.target;

    if (f.id === 'form-buscar-cedula') {
      ev.preventDefault();
      const cedula = $('input-buscar-cedula').value.trim();
      try {
        const exp = await api(`/admin/cedula?cedula=${encodeURIComponent(cedula)}`);
        expedienteCajaActual = exp;
        renderizarExpedienteEnCaja(exp);
      } catch (e) {
        $('caja-cedula-resultado').innerHTML = `<div class="banner-msg err">${esc(e.message)}</div>`;
      }
      return;
    }

    if (f.id === 'form-caja-registrar-pago') {
      ev.preventDefault();
      const fd = new FormData(f);
      fd.append('credito_id', f.getAttribute('data-credito-id'));
      fd.append('confirmar_inmediato', '1');
      try {
        const r = await api('/pagos', { method: 'POST', body: fd });
        mostrarBanner(
          `Pago confirmado · Ticket ${r.ticket_numero} · Aplicado ${fmt(r.aplicado)} · Nota ${r.nota_pago}`,
          true
        );
        const exp = await api(`/admin/cedula?cedula=${encodeURIComponent(expedienteCajaActual.cliente.cedula)}`);
        expedienteCajaActual = exp;
        await cargarPanelAdmin();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.classList.contains('form-reportar-pago-cliente')) {
      ev.preventDefault();
      const fd = new FormData(f);
      fd.append('credito_id', f.getAttribute('data-credito-id'));
      fd.append('confirmar_inmediato', '0');
      try {
        const r = await api('/pagos', { method: 'POST', body: fd });
        mostrarBanner(`Comprobante enviado · Ticket ${r.ticket_numero} en revisión administrativa.`, true);
        await cargarPanelCliente();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.id === 'form-nuevo-referido-cliente') {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f).entries());
      try {
        await api('/cliente/solicitar-referido', { method: 'POST', body });
        mostrarBanner('Solicitud de nuevo referido enviada.', true);
        f.reset();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.id === 'form-solicitar-retiro') {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f).entries());
      try {
        await api('/cliente/retiros', { method: 'POST', body });
        mostrarBanner('Solicitud de retiro registrada.', true);
        await cargarPanelCliente();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.id === 'form-admin-nuevo-cliente') {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f).entries());
      try {
        const r = await api('/clientes', { method: 'POST', body });
        mostrarBanner(`Cliente creado con código ${r.codigo_personal}.`, true);
        f.reset();
        await cargarPanelAdmin();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.id === 'form-admin-nuevo-credito') {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f).entries());
      try {
        const r = await api('/creditos', { method: 'POST', body });
        mostrarBanner(`Crédito #${r.id} creado · Cuota ${fmt(r.plan.cuota_valor)}.`, true);
        await cargarPanelAdmin();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.id === 'form-superadmin-config') {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f).entries());
      await api('/superadmin/config', { method: 'POST', body });
      mostrarBanner('Configuración actualizada.', true);
      await cargarSuperAdmin();
      return;
    }

    if (f.id === 'form-superadmin-usuario') {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f).entries());
      try {
        await api('/superadmin/usuarios', { method: 'POST', body });
        mostrarBanner('Usuario creado.', true);
        f.reset();
        await cargarSuperAdmin();
      } catch (e) {
        mostrarBanner(e.message);
      }
      return;
    }

    if (f.id === 'form-activar-2fa') {
      ev.preventDefault();
      const code = new FormData(f).get('code');
      try {
        await api('/2fa/activar', { method: 'POST', body: { code } });
        $('dlg-2fa').close();
        mostrarBanner('Doble factor (2FA) activado correctamente.', true);
      } catch (e) {
        mostrarBanner(e.message);
      }
    }
  });

  iniciarAppSegunSesion();
});
