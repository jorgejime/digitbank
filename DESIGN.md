# DESIGN.md — Financiera Digitbank

Arquetipo: **Apple clean/spacious** con superficies de vidrio líquido. Sobrio, mucho aire, un solo acento.

## Tokens (CSS Variables)

```css
:root {
  /* Canvas y superficies */
  --canvas: #0B0D12;            /* fondo pantalla inicial */
  --canvas-light: #F5F5F7;      /* fondo paneles */
  --surface: rgb(255 255 255 / .72);
  --surface-glass: rgb(255 255 255 / .08);
  --surface-raised: #FFFFFF;
  --hairline: rgb(0 0 0 / .08);          /* borde 1px */
  --hairline-glass: rgb(255 255 255 / .18);

  /* Texto */
  --ink: #1D1D1F;
  --ink-muted: #6E6E73;
  --ink-on-dark: #F5F5F7;

  /* ÚNICO acento: dorado de la moneda (acciones primarias) */
  --accent: #C9A24B;
  --accent-ink: #1D1608;

  /* Semánticos de estado (solo para estados, nunca decorativos) */
  --ok: #248A3D;  --warn: #B25E09;  --danger: #D70015;

  /* Forma */
  --r-sm: 10px; --r-md: 16px; --r-lg: 24px; --r-pill: 999px;
  --blur: 24px;
}
```

## Tipografía
- Display y Body: **Inter** (variable). Pesos permitidos: 400, 500, 600. Sin 700+.
- Escala: 13 / 15 / 17 / 22 / 34 / 56 px. Tracking display: -0.02em.
- Cifras de dinero: `font-variant-numeric: tabular-nums`.

## Superficies
- Vidrio líquido: `backdrop-filter: blur(var(--blur)) saturate(1.4)`, fondo `--surface-glass`, borde hairline 1px `--hairline-glass`. Solo en la pantalla inicial y en el encabezado.
- Paneles de trabajo (cliente, admin): superficies planas claras, sin sombras fuertes; elevación = borde hairline.
- Densidad: cliente = espaciosa; admin = media (tablas compactas).

## Pantalla inicial
- Fondo oscuro con orbes de color difuminados muy sutiles (CSS puro).
- Arriba: `DIGITBANK` (Inter 600, mayúsculas, tracking +0.18em).
- Centro: moneda de Digitbank girando sobre su eje (CSS 3D `rotateY`, 12 s, linear, infinita; respeta `prefers-reduced-motion`).
- Dos botones: «Solicitar crédito» (acento dorado) y «Cliente» (vidrio).

## Prohibido
Gradientes cian/púrpura, tarjetas idénticas en rejilla, sombras grandes, más de un acento, negritas pesadas.

## Accesibilidad
Contraste AA mínimo, foco visible 2px con `--accent`, objetivos táctiles ≥ 44px, mobile-first.
