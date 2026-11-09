import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularRepartoTasas,
  generarPlanCuotas,
  calcularNotaPago,
  calcularRetiroDisponible,
  aplicarPagoACuotas
} from '../functions/_lib/engine.js';

test('Reparto del 10% sin referente: tasa máxima + 1% plataforma + resto al fondo = 10%', () => {
  const r = calcularRepartoTasas({ tasaMaximaLegal: 2.3, tieneReferente: false });
  assert.equal(r.tasaMaximaLegal, 2.3);
  assert.equal(r.pctPlataforma, 1);
  assert.equal(r.pctReferente, 0);
  assert.equal(r.pctFondo, 6.7);
  assert.equal(r.tasaMaximaLegal + r.pctPlataforma + r.pctReferente + r.pctFondo, 10);
});

test('Reparto del 10% con referente: tasa máxima + 1% plataforma + 2% referente + resto al fondo = 10%', () => {
  const r = calcularRepartoTasas({ tasaMaximaLegal: 3.0, tieneReferente: true });
  assert.equal(r.tasaMaximaLegal, 3.0);
  assert.equal(r.pctPlataforma, 1);
  assert.equal(r.pctReferente, 2);
  assert.equal(r.pctFondo, 4.0);
  assert.equal(r.tasaMaximaLegal + r.pctPlataforma + r.pctReferente + r.pctFondo, 10);
});

test('Generación de plan de cuotas en las 4 frecuencias (mensual, quincenal, semanal, diaria)', () => {
  for (const [frec, mult] of [['mensual', 1], ['quincenal', 2], ['semanal', 4], ['diaria', 30]]) {
    const plan = generarPlanCuotas({
      monto: 1000000,
      plazoMeses: 6,
      frecuencia: frec,
      tasaMaximaLegal: 2.5,
      tieneReferente: true,
      fechaInicio: '2026-11-09'
    });
    assert.equal(plan.num_cuotas, 6 * mult);
    assert.equal(plan.cuotas.length, 6 * mult);
    assert.equal(plan.cuotas.at(-1).saldo_final, 0);
    const sumaCapital = plan.cuotas.reduce((acc, q) => acc + q.capital, 0);
    assert.equal(sumaCapital, 1000000);
  }
});

test('RF-13: Retiro del ahorro disponible solo sobre el 200% del cupo total referido', () => {
  // Cliente con $1.500.000 en fondo y $500.000 de cupo referido => 200% = $1.000.000 => puede retirar $500.000
  const r1 = calcularRetiroDisponible({ saldoFondoGarantias: 1500000, cupoTotalReferido: 500000 });
  assert.equal(r1.umbral_200_pct, 1000000);
  assert.equal(r1.disponible_retiro, 500000);

  // Cliente con $800.000 en fondo y $500.000 de cupo referido => no supera el 200% => disponible 0
  const r2 = calcularRetiroDisponible({ saldoFondoGarantias: 800000, cupoTotalReferido: 500000 });
  assert.equal(r2.disponible_retiro, 0);
});

test('RF-14: Nota del crédito en tiempo real (valor pagado vs sugerido y tiempo vs frecuencia)', () => {
  // Pago puntual y completo => 5.0
  const n1 = calcularNotaPago({
    valorPagado: 200000,
    valorSugerido: 200000,
    fechaVencimiento: '2026-11-10',
    fechaPago: '2026-11-10',
    frecuencia: 'mensual'
  });
  assert.equal(n1, 5.0);

  // Pago a mitad de valor y con 15 días de atraso en frecuencia mensual => 3.0
  const n2 = calcularNotaPago({
    valorPagado: 100000,
    valorSugerido: 200000,
    fechaVencimiento: '2026-11-01',
    fechaPago: '2026-11-16',
    frecuencia: 'mensual'
  });
  assert.equal(n2, 3.0);
});

test('Aplicación de pago a cuotas y desglose contable', () => {
  const plan = generarPlanCuotas({
    monto: 500000,
    plazoMeses: 1,
    frecuencia: 'mensual',
    tasaMaximaLegal: 3,
    tieneReferente: true,
    fechaInicio: '2026-11-01'
  });
  const res = aplicarPagoACuotas(
    plan.cuotas.map((q, idx) => ({ ...q, id: idx + 1 })),
    plan.cuotas[0].cuota,
    '2026-12-01',
    'mensual'
  );
  assert.equal(res.aplicado, 550000);
  assert.equal(res.excedente, 0);
  assert.equal(res.desglose.interes, 15000);
  assert.equal(res.desglose.plataforma, 5000);
  assert.equal(res.desglose.referente, 10000);
  assert.equal(res.desglose.fondo, 20000);
  assert.equal(res.desglose.capital, 500000);
});
