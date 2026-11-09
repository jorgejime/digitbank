// =============================================================================
// API Integral Financiera Digitbank — Cloudflare Pages Function (/api/*)
// Cumple las 16 funciones del PRD v1.0 y la Casa de la Calidad QFD (Anexo 2)
// =============================================================================

import {
  generarPlanCuotas,
  aplicarPagoACuotas,
  calcularRetiroDisponible,
  CUENTAS_PUC
} from '../_lib/engine.js';
import {
  hashPassword,
  verifyPassword,
  generarTokenSesion,
  generarSecretoTOTP,
  generarCodigoTOTP,
  verificarCodigoTOTP
} from '../_lib/crypto.js';
import { enviarNotificacion, obtenerCorreosAdmin } from '../_lib/email.js';
import {
  fmtCOP,
  registrarBitacora,
  contabilizarAperturaCredito,
  contabilizarPagoConfirmado,
  obtenerExpedienteCliente
} from '../_lib/db.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

async function ensureBootstrapAdmin(env) {
  const adminUser = env.ADMIN_USER || 'adminfdigitb';
  const existing = await env.DB.prepare('SELECT id FROM usuarios WHERE usuario = ?').bind(adminUser).first();
  if (!existing) {
    const initialPass = env.ADMIN_PASSWORD || 'Digitbank2026!';
    const hashed = await hashPassword(initialPass);
    await env.DB.prepare(
      'INSERT INTO usuarios (usuario, nombre, email, password_hash, rol, activo) VALUES (?, ?, ?, ?, ?, 1)'
    )
      .bind(adminUser, 'Mario de Jesús González · Super Admin', 'financieradigitbank@gmail.com', hashed, 'superadmin')
      .run();
  }
}

async function autenticar(request, env, { permitirSin2FA = false } = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;

  const ses = await env.DB.prepare(
    `SELECT s.token, s.verificado_2fa, s.expira_en,
            u.id, u.usuario, u.nombre, u.email, u.rol, u.permisos_json, u.cliente_id, u.totp_secret, u.totp_activo, u.activo
     FROM sesiones s
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = ?`
  )
    .bind(token)
    .first();

  if (!ses || !ses.activo) return null;
  if (new Date(ses.expira_en).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sesiones WHERE token = ?').bind(token).run();
    return null;
  }
  if (!permitirSin2FA && !ses.verificado_2fa) {
    return { requiere_2fa: true, ...ses };
  }
  return ses;
}

