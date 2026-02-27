# Roadmap V2: Macro Stress Map (Nivel Institucional y Web3)

## 🎯 Visión General
El objetivo de la Fase 2 es transformar el MVP (visualización de estado actual) en una plataforma predictiva, histórica y accionable. El mapa dejará de ser solo un monitor pasivo para convertirse en un oráculo de datos financieros que justifique y alimente nuevas infraestructuras económicas en América Latina.

## 🚀 Nuevas Features (Backlog Arquitectónico)

### 1. El "Stablecoin Premium" (Índice de Estrés Cripto)
Integración de datos *on-chain* y de *exchanges* para medir el pánico de liquidez en tiempo real, calculado a través del *spread* entre el tipo de cambio oficial y el valor de *stablecoins* (USDT/USDC) en mercados P2P.
* **Mercado de Prueba (Conejillo de Indias):** Argentina (USDT vs ARS). La brecha cambiaria actuará como el termómetro perfecto del miedo fiduciario.
* **Impacto Estratégico:** Esta métrica posiciona al Macro Stress Map como un activo de valor fundacional dentro del ecosistema **Crecimiento**, demostrando con rigor matemático y visual por qué la región necesita adoptar rieles financieros Web3.
* **Implementación:** Edge Functions en Supabase o Vercel Cron Jobs para hacer *fetch* a APIs públicas (ej. Lemon, Buenbit, CriptoYa), normalizar la brecha a un score de 0-100 y guardarlo en la base de datos sin sobrecargar el cliente.

### 2. Sinergia con Infraestructura de Pagos
Convertir el índice de estrés (0-100) en una variable ejecutable (API) para integrarse con sistemas transaccionales.
* **Casos de Uso:** El score del mapa funcionará como un *trigger* automatizado para el proyecto **Infraestructura-de-pagos**. 
* **Acción:** Si el riesgo soberano o la volatilidad cambiaria de un país (ej. Brasil o Argentina) entra en estado "CRITICAL" (Score > 80), la infraestructura de pagos podrá ajustar dinámicamente los *spreads* de conversión o sugerir automáticamente rutas de liquidación en dólares digitales para proteger el capital en tránsito.

### 3. Máquina del Tiempo (Historical Playback)
Dotar al mapa de profundidad temporal para analizar el contagio de crisis pasadas.
* **UI/UX:** Un *slider* temporal en la interfaz (glassmorphism) que permita retroceder días, meses o años, viendo cómo el globo 3D reacciona retrospectivamente a eventos clave (elecciones, shocks inflacionarios).
* **Data Pipeline:** Transición de consultas de API al vuelo hacia un *Data Warehouse* propio en Supabase. Se almacenará un histórico diario (snapshots) procesado por un *worker* asíncrono.

### 4. Modo "Terminal" (B2B SaaS)
Una vista alternativa diseñada para analistas de riesgo, fondos de inversión y periodistas económicos que requieren densidad de datos por encima del impacto visual.
* **Data Grid:** Un *toggle* para apagar el renderizado WebGL (ahorrando recursos) y desplegar una tabla de alta densidad con los números crudos, comparativas *side-by-side* entre países y exportación a CSV.
* **API Comercial:** Empaquetar el algoritmo de normalización del *Stress Score* y ofrecerlo mediante API Keys para consumo de terceros.

---

## ⚠️ Restricciones Técnicas Vigentes (War Room Protocol)
* **Entorno Local Limitado:** El desarrollo activo se mantiene en hardware con 4GB de RAM.
* **Regla de Memoria:** Absolutamente **toda** la lógica pesada de procesamiento de datos, web scraping o llamadas múltiples a APIs para el *Stablecoin Premium* o el *Historical Playback* debe ocurrir del lado del servidor (Supabase Edge Functions / Vercel Serverless). 
* El cliente (Next.js local) debe mantenerse estricto a su tarea actual: consumir un JSON ligero y renderizar la interfaz. El límite `$env:NODE_OPTIONS='--max-old-space-size=1536'` sigue siendo ley para el entorno de desarrollo.