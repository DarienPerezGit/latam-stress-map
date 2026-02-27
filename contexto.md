# Contexto del Proyecto: Macro Stress Map

## 🌍 Visión General
"Macro Stress Map" es una plataforma interactiva en tiempo real que visualiza el estrés macroeconómico de América Latina. Funciona como un monitor tipo "War Room" financiero. El MVP actual está en producción e incluye 6 países clave: Argentina (AR), Brasil (BR), Chile (CL), Colombia (CO), México (MX) y Perú (PE).

**URL de Producción:** `https://latam-stress-map.vercel.app`
**Repositorio:** `https://github.com/DarienPerezGit/latam-stress-map`

## 🛠️ Stack Tecnológico
* **Framework:** Next.js (App Router, v16.1.6), React 19.
* **Renderizado 3D:** React Three Fiber (`@react-three/fiber`, `@react-three/drei`), Three.js (v0.183.1).
* **Backend / Base de Datos:** Supabase (PostgreSQL) para almacenar las métricas financieras (FRED, Alpha Vantage).
* **Infraestructura:** Vercel (Edge Functions para API, Web Analytics integrado).
* **Generación de Imágenes (OG Cards):** Satori (SVG a Base64) para renderizado dinámico de tarjetas en X/Twitter.
* **Package Manager:** `pnpm` (v10+).

## 🧩 Arquitectura y Componentes Clave
1. **Globo Holográfico (WebGL):** Un globo terráqueo interactivo en 3D con marcadores animados (shockwave rings) que cambian de color (verde, amarillo, rojo) según el nivel de riesgo (0-100) del país.
2. **Panel de UI (Glassmorphism):** Un panel lateral (`SidePanel.tsx`) superpuesto al canvas 3D que muestra:
   * Ranking en vivo de los países (Ej: BR 98.2 CRITICAL).
   * Detalles por país con *sparklines* de 30 días para 5 variables: FX Volatility, Inflation, Sovereign Risk, Crypto Hedge, y Reserves.
3. **Motor Viral (Satori):** Una ruta API en `/api/snapshot/[iso2]/route.tsx` conectada a un botón "SHARE ↗". Genera metadatos OG y una imagen de impacto para compartir en redes sociales.
4. **Telemetría:** `@vercel/analytics` implementado en `layout.tsx` para medir el tráfico y la interacción (principalmente móvil).

## ⚠️ Entorno de Desarrollo Local (RESTRICCIÓN CRÍTICA)
El desarrollo actual se está realizando en una notebook Windows con **solo 4GB de RAM** usando **GitHub CLI (`gh`)**.
* **Problema conocido:** El renderizado de Next.js + Three.js consume mucha memoria y puede causar un *Out of Memory (OOM) silent crash*.
* **Regla estricta para el agente:** Para cualquier comando de instalación (`pnpm install`), ejecución (`pnpm dev`) o compilación local, SE DEBE limitar la memoria de Node.js previamente usando:
  `set NODE_OPTIONS=--max-old-space-size=1536` (en CMD) o `$env:NODE_OPTIONS='--max-old-space-size=1536'` (en PowerShell).
* En producción (Vercel), el límite está configurado a `4096`.

## 🚀 Roadmap Inmediato (Próximas Tareas)
1. **Responsive WebGL (Prioridad Alta):** Actualmente, en pantallas de dispositivos móviles (9:16), el panel de UI (glassmorphism) tapa físicamente a los países del Cono Sur (Argentina, Chile). Se necesita ajustar dinámicamente la posición de la cámara o la malla del globo en el eje Y cuando se detecta una pantalla móvil, para que Sudamérica flote por encima del panel.
2. **Optimización de Rendimiento:** Asegurar que el *canvas* 3D no drene la batería ni congele dispositivos móviles de gama media, monitoreando el *Bounce Rate* en Vercel Analytics.