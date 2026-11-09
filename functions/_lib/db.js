// =============================================================================
// Capa de Datos y Consultas Integrales D1 — Financiera Digitbank (PRD §7.1, §7.2)
// =============================================================================

import { CUENTAS_PUC, calcularRetiroDisponible } from './engine.js';

export function fmtCOP(val) {
  return '$' + Math.round(Number(val) || 0).toLocaleString('es-CO');
}

export async function registrarBitacora(db, { usuario_id = null, usuario_nombre = null, accion, detalle = '', ip = '' }) {
  try {
    await db
      .prepare('INSERT INTO bitacora (usuario_id, usuario_nombre, accion, detalle, ip) VALUES (?, ?, ?, ?, ?)')
      .bind(usuario_id, usuario_nombre, accion, String(detalle).slice(0, 500), ip)
      .run();
  } catch {
    // Bitácora no bloqueante
  }
}

/**
 * Registra asientos contables de apertura de crédito según el Plan de Cuentas PRD §7.2
 */
export async function contabilizarAperturaCredito(db, { credito, plan }) {
  const stmts = [
    // 137010 Préstamo al titular del crédito (Capital desembolsado)
    db
      .prepare(
        'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, descripcion) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(credito.id, credito.cliente_id, CUENTAS_PUC.PRESTAMO_TITULAR, plan.monto, 0, `Apertura crédito #${credito.id} · Capital`),
    // 134510 Cargos pendientes por cobrar al titular (Total cargos 10% programados)
    db
      .prepare(
        'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, descripcion) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        credito.id,
        credito.cliente_id,
        CUENTAS_PUC.CARGOS_POR_COBRAR,
        plan.totales.total_pagar - plan.monto,
        0,
        `Apertura crédito #${credito.id} · Cargos programados (10%)`
      )
  ];
  await db.batch(stmts);
}

/**
 * Registra asientos contables al confirmar un pago en las 8 cuentas del PRD §7.2
 */
export async function contabilizarPagoConfirmado(db, { pago, credito, desglose, referenteClienteId = null }) {
  const stmts = [];
  const descBase = `Pago #${pago.id} (${pago.ticket_numero}) · Crédito #${credito.id}`;

  // 111005 Banco por donde entró el dinero (Débito por el total entrante)
  stmts.push(
    db
      .prepare(
        'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(credito.id, credito.cliente_id, CUENTAS_PUC.BANCO_ENTRADA, pago.monto, 0, pago.id, `${descBase} · Entrada banco`)
  );

  // 137010 Abono a préstamo del titular (Crédito a capital)
  if (desglose.capital > 0) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(credito.id, credito.cliente_id, CUENTAS_PUC.PRESTAMO_TITULAR, 0, desglose.capital, pago.id, `${descBase} · Abono capital`)
    );
  }

  // 134510 Reducción de cargos pendientes por cobrar al titular
  const cargosCobrados = desglose.interes + desglose.fondo + desglose.plataforma + desglose.referente;
  if (cargosCobrados > 0) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(credito.id, credito.cliente_id, CUENTAS_PUC.CARGOS_POR_COBRAR, 0, cargosCobrados, pago.id, `${descBase} · Cobro cargos`)
    );
  }

  // 415020 Intereses generados al titular
  if (desglose.interes > 0) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(credito.id, credito.cliente_id, CUENTAS_PUC.INTERESES_GENERADOS, 0, desglose.interes, pago.id, `${descBase} · Intereses`)
    );
  }

  // 281020 Fondo para garantías crediticias del titular
  if (desglose.fondo > 0) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(credito.id, credito.cliente_id, CUENTAS_PUC.FONDO_GARANTIAS, 0, desglose.fondo, pago.id, `${descBase} · Aporte fondo garantías`)
    );
  }

  // 233555 Uso de plataforma (1%)
  if (desglose.plataforma > 0) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(credito.id, credito.cliente_id, CUENTAS_PUC.USO_PLATAFORMA, 0, desglose.plataforma, pago.id, `${descBase} · Uso plataforma 1%`)
    );
  }

  // 233520 Comisión por pagar al referente (2%)
  if (desglose.referente > 0) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO movimientos (credito_id, cliente_id, cuenta, debito, credito, pago_id, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          credito.id,
          referenteClienteId || credito.cliente_id,
          CUENTAS_PUC.COMISION_POR_PAGAR,
          0,
          desglose.referente,
          pago.id,
          `${descBase} · Comisión referente 2%`
        )
    );
  }

  if (stmts.length) await db.batch(stmts);
}

/**
 * PRD §7.1 y RF-04 / RF-15: Obtiene la radiografía completa de un cliente (por id o por cédula):
 * - Datos personales completos
 * - Estado completo del crédito activo e historial
 * - Las 8 cuentas contables discriminadas
 * - Nota del último pago, nota promedio acumulada, nota promedio de su grupo de referidos directos
 * - Cupo personal, disponible para crédito personal, disponible para referir
 * - Saldo del crédito, saldo del valor referido, saldo del fondo de garantías
 * - Fecha y valor sugerido del próximo pago, fecha y valor del último reembolso, saldo anterior
 * - Código de quien lo refiere, código personal, cuotas pagadas y faltantes
 * - Árbol de referidos DIRECTOS únicamente (RF-08: no expone referidos de segundo nivel)
 */
