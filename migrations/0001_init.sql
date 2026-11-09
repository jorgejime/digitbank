-- =============================================================================
-- Financiera Digitbank · Esquema completo PRD v1.0 & QFD Anexo 2
-- Todos los montos en pesos COP enteros.
-- =============================================================================

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cedula TEXT NOT NULL UNIQUE,
  genero TEXT,
  telefono TEXT,
  direccion TEXT,
  ciudad TEXT,
  email TEXT,
  whatsapp TEXT,
  billetera TEXT,
  codigo_personal TEXT NOT NULL UNIQUE,
  referido_por_id INTEGER REFERENCES clientes(id),
  cupo_personal INTEGER NOT NULL DEFAULT 2000000,
  saldo_disp_credito INTEGER NOT NULL DEFAULT 2000000,
  saldo_disp_referir INTEGER NOT NULL DEFAULT 0,
  saldo_fondo_garantias INTEGER NOT NULL DEFAULT 0,
  nota_pago REAL NOT NULL DEFAULT 5.0,
  nota_promedio REAL NOT NULL DEFAULT 5.0,
  nota_grupo REAL NOT NULL DEFAULT 5.0,
  fecha_ultimo_reembolso TEXT,
  valor_ultimo_reembolso INTEGER NOT NULL DEFAULT 0,
  acepto_datos_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_ref ON clientes(referido_por_id);
CREATE INDEX IF NOT EXISTS idx_clientes_cedula ON clientes(cedula);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('cliente','admin','superadmin','usuario1','usuario2','usuario3')),
  permisos_json TEXT NOT NULL DEFAULT '{}',
  cliente_id INTEGER REFERENCES clientes(id),
  totp_secret TEXT,
  totp_activo INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  verificado_2fa INTEGER NOT NULL DEFAULT 1,
  expira_en TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS creditos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  monto INTEGER NOT NULL CHECK (monto BETWEEN 500000 AND 2000000),
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('diaria','semanal','quincenal','mensual')),
  plazo_meses INTEGER NOT NULL CHECK (plazo_meses BETWEEN 1 AND 24),
  num_cuotas INTEGER NOT NULL,
  tasa_maxima_legal REAL NOT NULL,          -- % mensual fijado al abrir el crédito
  pct_plataforma REAL NOT NULL DEFAULT 1,
  pct_referente REAL NOT NULL DEFAULT 0,    -- 2% si tiene referente, 0% si no
  pct_fondo REAL NOT NULL,                  -- resto hasta completar 10%
  deduccion_total REAL NOT NULL DEFAULT 10,
  cuota_valor INTEGER NOT NULL,
  saldo_capital INTEGER NOT NULL,
  saldo_anterior INTEGER NOT NULL DEFAULT 0,
  fecha_inicio TEXT NOT NULL,
  fecha_ultimo_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('pendiente','activo','pagado','cerrado','rechazado')),
  nota REAL NOT NULL DEFAULT 5.0,
  aprobado_por INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_creditos_cliente ON creditos(cliente_id);

