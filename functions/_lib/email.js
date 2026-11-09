// =============================================================================
// Notificaciones automáticas por correo (RF-09) — Resend + Registro en D1
// =============================================================================

function plantillaHtmlCorreo({ titulo, subtitulo, filas = [], pie }) {
  const filasHtml = filas
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #E5E5EA;color:#6E6E73;font-size:13px">${k}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #E5E5EA;color:#1D1D1F;font-weight:600;font-size:13px;text-align:right">${v}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:24px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1D1D1F">
  <div style="max-width:540px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E5EA;border-radius:18px;overflow:hidden">
    <div style="background:#0B0D12;padding:20px 24px;color:#F5F5F7;letter-spacing:0.18em;font-weight:600;font-size:14px">
      DIGITBANK <span style="color:#C9A24B">· FINANCIERA</span>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:600">${titulo}</h2>
      <p style="margin:0 0 18px;color:#6E6E73;font-size:14px;line-height:1.5">${subtitulo}</p>
      ${
        filas.length
          ? `<table style="width:100%;border-collapse:collapse;margin-bottom:18px">${filasHtml}</table>`
          : ''
      }
      <p style="margin:0;color:#6E6E73;font-size:12px;line-height:1.5">${
        pie || 'Mensaje automático del sistema Financiera Digitbank. Tratamiento de datos conforme a la Ley 1581 de 2012.'
      }</p>
    </div>
  </div>
</body>
</html>`;
}

export async function obtenerCorreosAdmin(db) {
  const row = await db.prepare("SELECT valor FROM configuracion WHERE clave = 'correos_admin'").first();
  const raw = row?.valor || 'financieradigitbank@gmail.com';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function enviarNotificacion(env, { tipo, destinatarios, asunto, subtitulo, filas = [], referencia = null }) {
  const lista = (Array.isArray(destinatarios) ? destinatarios : [destinatarios])
    .map((x) => String(x || '').trim())
    .filter((x) => x.includes('@'));

  if (!lista.length) return { enviados: 0, estado: 'sin_destinatario' };

  if (referencia) {
    const ya = await env.DB.prepare('SELECT id FROM notificaciones WHERE referencia = ?').bind(referencia).first();
    if (ya) return { enviados: 0, estado: 'duplicado_omitido' };
  }

  const html = plantillaHtmlCorreo({ titulo: asunto, subtitulo, filas });
  const resumen = filas.map(([k, v]) => `${k}: ${v}`).join(' | ').slice(0, 300);
  let estado = 'simulada';

  if (env.RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || 'Financiera Digitbank <notificaciones@fdigitb.com>',
          to: lista,
          subject: asunto,
          html
        })
      });
      estado = resp.ok ? 'enviada' : 'error';
    } catch {
      estado = 'error';
    }
  }

  try {
    await env.DB.prepare(
      'INSERT INTO notificaciones (tipo, destinatario, asunto, cuerpo_resumen, estado, referencia) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(tipo, lista.join(', '), asunto, resumen, estado, referencia)
      .run();
  } catch {
    // Ignorar colisión de referencia única
  }

  return { enviados: lista.length, estado };
}