export async function obtenerExpedienteCliente(db, { clienteId = null, cedula = null }) {
  const cliente = clienteId
    ? await db.prepare('SELECT * FROM clientes WHERE id = ?').bind(clienteId).first()
    : await db.prepare('SELECT * FROM clientes WHERE cedula = ?').bind(String(cedula || '').trim()).first();

  if (!cliente) return null;

  // Referente directo (quien lo refirió)
  const referente = cliente.referido_por_id
    ? await db
        .prepare('SELECT id, nombre, cedula, codigo_personal FROM clientes WHERE id = ?')
        .bind(cliente.referido_por_id)
        .first()
    : null;

  // Créditos del cliente
  const { results: creditos } = await db
    .prepare('SELECT * FROM creditos WHERE cliente_id = ? ORDER BY id DESC')
    .bind(cliente.id)
    .all();

  const creditosDetallados = [];
  let saldoCreditoTotal = 0;
  let cuotasPagadasTotal = 0;
  let cuotasFaltantesTotal = 0;
  let proximoPagoFecha = null;
  let proximoPagoValor = 0;
  let ultimaFechaPago = null;
  let saldoAnterior = 0;

  for (const cr of creditos) {
    const { results: cuotas } = await db
      .prepare('SELECT * FROM cuotas WHERE credito_id = ? ORDER BY numero ASC')
      .bind(cr.id)
      .all();

    const pagadas = cuotas.filter((q) => q.estado === 'pagada').length;
    const faltantes = cuotas.length - pagadas;
    const proxima = cuotas.find((q) => q.estado !== 'pagada') || null;
    const ultimaPagada = [...cuotas].reverse().find((q) => q.pagado > 0) || null;

    if (cr.estado === 'activo') {
      saldoCreditoTotal += Number(cr.saldo_capital || 0);
      cuotasPagadasTotal += pagadas;
      cuotasFaltantesTotal += faltantes;
      if (proxima && (!proximoPagoFecha || proxima.fecha_vencimiento < proximoPagoFecha)) {
        proximoPagoFecha = proxima.fecha_vencimiento;
        proximoPagoValor = Math.max(0, proxima.cuota - proxima.pagado);
      }
      if (ultimaPagada?.fecha_pago) {
        ultimaFechaPago = ultimaPagada.fecha_pago;
      }
      saldoAnterior += Number(cr.saldo_anterior || cr.monto || 0);
    }

    creditosDetallados.push({
      ...cr,
      cuotas_pagadas: pagadas,
      cuotas_faltantes: faltantes,
      proxima_cuota: proxima,
      cuotas
    });
  }

  // Pagos del cliente
  const { results: pagos } = await db
    .prepare(
      `SELECT p.*, s.id AS soporte_id, s.nombre AS soporte_nombre
       FROM pagos p
       LEFT JOIN soportes s ON s.pago_id = p.id
       WHERE p.cliente_id = ?
       ORDER BY p.id DESC`
    )
    .bind(cliente.id)
    .all();

  // Plan de cuentas discriminado para el cliente (PRD §7.2)
  const { results: todasCuentas } = await db.prepare('SELECT codigo, concepto FROM cuentas ORDER BY codigo ASC').all();
  const { results: sumasCuentas } = await db
    .prepare(
      `SELECT cuenta, SUM(debito) AS total_debito, SUM(credito) AS total_credito
       FROM movimientos
       WHERE cliente_id = ?
       GROUP BY cuenta`
    )
    .bind(cliente.id)
    .all();

  const mapaCuentas = new Map(sumasCuentas.map((r) => [r.cuenta, r]));
  const planCuentas = todasCuentas.map((c) => {
    const mov = mapaCuentas.get(c.codigo) || { total_debito: 0, total_credito: 0 };
    const debito = Number(mov.total_debito || 0);
    const credito = Number(mov.total_credito || 0);
    const saldoNeto = c.codigo.startsWith('1') ? debito - credito : credito - debito;
    return {
      codigo: c.codigo,
      concepto: c.concepto,
      debito,
      credito,
      valor: Math.abs(saldoNeto)
    };
  });

  // RF-08 y RF-15: Referidos DIRECTOS únicamente
  const { results: referidosDirectosRaw } = await db
    .prepare('SELECT * FROM clientes WHERE referido_por_id = ? ORDER BY id DESC')
    .bind(cliente.id)
    .all();

  const referidosDirectos = [];
  let cupoTotalReferido = 0;
  let saldoValorReferido = 0;
  const notasGrupo = [];

  for (const ref of referidosDirectosRaw) {
    const { results: credsRef } = await db
      .prepare('SELECT * FROM creditos WHERE cliente_id = ? ORDER BY id DESC')
      .bind(ref.id)
      .all();

    let saldoRef = 0;
    let proxFechaRef = null;
    let proxValorRef = 0;
    let ultFechaPagoRef = null;

    for (const crRef of credsRef) {
      if (crRef.estado === 'activo') {
        saldoRef += Number(crRef.saldo_capital || 0);
      }
      const { results: cuotasRef } = await db
        .prepare('SELECT * FROM cuotas WHERE credito_id = ? ORDER BY numero ASC')
        .bind(crRef.id)
        .all();
      const prox = cuotasRef.find((q) => q.estado !== 'pagada');
      if (prox && (!proxFechaRef || prox.fecha_vencimiento < proxFechaRef)) {
        proxFechaRef = prox.fecha_vencimiento;
        proxValorRef = Math.max(0, prox.cuota - prox.pagado);
      }
      const ult = [...cuotasRef].reverse().find((q) => q.pagado > 0);
      if (ult?.fecha_pago) ultFechaPagoRef = ult.fecha_pago;
    }

    const { results: movsRef } = await db
      .prepare(
        `SELECT m.*, c.concepto AS cuenta_concepto
         FROM movimientos m
         LEFT JOIN cuentas c ON c.codigo = m.cuenta
         WHERE m.cliente_id = ?
         ORDER BY m.id DESC LIMIT 20`
      )
      .bind(ref.id)
      .all();

    cupoTotalReferido += Number(ref.cupo_personal || 0);
    saldoValorReferido += saldoRef;
    notasGrupo.push(Number(ref.nota_promedio || 5.0));

    referidosDirectos.push({
      id: ref.id,
      nombre: ref.nombre,
      cedula: ref.cedula,
      telefono: ref.telefono,
      codigo_personal: ref.codigo_personal,
      cupo_personal: ref.cupo_personal,
      saldo_credito: saldoRef,
      fecha_ultimo_reembolso: ref.fecha_ultimo_reembolso || ultFechaPagoRef || '—',
      valor_ultimo_reembolso: ref.valor_ultimo_reembolso || 0,
      ultima_fecha_pago: ultFechaPagoRef || '—',
      proxima_fecha_pago: proxFechaRef || '—',
      proximo_valor_pago: proxValorRef,
      disponible_para_referir: ref.saldo_disp_referir || 0,
      saldo_fondo_garantias: ref.saldo_fondo_garantias || 0,
      nota_promedio: Number(ref.nota_promedio || 5.0),
      creditos: credsRef,
      movimientos: movsRef
    });
  }

  const notaPromedioGrupo = notasGrupo.length
    ? Number((notasGrupo.reduce((a, b) => a + b, 0) / notasGrupo.length).toFixed(2))
    : Number(cliente.nota_grupo || 5.0);

  // RF-13: Cálculo de retiro disponible sobre el 200% del cupo total referido
  const retiroInfo = calcularRetiroDisponible({
    saldoFondoGarantias: cliente.saldo_fondo_garantias,
    cupoTotalReferido
  });

  const { results: retiros } = await db
    .prepare('SELECT * FROM retiros WHERE cliente_id = ? ORDER BY id DESC')
    .bind(cliente.id)
    .all();

  const disponibleCreditoPersonal = Math.max(0, Number(cliente.cupo_personal || 0) - saldoCreditoTotal);

  return {
    cliente: {
      ...cliente,
      codigo_referente: referente ? referente.codigo_personal : null,
      nombre_referente: referente ? referente.nombre : null
    },
    estado_credito: {
      nota_pago: Number(cliente.nota_pago || 5.0),
      nota_promedio: Number(cliente.nota_promedio || 5.0),
      nota_grupo: notaPromedioGrupo,
      cupo_personal: Number(cliente.cupo_personal || 0),
      disponible_credito_personal: disponibleCreditoPersonal,
      disponible_para_referir: Number(cliente.saldo_disp_referir || 0),
      saldo_credito: saldoCreditoTotal,
      saldo_valor_referido: saldoValorReferido,
      cupo_total_referido: cupoTotalReferido,
      saldo_fondo_garantias: Number(cliente.saldo_fondo_garantias || 0),
      proximo_pago_fecha: proximoPagoFecha || 'Sin vencimientos',
      proximo_pago_valor: proximoPagoValor,
      ultima_fecha_pago: ultimaFechaPago || cliente.fecha_ultimo_reembolso || '—',
      codigo_referente: referente ? referente.codigo_personal : 'DIRECTO',
      nombre_referente: referente ? referente.nombre : 'Sin referente',
      codigo_personal: cliente.codigo_personal,
      cuotas_pagadas: cuotasPagadasTotal,
      cuotas_faltantes: cuotasFaltantesTotal,
      fecha_ultimo_reembolso: cliente.fecha_ultimo_reembolso || ultimaFechaPago || '—',
      valor_ultimo_reembolso: Number(cliente.valor_ultimo_reembolso || 0),
      saldo_anterior: saldoAnterior,
      numero_referidos: referidosDirectos.length
    },
    retiro_ahorro: retiroInfo,
    retiros,
    plan_cuentas: planCuentas,
    creditos: creditosDetallados,
    pagos,
    portafolio_referidos: referidosDirectos
  };
}
