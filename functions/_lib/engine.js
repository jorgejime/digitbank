// =============================================================================
// Motor Financiero y Contable — Financiera Digitbank (PRD v1.0 & QFD Anexo 2)
// =============================================================================

export const CUENTAS_PUC = {
  CARGOS_POR_COBRAR: '134510',
  PRESTAMO_TITULAR: '137010',
  COMISION_POR_PAGAR: '233520',
  USO_PLATAFORMA: '233555',
  FONDO_GARANTIAS: '281020',
  INTERESES_GENERADOS: '415020',
  RENDIMIENTOS_FONDO: '615020',
  BANCO_ENTRADA: '111005'
};

export const PERIODOS_POR_MES = {
  mensual: 1,
  quincenal: 2,
  semanal: 4,
  diaria: 30
};

export const DIAS_POR_FRECUENCIA = {
  mensual: 30,
  quincenal: 15,
  semanal: 7,
  diaria: 1
};

/**
 * Calcula la distribución porcentual de la deducción total del 10% mensual:
 * - Sin referente: Tasa máxima legal + 1% plataforma + resto al fondo = 10%
 * - Con referente: Tasa máxima legal + 1% plataforma + 2% referente + resto al fondo = 10%
 */
export function calcularRepartoTasas({ tasaMaximaLegal, tieneReferente }) {
  const t = Number(tasaMaximaLegal);
  if (!Number.isFinite(t) || t <= 0 || t > 7) {
    throw new Error('La tasa máxima legal mensual debe estar entre 0.1% y 7.0%');
  }
  const pctPlataforma = 1;
  const pctReferente = tieneReferente ? 2 : 0;
  const deduccionTotal = 10;
  const pctFondo = Number((deduccionTotal - t - pctPlataforma - pctReferente).toFixed(4));
  if (pctFondo < 0) {
    throw new Error('La tasa máxima legal supera el margen disponible dentro del 10%');
  }
  return {
    tasaMaximaLegal: t,
    pctPlataforma,
    pctReferente,
    pctFondo,
    deduccionTotal
  };
}

/**
 * Avanza una fecha YYYY-MM-DD según la frecuencia del crédito y el número de periodo (1..N)
 */