function esRolAdmin(rol) {
  return ['admin', 'superadmin', 'usuario1', 'usuario2', 'usuario3'].includes(rol);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const segments = (params.route || []).map((s) => String(s));
  const path = '/' + segments.join('/');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';

  try {
    await ensureBootstrapAdmin(env);

    // -------------------------------------------------------------------------
    // 1. SIMULADOR PÚBLICO / INTERNO (RF-12)
    // -------------------------------------------------------------------------
    if (path === '/simulador' && (method === 'POST' || method === 'GET')) {
      const payload =
        method === 'POST'
          ? await request.json()
          : {
              monto: url.searchParams.get('monto') || 1000000,
              plazo_meses: url.searchParams.get('plazo_meses') || 12,
              frecuencia: url.searchParams.get('frecuencia') || 'mensual',
              tasa_maxima_legal: url.searchParams.get('tasa_maxima_legal') || 2.3,
              tiene_referente: url.searchParams.get('tiene_referente') === '1'
            };

      const cfgTasa = await env.DB.prepare("SELECT valor FROM configuracion WHERE clave = 'tasa_maxima_default'").first();
      const plan = generarPlanCuotas({
        monto: payload.monto,
        plazoMeses: payload.plazo_meses,
        frecuencia: payload.frecuencia || 'mensual',
        tasaMaximaLegal: payload.tasa_maxima_legal ?? Number(cfgTasa?.valor || 2.3),
        tieneReferente: Boolean(payload.tiene_referente),
        fechaInicio: payload.fecha_inicio
      });
      return json(plan);
    }

    // -------------------------------------------------------------------------
    // 2. SOLICITUD DE CRÉDITO PÚBLICA — CLIENTE NUEVO (RF-16)
    // -------------------------------------------------------------------------
    if (path === '/solicitudes-publicas' && method === 'POST') {
      const b = await request.json();
      const nombre = String(b.nombre || '').trim();
      const cedula = String(b.cedula || '').trim();
      const telefono = String(b.telefono || '').trim();
      const email = String(b.email || '').trim();
      const monto = Math.round(Number(b.monto || 0));
      const plazo_meses = Math.round(Number(b.plazo_meses || 12));
      const frecuencia = String(b.frecuencia || 'mensual');
      const codigo_referente = String(b.codigo_referente || '').trim() || null;

      if (!nombre || !cedula || !telefono) {
        return err('Nombre, cédula y teléfono son obligatorios');
      }
      if (monto < 500000 || monto > 2000000) {
        return err('El valor solicitado debe estar entre $500.000 y $2.000.000 COP');
      }
      if (!b.acepto_datos) {
        return err('Debe autorizar el tratamiento de datos personales conforme a la Ley 1581 de 2012');
      }

      const res = await env.DB.prepare(
        `INSERT INTO solicitudes
         (tipo, nombre, cedula, genero, telefono, whatsapp, direccion, ciudad, email, billetera, monto, plazo_meses, frecuencia, codigo_referente, acepto_datos, acepto_en, estado)
         VALUES ('credito', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), 'nueva')`
      )
        .bind(
          nombre,
          cedula,
          b.genero || null,
          telefono,
          b.whatsapp || telefono,
          b.direccion || null,
          b.ciudad || null,
          email || null,
          b.billetera || null,
          monto,
          plazo_meses,
          frecuencia,
          codigo_referente
        )
        .run();

      await registrarBitacora(env.DB, {
        accion: 'solicitud_credito_publica',
        detalle: `Solicitud #${res.meta.last_row_id} · ${nombre} (${cedula}) · ${fmtCOP(monto)} (${frecuencia})`,
        ip
      });

      const admins = await obtenerCorreosAdmin(env.DB);
      await enviarNotificacion(env, {
        tipo: 'nueva_solicitud',
        destinatarios: [...admins, email].filter(Boolean),
        asunto: `Solicitud de crédito recibida · ${nombre}`,
        subtitulo: 'Hemos registrado la solicitud de crédito en Financiera Digitbank.',
        filas: [
          ['Solicitante', `${nombre} (C.C. ${cedula})`],
          ['Valor solicitado', fmtCOP(monto)],
          ['Frecuencia y plazo', `${frecuencia} · ${plazo_meses} meses`],
          ['Código referente', codigo_referente || 'Directo']
        ]
      });

      return json({ ok: true, id: res.meta.last_row_id });
    }

    // -------------------------------------------------------------------------
    // 3. AUTENTICACIÓN Y DOBLE FACTOR 2FA (PRD §8)
    // -------------------------------------------------------------------------
    if (path === '/login' && method === 'POST') {
      const b = await request.json();
      const identificador = String(b.username || b.usuario || '').trim();
      const password = String(b.password || '');

      if (!identificador || !password) {
        return err('Ingrese su usuario o cédula y su clave');
      }

      // Buscar por usuario o por cédula de cliente asociado
      let user = await env.DB.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1')
        .bind(identificador)
        .first();

      if (!user) {
        user = await env.DB.prepare(
          `SELECT u.* FROM usuarios u
           JOIN clientes c ON c.id = u.cliente_id
           WHERE c.cedula = ? AND u.activo = 1`
        )
          .bind(identificador)
          .first();
      }

      // Fallback a variable de entorno ADMIN_PASSWORD para el superadmin
      let valido = false;
      if (user) {
        valido = await verifyPassword(password, user.password_hash);
        if (!valido && user.usuario === (env.ADMIN_USER || 'adminfdigitb') && env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) {
          valido = true;
        }
      }

      if (!user || !valido) {
        await registrarBitacora(env.DB, {
          accion: 'login_fallido',
          detalle: `Intento fallido para ${identificador}`,
          ip
        });
        return err('Credenciales inválidas', 401);
      }

      // Si el usuario tiene código 2FA enviado en el mismo login, verificarlo de inmediato
      const requiere2FA = Boolean(user.totp_activo && user.totp_secret);
      let verificado2FA = !requiere2FA;

      if (requiere2FA && b.totp_code) {
        const okTotp = await verificarCodigoTOTP(user.totp_secret, b.totp_code);
        if (!okTotp) {
          return err('Código de doble factor (2FA) incorrecto', 401);
        }
        verificado2FA = true;
      }

      const token = generarTokenSesion();
      const expira = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
      await env.DB.prepare('INSERT INTO sesiones (token, usuario_id, verificado_2fa, expira_en) VALUES (?, ?, ?, ?)')
        .bind(token, user.id, verificado2FA ? 1 : 0, expira)
        .run();

      await registrarBitacora(env.DB, {
        usuario_id: user.id,
        usuario_nombre: user.usuario,
        accion: verificado2FA ? 'login_exitoso' : 'login_pendiente_2fa',
        detalle: `Ingreso rol ${user.rol}`,
        ip
      });

      return json({
        token,
        requiere_2fa: !verificado2FA,
        user: {
          id: user.id,
          usuario: user.usuario,
          nombre: user.nombre,
          rol: user.rol,
          cliente_id: user.cliente_id,
          totp_activo: Boolean(user.totp_activo)
        }
      });
    }

    if (path === '/2fa/verificar' && method === 'POST') {
      const ses = await autenticar(request, env, { permitirSin2FA: true });
      if (!ses) return err('No autorizado', 401);
      const { code } = await request.json();
      const ok = await verificarCodigoTOTP(ses.totp_secret, code);
      if (!ok) return err('Código de 6 dígitos inválido', 401);

      await env.DB.prepare('UPDATE sesiones SET verificado_2fa = 1 WHERE token = ?').bind(ses.token).run();
      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: '2fa_verificado',
        detalle: 'Verificación de segundo factor completada',
        ip
      });
      return json({ ok: true });
    }

    if (path === '/logout' && method === 'POST') {
      const ses = await autenticar(request, env, { permitirSin2FA: true });
      if (ses) {
        await env.DB.prepare('DELETE FROM sesiones WHERE token = ?').bind(ses.token).run();
      }
      return json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // 4. CRON DE AVISOS AUTOMÁTICOS DE VENCIMIENTOS (RF-09)
    // -------------------------------------------------------------------------
    if (path === '/cron/vencimientos' && (method === 'POST' || method === 'GET')) {
      const secretHeader = request.headers.get('X-Cron-Secret') || url.searchParams.get('secret') || '';
      const ses = await autenticar(request, env);
      const autorizadoPorCron = env.CRON_SECRET && secretHeader === env.CRON_SECRET;
      const autorizadoPorAdmin = ses && esRolAdmin(ses.rol);
      if (!autorizadoPorCron && !autorizadoPorAdmin) {
        return err('No autorizado para ejecutar barrido de vencimientos', 401);
      }

      const hoy = new Date().toISOString().slice(0, 10);
      const proxFecha = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

      // Marcar cuotas vencidas (0 días de gracia según PRD §5)
      await env.DB.prepare(
        "UPDATE cuotas SET estado = 'vencida' WHERE estado IN ('pendiente','parcial') AND fecha_vencimiento < ?"
      )
        .bind(hoy)
        .run();

      const admins = await obtenerCorreosAdmin(env.DB);

      // Cuotas próximas a vencer (en los próximos 3 días)
      const { results: porVencer } = await env.DB.prepare(
        `SELECT q.*, cr.cliente_id, cl.nombre, cl.cedula, cl.email
         FROM cuotas q
         JOIN creditos cr ON cr.id = q.credito_id
         JOIN clientes cl ON cl.id = cr.cliente_id
         WHERE q.estado IN ('pendiente','parcial')
           AND q.fecha_vencimiento BETWEEN ? AND ?`
      )
        .bind(hoy, proxFecha)
        .all();

      // Cuotas vencidas
      const { results: vencidas } = await env.DB.prepare(
        `SELECT q.*, cr.cliente_id, cl.nombre, cl.cedula, cl.email
         FROM cuotas q
         JOIN creditos cr ON cr.id = q.credito_id
         JOIN clientes cl ON cl.id = cr.cliente_id
         WHERE q.estado = 'vencida'`
      ).all();

      let enviados = 0;
      for (const q of porVencer) {
        const r = await enviarNotificacion(env, {
          tipo: 'vencimiento_proximo',
          destinatarios: [...admins, q.email].filter(Boolean),
          asunto: `Vencimiento próximo · Cuota #${q.numero} (${q.nombre})`,
          subtitulo: `La cuota #${q.numero} del crédito #${q.credito_id} vence el ${q.fecha_vencimiento}.`,
          filas: [
            ['Cliente', `${q.nombre} (C.C. ${q.cedula})`],
            ['Fecha a vencer', q.fecha_vencimiento],
            ['Valor sugerido', fmtCOP(q.cuota - q.pagado)]
          ],
          referencia: `cuota:${q.id}:por_vencer:${q.fecha_vencimiento}`
        });
        enviados += r.enviados;
      }

      for (const q of vencidas) {
        const r = await enviarNotificacion(env, {
          tipo: 'cuota_vencida',
          destinatarios: [...admins, q.email].filter(Boolean),
          asunto: `Cuota vencida · Cuota #${q.numero} (${q.nombre})`,
          subtitulo: `La cuota #${q.numero} del crédito #${q.credito_id} venció el ${q.fecha_vencimiento}.`,
          filas: [
            ['Cliente', `${q.nombre} (C.C. ${q.cedula})`],
            ['Fecha vencida', q.fecha_vencimiento],
            ['Saldo de la cuota', fmtCOP(q.cuota - q.pagado)]
          ],
          referencia: `cuota:${q.id}:vencida:${hoy}`
        });
        enviados += r.enviados;
      }

      return json({
        ok: true,
        fecha: hoy,
        proximas_a_vencer: porVencer.length,
        cuotas_vencidas: vencidas.length,
        notificaciones_procesadas: enviados
      });
    }

    // -------------------------------------------------------------------------
    // A PARTIR DE AQUÍ SE REQUIERE SESIÓN AUTENTICADA
    // -------------------------------------------------------------------------
    const ses = await autenticar(request, env);
    if (!ses) return err('Sesión no iniciada o expirada', 401);
    if (ses.requiere_2fa) return err('Debe completar la verificación de doble factor (2FA)', 403);

    // -------------------------------------------------------------------------
    // 5. CONFIGURACIÓN 2FA DEL USUARIO ACTUAL (PRD §8)
    // -------------------------------------------------------------------------
    if (path === '/2fa/setup' && method === 'POST') {
      const secret = generarSecretoTOTP();
      await env.DB.prepare('UPDATE usuarios SET totp_secret = ? WHERE id = ?').bind(secret, ses.id).run();
      const otpauth = `otpauth://totp/Digitbank:${encodeURIComponent(ses.usuario)}?secret=${secret}&issuer=FinancieraDigitbank`;
      const codigoActual = await generarCodigoTOTP(secret);
      return json({ secret, otpauth, codigo_prueba_actual: codigoActual });
    }

    if (path === '/2fa/activar' && method === 'POST') {
      const { code } = await request.json();
      const u = await env.DB.prepare('SELECT totp_secret FROM usuarios WHERE id = ?').bind(ses.id).first();
      if (!u?.totp_secret) return err('Primero genere el secreto 2FA');
      const ok = await verificarCodigoTOTP(u.totp_secret, code);
      if (!ok) return err('El código de 6 dígitos no coincide');
      await env.DB.prepare('UPDATE usuarios SET totp_activo = 1 WHERE id = ?').bind(ses.id).run();
      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: '2fa_activado',
        detalle: 'Doble factor TOTP activado en la cuenta',
        ip
      });
      return json({ ok: true });
    }

    if (path === '/2fa/desactivar' && method === 'POST') {
      await env.DB.prepare('UPDATE usuarios SET totp_activo = 0 WHERE id = ?').bind(ses.id).run();
      return json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // 6. PANEL DEL CLIENTE: MI CRÉDITO, MI PORTAFOLIO, RETIROS Y SOLICITUDES (RF-04, RF-08, RF-13, RF-15)
    // -------------------------------------------------------------------------
    if (path === '/cliente/expediente' && method === 'GET') {
      const targetClienteId = esRolAdmin(ses.rol)
        ? Number(url.searchParams.get('cliente_id') || ses.cliente_id || 0)
        : Number(ses.cliente_id || 0);
      if (!targetClienteId) return err('Este usuario no tiene una ficha de cliente asociada', 404);
      const exp = await obtenerExpedienteCliente(env.DB, { clienteId: targetClienteId });
      if (!exp) return err('Cliente no encontrado', 404);
      return json(exp);
    }

    // Cliente reporta un pago con su comprobante o pide nuevo crédito / referido / retiro
    if (path === '/cliente/solicitar-referido' && method === 'POST') {
      if (!ses.cliente_id) return err('Solo clientes pueden postular referidos');
      const b = await request.json();
      const cli = await env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(ses.cliente_id).first();
      if (!b.nombre || !b.cedula || !b.telefono) {
        return err('Nombre, cédula y teléfono del referido son obligatorios');
      }
      const monto = Math.round(Number(b.monto || 500000));
      const res = await env.DB.prepare(
        `INSERT INTO solicitudes
         (tipo, solicitante_id, nombre, cedula, telefono, email, ciudad, monto, plazo_meses, frecuencia, codigo_referente, acepto_datos, acepto_en, estado)
         VALUES ('referido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), 'nueva')`
      )
        .bind(
          cli.id,
          b.nombre.trim(),
          b.cedula.trim(),
          b.telefono.trim(),
          b.email || null,
          b.ciudad || null,
          monto,
          Number(b.plazo_meses || 12),
          b.frecuencia || 'mensual',
          cli.codigo_personal
        )
        .run();

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'solicitud_nuevo_referido',
        detalle: `Referido ${b.nombre} (${b.cedula}) postulado por ${cli.nombre}`,
        ip
      });
      return json({ ok: true, id: res.meta.last_row_id });
    }

    if (path === '/cliente/retiros' && method === 'POST') {
      const clienteId = ses.cliente_id || Number((await request.clone().json()).cliente_id || 0);
      if (!clienteId) return err('Cliente no identificado');
      const b = await request.json();
      const monto = Math.round(Number(b.monto || 0));
      const exp = await obtenerExpedienteCliente(env.DB, { clienteId });
      if (!exp) return err('Cliente no encontrado', 404);

      if (monto <= 0 || monto > exp.retiro_ahorro.disponible_retiro) {
        return err(
          `Monto no disponible. Según la regla del 200% del cupo referido (${fmtCOP(
            exp.retiro_ahorro.umbral_200_pct
          )}), su disponible máximo para retiro hoy es ${fmtCOP(exp.retiro_ahorro.disponible_retiro)}.`
        );
      }

      const res = await env.DB.prepare(
        `INSERT INTO retiros (cliente_id, monto, cupo_referido_momento, retirable_maximo_momento, destino_billetera, estado)
         VALUES (?, ?, ?, ?, ?, 'solicitado')`
      )
        .bind(
          clienteId,
          monto,
          exp.retiro_ahorro.cupo_total_referido,
          exp.retiro_ahorro.disponible_retiro,
          b.destino_billetera || exp.cliente.billetera || 'Transferencia titular'
        )
        .run();

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'solicitud_retiro_fondo',
        detalle: `Solicitud de retiro #${res.meta.last_row_id} por ${fmtCOP(monto)}`,
        ip
      });

      return json({ ok: true, id: res.meta.last_row_id });
    }

    // -------------------------------------------------------------------------
    // 7. REGISTRO Y CONFIRMACIÓN DE PAGOS CON TICKET Y SOPORTE (RF-03, RF-14)
    // -------------------------------------------------------------------------
    if (path === '/pagos' && method === 'POST') {
      let payload = {};
      let soporteData = null;

      const ctype = request.headers.get('content-type') || '';
      if (ctype.includes('multipart/form-data')) {
        const fd = await request.formData();
        payload = {
          credito_id: Number(fd.get('credito_id')),
          monto: Number(fd.get('monto')),
          fecha: fd.get('fecha') || new Date().toISOString().slice(0, 10),
          medio: fd.get('medio') || 'transferencia',
          referencia: fd.get('referencia') || '',
          notas: fd.get('notas') || '',
          confirmar_inmediato: fd.get('confirmar_inmediato') !== '0'
        };
        const file = fd.get('soporte');
        if (file && typeof file.arrayBuffer === 'function' && file.size > 0) {
          if (file.size > 2 * 1024 * 1024) return err('El comprobante no debe superar 2 MB');
          const bytes = new Uint8Array(await file.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          soporteData = {
            nombre: file.name || 'comprobante',
            tipo: file.type || 'application/octet-stream',
            datos_base64: btoa(bin)
          };
        }
      } else {
        payload = await request.json();
        if (payload.soporte_base64) {
          soporteData = {
            nombre: payload.soporte_nombre || 'comprobante',
            tipo: payload.soporte_tipo || 'image/png',
            datos_base64: payload.soporte_base64
          };
        }
      }

      const credito = await env.DB.prepare('SELECT * FROM creditos WHERE id = ?').bind(payload.credito_id).first();
      if (!credito) return err('Crédito no encontrado', 404);
      if (!esRolAdmin(ses.rol) && credito.cliente_id !== ses.cliente_id) {
        return err('No tiene permiso sobre este crédito', 403);
      }

      const monto = Math.round(Number(payload.monto || 0));
      if (monto <= 0) return err('El monto del pago debe ser mayor a cero');
      const fecha = String(payload.fecha || new Date().toISOString().slice(0, 10)).slice(0, 10);

      const confirmarAhora = esRolAdmin(ses.rol) && payload.confirmar_inmediato !== false;
      const ticketNumero = `TKT-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

      const insPago = await env.DB.prepare(
        `INSERT INTO pagos
         (credito_id, cliente_id, monto, fecha, medio, referencia, notas, estado, ticket_numero)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          credito.id,
          credito.cliente_id,
          monto,
          fecha,
          payload.medio || 'transferencia',
          payload.referencia || '',
          payload.notas || '',
          confirmarAhora ? 'confirmado' : 'reportado',
          ticketNumero
        )
        .run();

      const pagoId = insPago.meta.last_row_id;

      if (soporteData) {
        await env.DB.prepare(
          'INSERT INTO soportes (pago_id, nombre, tipo, datos_base64) VALUES (?, ?, ?, ?)'
        )
          .bind(pagoId, soporteData.nombre, soporteData.tipo, soporteData.datos_base64)
          .run();
      }

      const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(credito.cliente_id).first();
      const admins = await obtenerCorreosAdmin(env.DB);

      if (!confirmarAhora) {
        await enviarNotificacion(env, {
          tipo: 'pago_registrado',
          destinatarios: [...admins, cliente?.email].filter(Boolean),
          asunto: `Pago reportado · ${ticketNumero} (${cliente?.nombre})`,
          subtitulo: 'El pago fue registrado y está pendiente de confirmación administrativa.',
          filas: [
            ['Ticket', ticketNumero],
            ['Cliente', `${cliente?.nombre} (C.C. ${cliente?.cedula})`],
            ['Valor reportado', fmtCOP(monto)],
            ['Fecha', fecha]
          ]
        });
        return json({ ok: true, id: pagoId, ticket_numero: ticketNumero, estado: 'reportado' });
      }

      // Confirmación inmediata del administrador
      const resultadoConfirmacion = await ejecutarConfirmacionPago(env, {
        pagoId,
        usuarioAdmin: ses
      });
      return json(resultadoConfirmacion);
    }

    if (segments[0] === 'pagos' && segments[2] === 'confirmar' && method === 'POST') {
      if (!esRolAdmin(ses.rol)) return err('Solo administradores pueden confirmar pagos', 403);
      const pagoId = Number(segments[1]);
      const resultado = await ejecutarConfirmacionPago(env, { pagoId, usuarioAdmin: ses });
      return json(resultado);
    }

    if (segments[0] === 'soportes' && segments[1] && method === 'GET') {
      const sop = await env.DB.prepare('SELECT * FROM soportes WHERE id = ?').bind(Number(segments[1])).first();
      if (!sop || !sop.datos_base64) return err('Soporte no encontrado', 404);
      const binStr = atob(sop.datos_base64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      return new Response(bytes, {
        headers: {
          'Content-Type': sop.tipo || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${sop.nombre || 'soporte'}"`
        }
      });
    }

    // -------------------------------------------------------------------------
    // A PARTIR DE AQUÍ SOLO ROLES ADMINISTRATIVOS (RF-05, RF-06, RF-10, RF-11)
    // -------------------------------------------------------------------------
    if (!esRolAdmin(ses.rol)) {
      return err('Acceso reservado para administración', 403);
    }

    // -------------------------------------------------------------------------
    // 8. BÚSQUEDA INMEDIATA POR CÉDULA — FLUJO DE PAGO §7.1 DEL PRD
    // -------------------------------------------------------------------------
    if (path === '/admin/cedula' && method === 'GET') {
      const cedula = String(url.searchParams.get('cedula') || '').trim();
      if (!cedula) return err('Ingrese el número de cédula a consultar');
      const exp = await obtenerExpedienteCliente(env.DB, { cedula });
      if (!exp) return err(`No existe ningún cliente con la cédula ${cedula}`, 404);
      return json(exp);
    }

    // -------------------------------------------------------------------------
    // 9. TABLERO EJECUTIVO Y REPORTES DEL NEGOCIO (RF-05, RF-11)
    // -------------------------------------------------------------------------
    if (path === '/admin/resumen' && method === 'GET') {
      const hoy = new Date().toISOString().slice(0, 10);

      // Actualizar vencimientos al día (0 días de gracia)
      await env.DB.prepare(
        "UPDATE cuotas SET estado = 'vencida' WHERE estado IN ('pendiente','parcial') AND fecha_vencimiento < ?"
      )
        .bind(hoy)
        .run();

      const { results: clientes } = await env.DB.prepare(
        `SELECT c.*, r.nombre AS referido_por_nombre, r.codigo_personal AS codigo_referente,
                u.usuario AS usuario_acceso
         FROM clientes c
         LEFT JOIN clientes r ON r.id = c.referido_por_id
         LEFT JOIN usuarios u ON u.cliente_id = c.id
         ORDER BY c.id DESC`
      ).all();

      const { results: creditos } = await env.DB.prepare(
        `SELECT cr.*, cl.nombre AS cliente_nombre, cl.cedula AS cliente_cedula,
                (SELECT COUNT(*) FROM cuotas q WHERE q.credito_id = cr.id AND q.estado = 'pagada') AS cuotas_pagadas
         FROM creditos cr
         JOIN clientes cl ON cl.id = cr.cliente_id
         ORDER BY cr.id DESC`
      ).all();

      const { results: pagos } = await env.DB.prepare(
        `SELECT p.*, cl.nombre AS cliente_nombre, cl.cedula AS cliente_cedula, s.id AS soporte_id
         FROM pagos p
         JOIN clientes cl ON cl.id = p.cliente_id
         LEFT JOIN soportes s ON s.pago_id = p.id
         ORDER BY p.id DESC LIMIT 100`
      ).all();

      const { results: cuotasVencidas } = await env.DB.prepare(
        `SELECT q.*, cr.frecuencia, cl.nombre AS cliente_nombre, cl.cedula AS cliente_cedula, cl.telefono AS cliente_telefono
         FROM cuotas q
         JOIN creditos cr ON cr.id = q.credito_id
         JOIN clientes cl ON cl.id = cr.cliente_id
         WHERE q.estado IN ('vencida','pendiente','parcial') AND q.fecha_vencimiento <= date(?, '+7 days')
         ORDER BY q.fecha_vencimiento ASC`
      )
        .bind(hoy)
        .all();

      const { results: solicitudes } = await env.DB.prepare(
        'SELECT * FROM solicitudes ORDER BY id DESC LIMIT 100'
      ).all();

      const { results: retiros } = await env.DB.prepare(
        `SELECT r.*, c.nombre AS cliente_nombre, c.cedula AS cliente_cedula
         FROM retiros r
         JOIN clientes c ON c.id = r.cliente_id
         ORDER BY r.id DESC`
      ).all();

      const { results: saldosContables } = await env.DB.prepare(
        `SELECT c.codigo, c.concepto,
                COALESCE(SUM(m.debito), 0) AS total_debito,
                COALESCE(SUM(m.credito), 0) AS total_credito
         FROM cuentas c
         LEFT JOIN movimientos m ON m.cuenta = c.codigo
         GROUP BY c.codigo, c.concepto
         ORDER BY c.codigo ASC`
      ).all();

      const carteraActiva = creditos
        .filter((c) => c.estado === 'activo')
        .reduce((acc, c) => acc + Number(c.saldo_capital || 0), 0);

      const recaudoConfirmado = pagos
        .filter((p) => p.estado === 'confirmado')
        .reduce((acc, p) => acc + Number(p.monto || 0), 0);

      const fondoTotalCustodia = clientes.reduce((acc, c) => acc + Number(c.saldo_fondo_garantias || 0), 0);
      const vencidasEstricto = cuotasVencidas.filter((q) => q.fecha_vencimiento < hoy);
      const montoVencido = vencidasEstricto.reduce((acc, q) => acc + Math.max(0, q.cuota - q.pagado), 0);

      return json({
        metricas: {
          total_clientes: clientes.length,
          creditos_activos: creditos.filter((c) => c.estado === 'activo').length,
          cartera_capital: carteraActiva,
          recaudo_total: recaudoConfirmado,
          fondo_garantias_total: fondoTotalCustodia,
          cuotas_vencidas: vencidasEstricto.length,
          monto_vencido: montoVencido,
          pagos_por_confirmar: pagos.filter((p) => p.estado === 'reportado').length,
          solicitudes_nuevas: solicitudes.filter((s) => s.estado === 'nueva').length
        },
        clientes,
        creditos,
        pagos,
        vencimientos: cuotasVencidas,
        solicitudes,
        retiros,
        plan_cuentas_global: saldosContables
      });
    }

    // -------------------------------------------------------------------------
    // 10. GESTIÓN DE CLIENTES Y ACCESO AL PANEL (RF-04, RF-05, RF-08)
    // -------------------------------------------------------------------------
    if (path === '/clientes' && method === 'POST') {
      const b = await request.json();
      const nombre = String(b.nombre || '').trim();
      const cedula = String(b.cedula || '').trim();
      if (!nombre || !cedula) return err('Nombre y cédula son obligatorios');

      const ya = await env.DB.prepare('SELECT id FROM clientes WHERE cedula = ?').bind(cedula).first();
      if (ya) return err(`Ya existe un cliente registrado con la cédula ${cedula}`);

      let referidoPorId = b.referido_por_id ? Number(b.referido_por_id) : null;
      if (!referidoPorId && b.codigo_referente) {
        const refCli = await env.DB.prepare('SELECT id FROM clientes WHERE codigo_personal = ? OR cedula = ?')
          .bind(String(b.codigo_referente).trim(), String(b.codigo_referente).trim())
          .first();
        if (refCli) referidoPorId = refCli.id;
      }

      const codigoPersonal =
        String(b.codigo_personal || '').trim() || `DB-${cedula.slice(-4)}-${Math.floor(100 + Math.random() * 900)}`;
      const cupoPersonal = Math.round(Number(b.cupo_personal ?? 2000000));

      const ins = await env.DB.prepare(
        `INSERT INTO clientes
         (nombre, cedula, genero, telefono, direccion, ciudad, email, whatsapp, billetera,
          codigo_personal, referido_por_id, cupo_personal, saldo_disp_credito, saldo_disp_referir,
          saldo_fondo_garantias, nota_pago, nota_promedio, nota_grupo, fecha_ultimo_reembolso, valor_ultimo_reembolso, acepto_datos_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind(
          nombre,
          cedula,
          b.genero || null,
          b.telefono || null,
          b.direccion || null,
          b.ciudad || null,
          b.email || null,
          b.whatsapp || b.telefono || null,
          b.billetera || null,
          codigoPersonal,
          referidoPorId,
          cupoPersonal,
          Number(b.saldo_disp_credito ?? cupoPersonal),
          Number(b.saldo_disp_referir ?? 0),
          Number(b.saldo_fondo_garantias ?? 0),
          Number(b.nota_pago ?? 5.0),
          Number(b.nota_promedio ?? 5.0),
          Number(b.nota_grupo ?? 5.0),
          b.fecha_ultimo_reembolso || null,
          Number(b.valor_ultimo_reembolso ?? 0)
        )
        .run();

      const clienteId = ins.meta.last_row_id;

      // Crear usuario de acceso al panel del cliente (clave inicial = su cédula o la indicada)
      const claveInicial = String(b.password || cedula);
      const hash = await hashPassword(claveInicial);
      await env.DB.prepare(
        'INSERT OR IGNORE INTO usuarios (usuario, nombre, email, password_hash, rol, cliente_id, activo) VALUES (?, ?, ?, ?, ?, ?, 1)'
      )
        .bind(cedula, nombre, b.email || null, hash, 'cliente', clienteId)
        .run();

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'crear_cliente',
        detalle: `Cliente #${clienteId} · ${nombre} (C.C. ${cedula})`,
        ip
      });

      return json({ ok: true, id: clienteId, codigo_personal: codigoPersonal });
    }

    // -------------------------------------------------------------------------
    // 11. CREACIÓN, CONSULTA Y CIERRE DE CRÉDITOS (RF-01, RF-02, RF-07)
    // -------------------------------------------------------------------------
    if (path === '/creditos' && method === 'POST') {
      const b = await request.json();
      const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(Number(b.cliente_id)).first();
      if (!cliente) return err('Seleccione un cliente válido');

      const tieneReferente = Boolean(cliente.referido_por_id);
      const plan = generarPlanCuotas({
        monto: b.monto,
        plazoMeses: b.plazo_meses,
        frecuencia: b.frecuencia || 'mensual',
        tasaMaximaLegal: b.tasa_maxima_legal,
        tieneReferente,
        fechaInicio: b.fecha_inicio
      });

      const ins = await env.DB.prepare(
        `INSERT INTO creditos
         (cliente_id, monto, frecuencia, plazo_meses, num_cuotas, tasa_maxima_legal,
          pct_plataforma, pct_referente, pct_fondo, deduccion_total, cuota_valor,
          saldo_capital, saldo_anterior, fecha_inicio, estado, nota, aprobado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', 5.0, ?)`
      )
        .bind(
          cliente.id,
          plan.monto,
          plan.frecuencia,
          plan.plazo_meses,
          plan.num_cuotas,
          plan.tasas.tasaMaximaLegal,
          plan.tasas.pctPlataforma,
          plan.tasas.pctReferente,
          plan.tasas.pctFondo,
          plan.tasas.deduccionTotal,
          plan.cuota_valor,
          plan.monto,
          plan.monto,
          plan.fecha_inicio,
          ses.id
        )
        .run();

      const creditoId = ins.meta.last_row_id;

      // Insertar todas las cuotas programadas en lote
      const cuotaStmts = plan.cuotas.map((q) =>
        env.DB.prepare(
          `INSERT INTO cuotas
           (credito_id, numero, fecha_vencimiento, saldo_inicial, interes, fondo, plataforma, referente, capital, cuota, saldo_final, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`
        ).bind(
          creditoId,
          q.numero,
          q.fecha_vencimiento,
          q.saldo_inicial,
          q.interes,
          q.fondo,
          q.plataforma,
          q.referente,
          q.capital,
          q.cuota,
          q.saldo_final
        )
      );
      await env.DB.batch(cuotaStmts);

      // Actualizar disponible de crédito personal del cliente
      const nuevoDisp = Math.max(0, Number(cliente.cupo_personal || 0) - plan.monto);
      await env.DB.prepare('UPDATE clientes SET saldo_disp_credito = ? WHERE id = ?')
        .bind(nuevoDisp, cliente.id)
        .run();

      // Contabilizar apertura en el Plan de Cuentas PRD §7.2
      await contabilizarAperturaCredito(env.DB, {
        credito: { id: creditoId, cliente_id: cliente.id },
        plan
      });

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'apertura_credito',
        detalle: `Crédito #${creditoId} para ${cliente.nombre} por ${fmtCOP(plan.monto)} (${plan.frecuencia}, ${plan.num_cuotas} cuotas, tasa máx ${plan.tasas.tasaMaximaLegal}%)`,
        ip
      });

      const admins = await obtenerCorreosAdmin(env.DB);
      await enviarNotificacion(env, {
        tipo: 'credito_aprobado',
        destinatarios: [...admins, cliente.email].filter(Boolean),
        asunto: `Crédito #${creditoId} aprobado · Financiera Digitbank`,
        subtitulo: `El crédito de ${cliente.nombre} ha sido aprobado y su plan de ${plan.num_cuotas} cuotas está activo.`,
        filas: [
          ['Titular', `${cliente.nombre} (C.C. ${cliente.cedula})`],
          ['Monto aprobado', fmtCOP(plan.monto)],
          ['Frecuencia y plazo', `${plan.frecuencia} · ${plan.plazo_meses} meses (${plan.num_cuotas} cuotas)`],
          ['Valor cuota sugerida', fmtCOP(plan.cuota_valor)],
          [
            'Reparto deducción 10%',
            `Tasa máx ${plan.tasas.tasaMaximaLegal}% + Plataforma 1% + Referente ${plan.tasas.pctReferente}% + Fondo ${plan.tasas.pctFondo}%`
          ]
        ]
      });

      return json({ ok: true, id: creditoId, plan });
    }

    if (segments[0] === 'creditos' && segments[1] && segments[2] === 'cerrar' && method === 'POST') {
      const creditoId = Number(segments[1]);
      await env.DB.prepare("UPDATE creditos SET estado = 'cerrado' WHERE id = ?").bind(creditoId).run();
      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'cerrar_credito',
        detalle: `Cierre administrativo del crédito #${creditoId}`,
        ip
      });
      return json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // 12. GESTIÓN DE SOLICITUDES Y RETIROS (RF-13, RF-16)
    // -------------------------------------------------------------------------
    if (segments[0] === 'solicitudes' && segments[1] && method === 'POST') {
      const solId = Number(segments[1]);
      const { estado } = await request.json();
      await env.DB.prepare('UPDATE solicitudes SET estado = ? WHERE id = ?').bind(estado || 'atendida', solId).run();
      return json({ ok: true });
    }

    if (segments[0] === 'retiros' && segments[1] && method === 'POST') {
      const retId = Number(segments[1]);
      const { estado } = await request.json();
      const ret = await env.DB.prepare('SELECT * FROM retiros WHERE id = ?').bind(retId).first();
      if (!ret) return err('Solicitud de retiro no encontrada', 404);

      if (estado === 'pagado' && ret.estado !== 'pagado') {
        await env.DB.prepare(
          'UPDATE clientes SET saldo_fondo_garantias = MAX(0, saldo_fondo_garantias - ?) WHERE id = ?'
        )
          .bind(ret.monto, ret.cliente_id)
          .run();
      }
      await env.DB.prepare(
        "UPDATE retiros SET estado = ?, aprobado_por = ?, aprobado_en = datetime('now') WHERE id = ?"
      )
        .bind(estado, ses.id, retId)
        .run();

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'gestion_retiro',
        detalle: `Retiro #${retId} marcado como ${estado}`,
        ip
      });
      return json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // 13. MIGRACIÓN Y VALIDACIÓN DE LOS 210 CLIENTES DESDE EXCEL (RF-10, PRD §7.3)
    // -------------------------------------------------------------------------
    if (path === '/migracion/importar' && method === 'POST') {
      const b = await request.json();
      const filas = Array.isArray(b.filas) ? b.filas : [];
      const dryRun = Boolean(b.dry_run);

      if (!filas.length) return err('No se recibieron filas para migrar');

      const errores = [];
      const validos = [];
      const cedulasVistas = new Set();

      filas.forEach((raw, idx) => {
        const numFila = idx + 2;
        const nombre = String(raw.nombre || '').trim();
        const cedula = String(raw.cedula || '').replace(/[^\dA-Za-z-]/g, '').trim();
        if (!nombre || !cedula) {
          errores.push({ fila: numFila, error: 'Nombre o cédula vacíos' });
          return;
        }
        if (cedulasVistas.has(cedula)) {
          errores.push({ fila: numFila, error: `Cédula duplicada en el archivo (${cedula})` });
          return;
        }
        cedulasVistas.add(cedula);

        validos.push({
          fila: numFila,
          nombre,
          cedula,
          genero: String(raw.genero || '').trim() || null,
          telefono: String(raw.telefono || '').trim() || null,
          direccion: String(raw.direccion || '').trim() || null,
          ciudad: String(raw.ciudad || '').trim() || null,
          email: String(raw.correo_electronico || raw.email || '').trim() || null,
          whatsapp: String(raw.whatsapp || raw.telefono || '').trim() || null,
          billetera: String(raw.billetera_electronica || raw.billetera || '').trim() || null,
          cupo_personal: Math.round(Number(raw.cupo_personal_del_credito ?? raw.cupo_personal ?? 2000000)),
          fecha_inicio_credito: String(raw.fecha_de_inicio_del_credito || raw.fecha_inicio || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          saldo_credito: Math.round(Number(raw.saldo_del_credito ?? raw.saldo_credito ?? 0)),
          fecha_ultimo_reembolso: String(raw.fecha_del_ultimo_reembolso || raw.fecha_ultimo_reembolso || '').slice(0, 10) || null,
          numero_cuotas: Math.max(1, Math.round(Number(raw.numero_de_cuotas_del_credito ?? raw.numero_cuotas ?? 12))),
          numero_restantes: Math.max(0, Math.round(Number(raw.numero_de_restantes ?? raw.numero_restantes ?? 0))),
          nota_pago: Number(raw.nota_del_pago ?? raw.nota_pago ?? 5.0),
          nota_promedio: Number(raw.nota_promedio_del_cliente ?? raw.nota_promedio ?? 5.0),
          nota_grupo: Number(raw.nota_promedio_del_grupo_de_referidos ?? raw.nota_grupo ?? 5.0),
          saldo_disp_credito: Math.round(Number(raw.saldo_disponible_para_credito_personal ?? raw.saldo_disp_credito ?? 0)),
          saldo_disp_referir: Math.round(Number(raw.saldo_disponible_para_referir ?? raw.saldo_disp_referir ?? 0)),
          saldo_fondo_garantias: Math.round(Number(raw.saldo_del_fondo_para_garantias_crediticias ?? raw.saldo_fondo_garantias ?? 0)),
          codigo_referente: String(raw.codigo_referente || '').trim() || null
        });
      });

      if (dryRun) {
        return json({
          dry_run: true,
          total_recibidos: filas.length,
          validos: validos.length,
          errores,
          muestra: validos.slice(0, 5)
        });
      }

      let insertados = 0;
      let actualizados = 0;

      for (const item of validos) {
        const existe = await env.DB.prepare('SELECT id FROM clientes WHERE cedula = ?').bind(item.cedula).first();
        const codigoPersonal = `DB-${item.cedula.slice(-4)}-${Math.floor(100 + Math.random() * 899)}`;

        let clienteId;
        if (existe) {
          clienteId = existe.id;
          await env.DB.prepare(
            `UPDATE clientes SET
              nombre = ?, genero = ?, telefono = ?, direccion = ?, ciudad = ?, email = ?, whatsapp = ?, billetera = ?,
              cupo_personal = ?, saldo_disp_credito = ?, saldo_disp_referir = ?, saldo_fondo_garantias = ?,
              nota_pago = ?, nota_promedio = ?, nota_grupo = ?, fecha_ultimo_reembolso = ?
             WHERE id = ?`
          )
            .bind(
              item.nombre,
              item.genero,
              item.telefono,
              item.direccion,
              item.ciudad,
              item.email,
              item.whatsapp,
              item.billetera,
              item.cupo_personal,
              item.saldo_disp_credito,
              item.saldo_disp_referir,
              item.saldo_fondo_garantias,
              item.nota_pago,
              item.nota_promedio,
              item.nota_grupo,
              item.fecha_ultimo_reembolso,
              clienteId
            )
            .run();
          actualizados++;
        } else {
          const ins = await env.DB.prepare(
            `INSERT INTO clientes
             (nombre, cedula, genero, telefono, direccion, ciudad, email, whatsapp, billetera,
              codigo_personal, cupo_personal, saldo_disp_credito, saldo_disp_referir, saldo_fondo_garantias,
              nota_pago, nota_promedio, nota_grupo, fecha_ultimo_reembolso, acepto_datos_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
            .bind(
              item.nombre,
              item.cedula,
              item.genero,
              item.telefono,
              item.direccion,
              item.ciudad,
              item.email,
              item.whatsapp,
              item.billetera,
              codigoPersonal,
              item.cupo_personal,
              item.saldo_disp_credito,
              item.saldo_disp_referir,
              item.saldo_fondo_garantias,
              item.nota_pago,
              item.nota_promedio,
              item.nota_grupo,
              item.fecha_ultimo_reembolso
            )
            .run();
          clienteId = ins.meta.last_row_id;

          const hash = await hashPassword(item.cedula);
          await env.DB.prepare(
            'INSERT OR IGNORE INTO usuarios (usuario, nombre, email, password_hash, rol, cliente_id, activo) VALUES (?, ?, ?, ?, ?, ?, 1)'
          )
            .bind(item.cedula, item.nombre, item.email, hash, 'cliente', clienteId)
            .run();
          insertados++;
        }

        // Si el registro migrado trae saldo de crédito activo, crear su crédito migrado y cuotas restantes
        if (item.saldo_credito >= 500000 && !existe) {
          const montoBase = Math.min(2000000, Math.max(500000, item.saldo_credito));
          const plazoM = Math.min(24, Math.max(1, item.numero_cuotas));
          const plan = generarPlanCuotas({
            monto: montoBase,
            plazoMeses: plazoM,
            frecuencia: 'mensual',
            tasaMaximaLegal: 2.3,
            tieneReferente: false,
            fechaInicio: item.fecha_inicio_credito
          });
          const pagadasCount = Math.max(0, plan.num_cuotas - item.numero_restantes);

          const insCr = await env.DB.prepare(
            `INSERT INTO creditos
             (cliente_id, monto, frecuencia, plazo_meses, num_cuotas, tasa_maxima_legal,
              pct_plataforma, pct_referente, pct_fondo, deduccion_total, cuota_valor,
              saldo_capital, saldo_anterior, fecha_inicio, estado, nota, aprobado_por)
             VALUES (?, ?, 'mensual', ?, ?, 2.3, 1, 0, 6.7, 10, ?, ?, ?, ?, 'activo', ?, ?)`
          )
            .bind(
              clienteId,
              montoBase,
              plazoM,
              plan.num_cuotas,
              plan.cuota_valor,
              item.saldo_credito,
              montoBase,
              item.fecha_inicio_credito,
              item.nota_promedio,
              ses.id
            )
            .run();

          const crId = insCr.meta.last_row_id;
          const stmts = plan.cuotas.map((q, idx) =>
            env.DB.prepare(
              `INSERT INTO cuotas
               (credito_id, numero, fecha_vencimiento, saldo_inicial, interes, fondo, plataforma, referente, capital, cuota, saldo_final, pagado, estado)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              crId,
              q.numero,
              q.fecha_vencimiento,
              q.saldo_inicial,
              q.interes,
              q.fondo,
              q.plataforma,
              q.referente,
              q.capital,
              q.cuota,
              q.saldo_final,
              idx < pagadasCount ? q.cuota : 0,
              idx < pagadasCount ? 'pagada' : 'pendiente'
            )
          );
          await env.DB.batch(stmts);
        }
      }

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'migracion_excel_21_columnas',
        detalle: `Migración ejecutada: ${insertados} nuevos, ${actualizados} actualizados, ${errores.length} con error`,
        ip
      });

      return json({
        ok: true,
        insertados,
        actualizados,
        errores
      });
    }

    // -------------------------------------------------------------------------
    // 14. PANEL SUPER ADMIN: CONFIGURACIÓN, USUARIOS, ROLES Y VACIADO DE BASE (RF-06)
    // -------------------------------------------------------------------------
    if (path === '/superadmin/estado' && method === 'GET') {
      if (ses.rol !== 'superadmin') return err('Exclusivo para Super Admin', 403);
      const { results: cfgRows } = await env.DB.prepare('SELECT clave, valor FROM configuracion').all();
      const config = Object.fromEntries(cfgRows.map((r) => [r.clave, r.valor]));
      const { results: usuarios } = await env.DB.prepare(
        'SELECT id, usuario, nombre, email, rol, permisos_json, cliente_id, totp_activo, activo, creado_en FROM usuarios ORDER BY id ASC'
      ).all();
      const { results: bitacora } = await env.DB.prepare(
        'SELECT * FROM bitacora ORDER BY id DESC LIMIT 120'
      ).all();
      const { results: notificaciones } = await env.DB.prepare(
        'SELECT * FROM notificaciones ORDER BY id DESC LIMIT 80'
      ).all();
      return json({ config, usuarios, bitacora, notificaciones });
    }

    if (path === '/superadmin/config' && method === 'POST') {
      if (ses.rol !== 'superadmin') return err('Exclusivo para Super Admin', 403);
      const b = await request.json();
      const stmts = Object.entries(b).map(([k, v]) =>
        env.DB.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)').bind(k, String(v))
      );
      if (stmts.length) await env.DB.batch(stmts);
      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'actualizar_configuracion',
        detalle: JSON.stringify(b),
        ip
      });
      return json({ ok: true });
    }

    if (path === '/superadmin/usuarios' && method === 'POST') {
      if (ses.rol !== 'superadmin') return err('Exclusivo para Super Admin', 403);
      const b = await request.json();
      if (!b.usuario || !b.nombre || !b.password || !b.rol) {
        return err('Nombre, usuario, clave y rol son obligatorios');
      }
      const hash = await hashPassword(b.password);
      await env.DB.prepare(
        'INSERT INTO usuarios (usuario, nombre, email, password_hash, rol, permisos_json, activo) VALUES (?, ?, ?, ?, ?, ?, 1)'
      )
        .bind(
          b.usuario.trim(),
          b.nombre.trim(),
          b.email || null,
          hash,
          b.rol,
          JSON.stringify(b.permisos || {})
        )
        .run();

      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'crear_usuario_sistema',
        detalle: `Usuario ${b.usuario} creado con rol ${b.rol}`,
        ip
      });
      return json({ ok: true });
    }

    if (path === '/superadmin/limpiar-para-migracion' && method === 'POST') {
      if (ses.rol !== 'superadmin') return err('Exclusivo para Super Admin', 403);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM soportes'),
        env.DB.prepare('DELETE FROM movimientos'),
        env.DB.prepare('DELETE FROM pagos'),
        env.DB.prepare('DELETE FROM cuotas'),
        env.DB.prepare('DELETE FROM creditos'),
        env.DB.prepare('DELETE FROM retiros'),
        env.DB.prepare('DELETE FROM solicitudes'),
        env.DB.prepare('DELETE FROM notificaciones'),
        env.DB.prepare("DELETE FROM usuarios WHERE rol = 'cliente'"),
        env.DB.prepare('DELETE FROM clientes')
      ]);
      await registrarBitacora(env.DB, {
        usuario_id: ses.id,
        usuario_nombre: ses.usuario,
        accion: 'base_en_blanco_para_migracion',
        detalle: 'Base de datos limpiada y lista en blanco para migrar los 210 clientes del Excel original',
        ip
      });
      return json({ ok: true });
    }

    return err(`Ruta no encontrada: ${method} ${path}`, 404);
  } catch (e) {
    return err(e.message || 'Error interno del servidor', 500);
  }
}