CREATE TABLE IF NOT EXISTS cuotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credito_id INTEGER NOT NULL REFERENCES creditos(id),
  numero INTEGER NOT NULL,
  fecha_vencimiento TEXT NOT NULL,
  saldo_inicial INTEGER NOT NULL,
  interes INTEGER NOT NULL,
  fondo INTEGER NOT NULL,
  plataforma INTEGER NOT NULL,
  referente INTEGER NOT NULL DEFAULT 0,
  capital INTEGER NOT NULL,
  cuota INTEGER NOT NULL,
  saldo_final INTEGER NOT NULL,
  pagado INTEGER NOT NULL DEFAULT 0,
  interes_acreditado INTEGER NOT NULL DEFAULT 0,
  fondo_acreditado INTEGER NOT NULL DEFAULT 0,
  plataforma_acreditado INTEGER NOT NULL DEFAULT 0,
  referente_acreditado INTEGER NOT NULL DEFAULT 0,
  capital_acreditado INTEGER NOT NULL DEFAULT 0,
  fecha_pago TEXT,
  nota_cuota REAL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','parcial','vencida')),
  UNIQUE (credito_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_cuotas_venc ON cuotas(fecha_vencimiento, estado);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credito_id INTEGER NOT NULL REFERENCES creditos(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  monto INTEGER NOT NULL CHECK (monto > 0),
  aplicado INTEGER NOT NULL DEFAULT 0,
  excedente INTEGER NOT NULL DEFAULT 0,
  fecha TEXT NOT NULL,
  medio TEXT DEFAULT 'transferencia',
  banco_cuenta TEXT DEFAULT '111005',
  referencia TEXT,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'reportado' CHECK (estado IN ('reportado','confirmado','rechazado')),
  ticket_numero TEXT UNIQUE,
  nota_pago REAL,
  confirmado_por INTEGER REFERENCES usuarios(id),
  confirmado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pagos_credito ON pagos(credito_id);

CREATE TABLE IF NOT EXISTS soportes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pago_id INTEGER NOT NULL REFERENCES pagos(id),
  nombre TEXT,
  tipo TEXT,
  datos_base64 TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plan de cuentas contables (PRD §7.2)
CREATE TABLE IF NOT EXISTS cuentas (
  codigo TEXT PRIMARY KEY,
  concepto TEXT NOT NULL
);
INSERT OR IGNORE INTO cuentas VALUES
 ('134510','Cargos pendientes por cobrar al titular del crédito'),
 ('137010','Préstamo al titular del crédito'),
 ('233520','Comisión por pagar (titular / referente del titular)'),
 ('233555','Uso de plataforma'),
 ('281020','Fondo para garantías crediticias del titular'),
 ('415020','Intereses generados al titular del crédito'),
 ('615020','Rendimientos del fondo del titular'),
 ('111005','Banco por donde entró el dinero');

CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credito_id INTEGER NOT NULL REFERENCES creditos(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  cuenta TEXT NOT NULL REFERENCES cuentas(codigo),
  debito INTEGER NOT NULL DEFAULT 0,
  credito INTEGER NOT NULL DEFAULT 0,
  pago_id INTEGER REFERENCES pagos(id),
  descripcion TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_credito ON movimientos(credito_id);
CREATE INDEX IF NOT EXISTS idx_mov_cliente ON movimientos(cliente_id);

CREATE TABLE IF NOT EXISTS retiros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  monto INTEGER NOT NULL CHECK (monto > 0),
  cupo_referido_momento INTEGER NOT NULL DEFAULT 0,
  retirable_maximo_momento INTEGER NOT NULL DEFAULT 0,
  destino_billetera TEXT,
  estado TEXT NOT NULL DEFAULT 'solicitado' CHECK (estado IN ('solicitado','aprobado','pagado','rechazado')),
  aprobado_por INTEGER REFERENCES usuarios(id),
  aprobado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'credito' CHECK (tipo IN ('credito','referido')),
  solicitante_id INTEGER REFERENCES clientes(id),
  nombre TEXT NOT NULL,
  cedula TEXT,
  genero TEXT,
  telefono TEXT,
  whatsapp TEXT,
  direccion TEXT,
  ciudad TEXT,
  email TEXT,
  billetera TEXT,
  monto INTEGER CHECK (monto BETWEEN 500000 AND 2000000),
  plazo_meses INTEGER DEFAULT 12,
  frecuencia TEXT CHECK (frecuencia IN ('diaria','semanal','quincenal','mensual')),
  codigo_referente TEXT,
  acepto_datos INTEGER NOT NULL DEFAULT 0,
  acepto_en TEXT,
  estado TEXT NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','atendida','aprobada','rechazada')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  destinatario TEXT NOT NULL,
  asunto TEXT,
  cuerpo_resumen TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviada','simulada','error')),
  referencia TEXT UNIQUE,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bitacora (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT,
  accion TEXT NOT NULL,
  detalle TEXT,
  ip TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT OR IGNORE INTO configuracion VALUES
 ('correos_admin','financieradigitbank@gmail.com'),
 ('tasa_maxima_default','2.3'),
 ('deduccion_total_pct','10'),
 ('pct_plataforma','1'),
 ('pct_referente','2'),
 ('cupo_inicial_default','2000000'),
 ('requerir_2fa_admin','0');