export function calcularFechaVencimiento(fechaInicioStr, frecuencia, numeroPeriodo) {
  const [y, m, d] = fechaInicioStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  if (frecuencia === 'mensual') {
    const targetMonth = (m - 1) + numeroPeriodo;
    const ty = y + Math.floor(targetMonth / 12);
    const tm = ((targetMonth % 12) + 12) % 12;
    const maxDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    const dt = new Date(Date.UTC(ty, tm, Math.min(d, maxDay)));
    return dt.toISOString().slice(0, 10);
  }
  const dias = (DIAS_POR_FRECUENCIA[frecuencia] || 30) * numeroPeriodo;
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/**
 * Genera el plan completo de cuotas con amortización francesa sobre la deducción total del 10% mensual
 * prorrateada según la frecuencia de pago. Lo que sobre de la deducción total del 10% se va a capital.
 */
export function generarPlanCuotas({
  monto,
  plazoMeses,
  frecuencia = 'mensual',
  tasaMaximaLegal,
  tieneReferente = false,
  fechaInicio
}) {
  const M = Math.round(Number(monto));
  const meses = Math.round(Number(plazoMeses));
  if (!Number.isFinite(M) || M < 500000 || M > 2000000) {
    throw new Error('El monto del crédito debe estar entre $500.000 y $2.000.000 COP');
  }
  if (!Number.isFinite(meses) || meses < 1 || meses > 24) {
    throw new Error('El plazo debe estar entre 1 y 24 meses');
  }
  const k = PERIODOS_POR_MES[frecuencia];
  if (!k) {
    throw new Error('Frecuencia inválida. Use diaria, semanal, quincenal o mensual');
  }

  const tasas = calcularRepartoTasas({ tasaMaximaLegal, tieneReferente });
  const numCuotas = meses * k;
  const rTotal = (tasas.deduccionTotal / 100) / k; // 0.10 / k
  const rInteres = (tasas.tasaMaximaLegal / 100) / k;
  const rFondo = (tasas.pctFondo / 100) / k;
  const rPlat = (tasas.pctPlataforma / 100) / k;
  const rRef = (tasas.pctReferente / 100) / k;

  // Cuota fija francesa
  const factor = Math.pow(1 + rTotal, numCuotas);
  const cuotaFija = Math.round((M * rTotal * factor) / (factor - 1));

  const inicio = fechaInicio || new Date().toISOString().slice(0, 10);
  const cuotas = [];
  let saldo = M;
  let totalInteres = 0;
  let totalFondo = 0;
  let totalPlataforma = 0;
  let totalReferente = 0;
  let totalCuotas = 0;

  for (let i = 1; i <= numCuotas; i++) {
    const saldoInicial = saldo;
    const interes = Math.round(saldoInicial * rInteres);
    const plataforma = Math.round(saldoInicial * rPlat);
    const referente = tieneReferente ? Math.round(saldoInicial * rRef) : 0;
    const deduccionTotalPesos = Math.round(saldoInicial * rTotal);
    const fondo = Math.max(0, deduccionTotalPesos - interes - plataforma - referente);

    let capital;
    let cuota;
    if (i === numCuotas) {
      capital = saldoInicial;
      cuota = capital + interes + fondo + plataforma + referente;
    } else {
      // Lo que sobre de la deducción total del 10% se va a capital del crédito
      capital = Math.max(0, cuotaFija - (interes + fondo + plataforma + referente));
      if (capital > saldoInicial) capital = saldoInicial;
      cuota = capital + interes + fondo + plataforma + referente;
    }
    const saldoFinal = Math.max(0, saldoInicial - capital);
    const fechaVencimiento = calcularFechaVencimiento(inicio, frecuencia, i);

    cuotas.push({
      numero: i,
      fecha_vencimiento: fechaVencimiento,
      saldo_inicial: saldoInicial,
      interes,
      fondo,
      plataforma,
      referente,
      capital,
      cuota,
      saldo_final: saldoFinal,
      pagado: 0,
      estado: 'pendiente'
    });

    saldo = saldoFinal;
    totalInteres += interes;
    totalFondo += fondo;
    totalPlataforma += plataforma;
    totalReferente += referente;
    totalCuotas += cuota;
  }

  return {
    monto: M,
    plazo_meses: meses,
    frecuencia,
    num_cuotas: numCuotas,
    cuota_valor: cuotaFija,
    fecha_inicio: inicio,
    tasas,
    totales: {
      capital: M,
      interes: totalInteres,
      fondo: totalFondo,
      plataforma: totalPlataforma,
      referente: totalReferente,
      total_pagar: totalCuotas
    },
    cuotas
  };
}

/**
 * RF-14: Calcula la nota de un pago en tiempo real (escala 1.0 a 5.0) con dos variables:
 * 1) Valor pagado frente al valor sugerido de la cuota (peso 50%)
 * 2) Tiempo de pago frente a la frecuencia del crédito (peso 50%)
 */
export function calcularNotaPago({
  valorPagado,
  valorSugerido,
  fechaVencimiento,
  fechaPago,
  frecuencia = 'mensual'
}) {
  const pagado = Number(valorPagado) || 0;
  const sugerido = Math.max(1, Number(valorSugerido) || 1);

  // 1) Cumplimiento en valor (hasta 1.0 = 5.0)
  const ratioValor = Math.min(1, Math.max(0, pagado / sugerido));
  const notaValor = 1 + 4 * ratioValor;

  // 2) Cumplimiento en tiempo frente a la ventana de la frecuencia
  const ventanaDias = DIAS_POR_FRECUENCIA[frecuencia] || 30;
  let diasAtraso = 0;
  if (fechaVencimiento && fechaPago) {
    const fv = Date.parse(fechaVencimiento.slice(0, 10) + 'T00:00:00Z');
    const fp = Date.parse(fechaPago.slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(fv) && Number.isFinite(fp)) {
      diasAtraso = Math.max(0, Math.round((fp - fv) / 86400000));
    }
  }
  const penalizacionTiempo = Math.min(1, diasAtraso / Math.max(1, ventanaDias));
  const notaTiempo = 5 - 4 * penalizacionTiempo;

  const nota = Number(((notaValor * 0.5) + (notaTiempo * 0.5)).toFixed(2));
  return Math.min(5, Math.max(1, nota));
}

/**
 * RF-13: Calcula el ahorro disponible para retiro del fondo de garantías.
 * Regla PRD: "solo se puede retirar lo que sobre del 200% del total del cupo referido".
 */
export function calcularRetiroDisponible({ saldoFondoGarantias, cupoTotalReferido }) {
  const fondo = Math.max(0, Math.round(Number(saldoFondoGarantias) || 0));
  const cupoRef = Math.max(0, Math.round(Number(cupoTotalReferido) || 0));
  const retencionRequerida = cupoRef * 2; // 200% del cupo total referido
  const disponibleRetiro = Math.max(0, fondo - retencionRequerida);
  return {
    saldo_fondo: fondo,
    cupo_total_referido: cupoRef,
    umbral_200_pct: retencionRequerida,
    disponible_retiro: disponibleRetiro
  };
}

/**
 * Distribuye un pago confirmado entre las cuotas pendientes/parciales en orden cronológico
 * y devuelve el desglose acreditado por concepto contable (interés, fondo, plataforma, referente, capital).
 */
export function aplicarPagoACuotas(cuotasPendientes, montoPago, fechaPago, frecuencia = 'mensual') {
  let restante = Math.round(Number(montoPago) || 0);
  if (restante <= 0) throw new Error('El monto del pago debe ser mayor a cero');

  let totalInteres = 0;
  let totalFondo = 0;
  let totalPlataforma = 0;
  let totalReferente = 0;
  let totalCapital = 0;
  let totalAplicado = 0;
  const cuotasActualizadas = [];
  const notasCuotas = [];

  for (const q of cuotasPendientes) {
    if (restante <= 0) break;
    const faltanteCuota = Math.max(0, q.cuota - q.pagado);
    if (faltanteCuota === 0) continue;

    const abono = Math.min(restante, faltanteCuota);
    const nuevoPagado = q.pagado + abono;
    const proporcion = nuevoPagado / q.cuota;

    const intTotal = nuevoPagado === q.cuota ? q.interes : Math.round(q.interes * proporcion);
    const fonTotal = nuevoPagado === q.cuota ? q.fondo : Math.round(q.fondo * proporcion);
    const plaTotal = nuevoPagado === q.cuota ? q.plataforma : Math.round(q.plataforma * proporcion);
    const refTotal = nuevoPagado === q.cuota ? q.referente : Math.round(q.referente * proporcion);
    const capTotal = Math.max(0, nuevoPagado - intTotal - fonTotal - plaTotal - refTotal);

    const deltaInt = Math.max(0, intTotal - (q.interes_acreditado || 0));
    const deltaFon = Math.max(0, fonTotal - (q.fondo_acreditado || 0));
    const deltaPla = Math.max(0, plaTotal - (q.plataforma_acreditado || 0));
    const deltaRef = Math.max(0, refTotal - (q.referente_acreditado || 0));
    const deltaCap = Math.max(0, capTotal - (q.capital_acreditado || 0));

    const estado = nuevoPagado >= q.cuota ? 'pagada' : 'parcial';
    const notaCuota = calcularNotaPago({
      valorPagado: nuevoPagado,
      valorSugerido: q.cuota,
      fechaVencimiento: q.fecha_vencimiento,
      fechaPago,
      frecuencia
    });

    cuotasActualizadas.push({
      id: q.id,
      numero: q.numero,
      pagado: nuevoPagado,
      interes_acreditado: intTotal,
      fondo_acreditado: fonTotal,
      plataforma_acreditado: plaTotal,
      referente_acreditado: refTotal,
      capital_acreditado: capTotal,
      estado,
      fecha_pago: fechaPago,
      nota_cuota: notaCuota
    });

    notasCuotas.push(notaCuota);
    totalInteres += deltaInt;
    totalFondo += deltaFon;
    totalPlataforma += deltaPla;
    totalReferente += deltaRef;
    totalCapital += deltaCap;
    totalAplicado += abono;
    restante -= abono;
  }

  const notaPago = notasCuotas.length
    ? Number((notasCuotas.reduce((a, b) => a + b, 0) / notasCuotas.length).toFixed(2))
    : 5.0;

  return {
    monto: Math.round(Number(montoPago)),
    aplicado: totalAplicado,
    excedente: restante,
    desglose: {
      interes: totalInteres,
      fondo: totalFondo,
      plataforma: totalPlataforma,
      referente: totalReferente,
      capital: totalCapital
    },
    nota_pago: notaPago,
    cuotas_actualizadas: cuotasActualizadas
  };
}