/**
 * Ejecuta la confirmación contable y financiera de un pago (RF-03, RF-07, RF-08, RF-09, RF-14)
 */
async function ejecutarConfirmacionPago(env, { pagoId, usuarioAdmin }) {
  const pago = await env.DB.prepare('SELECT * FROM pagos WHERE id = ?').bind(pagoId).first();
  if (!pago) throw new Error('Pago no encontrado');
  const credito = await env.DB.prepare('SELECT * FROM creditos WHERE id = ?').bind(pago.credito_id).first();
  const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(pago.cliente_id).first();

  const { results: cuotasPend } = await env.DB.prepare(
    "SELECT * FROM cuotas WHERE credito_id = ? AND estado != 'pagada' ORDER BY numero ASC"
  )
    .bind(credito.id)
    .all();

  const aplicacion = aplicarPagoACuotas(cuotasPend, pago.monto, pago.fecha, credito.frecuencia);

  const stmts = [];
  for (const q of aplicacion.cuotas_actualizadas) {
    stmts.push(
      env.DB.prepare(
        `UPDATE cuotas SET
          pagado = ?, interes_acreditado = ?, fondo_acreditado = ?,
          plataforma_acreditado = ?, referente_acreditado = ?, capital_acreditado = ?,
          estado = ?, fecha_pago = ?, nota_cuota = ?
         WHERE id = ?`
      ).bind(
        q.pagado,
        q.interes_acreditado,
        q.fondo_acreditado,
        q.plataforma_acreditado,
        q.referente_acreditado,
        q.capital_acreditado,
        q.estado,
        q.fecha_pago,
        q.nota_cuota,
        q.id
      )
    );
  }

  const nuevoSaldoCapital = Math.max(0, Number(credito.saldo_capital || 0) - aplicacion.desglose.capital);
  const nuevoEstadoCredito = nuevoSaldoCapital === 0 ? 'pagado' : 'activo';

  stmts.push(
    env.DB.prepare(
      `UPDATE creditos SET
        saldo_anterior = saldo_capital,
        saldo_capital = ?,
        fecha_ultimo_pago = ?,
        estado = ?,
        nota = ?
       WHERE id = ?`
    ).bind(nuevoSaldoCapital, pago.fecha, nuevoEstadoCredito, aplicacion.nota_pago, credito.id)
  );

  // Actualizar pago como confirmado
  stmts.push(
    env.DB.prepare(
      `UPDATE pagos SET
        aplicado = ?, excedente = ?, estado = 'confirmado',
        nota_pago = ?, confirmado_por = ?, confirmado_en = datetime('now')
       WHERE id = ?`
    ).bind(aplicacion.aplicado, aplicacion.excedente, aplicacion.nota_pago, usuarioAdmin.id, pago.id)
  );

  // RF-07 y RF-14: Acumulación automática del fondo de garantías y actualización de nota en tiempo real
  const nuevoFondo = Number(cliente.saldo_fondo_garantias || 0) + aplicacion.desglose.fondo;
  const notaPromAnterior = Number(cliente.nota_promedio || 5.0);
  const nuevaNotaPromedio = Number(((notaPromAnterior + aplicacion.nota_pago) / 2).toFixed(2));
  const nuevoDispCredito = Math.max(0, Number(cliente.cupo_personal || 0) - nuevoSaldoCapital);

  stmts.push(
    env.DB.prepare(
      `UPDATE clientes SET
        saldo_fondo_garantias = ?,
        saldo_disp_credito = ?,
        saldo_disp_referir = ?,
        nota_pago = ?,
        nota_promedio = ?,
        fecha_ultimo_reembolso = ?,
        valor_ultimo_reembolso = ?
       WHERE id = ?`
    ).bind(
      nuevoFondo,
      nuevoDispCredito,
      nuevoFondo * 2,
      aplicacion.nota_pago,
      nuevaNotaPromedio,
      pago.fecha,
      pago.monto,
      cliente.id
    )
  );

  await env.DB.batch(stmts);

  // Registrar asientos contables en las 8 cuentas del PRD §7.2
  await contabilizarPagoConfirmado(env.DB, {
    pago,
    credito,
    desglose: aplicacion.desglose,
    referenteClienteId: cliente.referido_por_id
  });

  // Si el cliente tiene referente, recalcular la nota promedio del grupo del referente
  if (cliente.referido_por_id) {
    const { results: hermanos } = await env.DB.prepare(
      'SELECT nota_promedio FROM clientes WHERE referido_por_id = ?'
    )
      .bind(cliente.referido_por_id)
      .all();
    if (hermanos.length) {
      const promGrupo = Number(
        (hermanos.reduce((a, b) => a + Number(b.nota_promedio || 5), 0) / hermanos.length).toFixed(2)
      );
      await env.DB.prepare('UPDATE clientes SET nota_grupo = ? WHERE id = ?')
        .bind(promGrupo, cliente.referido_por_id)
        .run();
    }
  }

  // RF-09: Enviar ticket de pago exitoso por correo al cliente y a los administradores
  const admins = await obtenerCorreosAdmin(env.DB);
  await enviarNotificacion(env, {
    tipo: 'pago_exitoso_ticket',
    destinatarios: [...admins, cliente.email].filter(Boolean),
    asunto: `Pago exitoso · Ticket ${pago.ticket_numero}`,
    subtitulo: `Se confirmó el pago de ${cliente.nombre} y se acreditaron las cuentas de su crédito #${credito.id}.`,
    filas: [
      ['Ticket de pago', pago.ticket_numero],
      ['Cliente', `${cliente.nombre} (C.C. ${cliente.cedula})`],
      ['Valor pagado', fmtCOP(pago.monto)],
      ['Abono a capital (137010)', fmtCOP(aplicacion.desglose.capital)],
      ['Aporte a su fondo de garantías (281020)', fmtCOP(aplicacion.desglose.fondo)],
      ['Intereses (415020)', fmtCOP(aplicacion.desglose.interes)],
      ['Uso de plataforma 1% (233555)', fmtCOP(aplicacion.desglose.plataforma)],
      ['Comisión referente 2% (233520)', fmtCOP(aplicacion.desglose.referente)],
      ['Nuevo saldo del crédito', fmtCOP(nuevoSaldoCapital)],
      ['Nota del pago / Nota promedio', `${aplicacion.nota_pago} / ${nuevaNotaPromedio}`]
    ]
  });

  return {
    ok: true,
    pago_id: pago.id,
    ticket_numero: pago.ticket_numero,
    estado: 'confirmado',
    aplicado: aplicacion.aplicado,
    excedente: aplicacion.excedente,
    desglose: aplicacion.desglose,
    nota_pago: aplicacion.nota_pago,
    nuevo_saldo_capital: nuevoSaldoCapital
  };
}
