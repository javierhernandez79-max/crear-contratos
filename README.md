# Crear Contratos – Legales (PWA)

App web instalable para crear, personalizar, firmar y exportar contratos. Funciona sin conexión y guarda todo en el dispositivo (IndexedDB); opcionalmente se sincroniza con una carpeta compartida de Dropbox. No hay servidor propio.

## Funciones
- Biblioteca de plantillas: NDA mutuo y unilateral, prestación de servicios, consultoría, contrato laboral, acuerdo entre socios, cesión de PI, licencia de uso, compraventa y documento en blanco.
- **Catálogo de partes**: empresas del grupo y contrapartes (personas morales y físicas) con RFC, domicilio, escritura constitutiva, folio mercantil, apoderados con sus poderes y accionistas (con porcentaje calculado). Marca de "Activa" para dar de baja sin borrar.
  - En el contrato (pestaña Variables → *Partes del contrato*) se elige la parte por firmante; para personas morales **siempre pregunta qué apoderado firma**. Llena las variables de la plantilla y genera `{{prefijo_nombre}}`, `_rfc`, `_domicilio`, `_representante`, `_constitucion`, `_poder` y `_declaraciones` (párrafo completo de declaraciones). Un botón agrega la sección de Declaraciones.
  - Importar/exportar en Excel (.xlsx, hojas Partes, Apoderados y Accionistas). Plantilla vacía en `catalogo/catalogo-partes-plantilla.xlsx` o desde Catálogo → Exportar Excel con el catálogo vacío.
- **Dropbox (trabajo en equipo)**: cada usuario conecta su cuenta desde Ajustes (OAuth con PKCE, sin servidor). Todo vive en una carpeta compartida:
  - `catalogo-partes.xlsx` — el catálogo; se puede abrir y editar a mano en Excel (las filas nuevas reciben su ID en la siguiente sincronización).
  - `EXPEDIENTES CORPORATIVOS RM/<empresa>/` — documentos de las partes (subcarpeta configurable en `js/config.js`). Si la parte no tiene carpeta asignada, la app reconoce la existente por nombre (p. ej. "MERCASA DEL BAJIO" ↔ "Mercasa del Bajío, S.A. de C.V."). Desde la pestaña **Anexos** del contrato se suben o se eligen y se listan al final del PDF.
  - `datos-app/contratos/*.json` y `datos-app/plantillas/*.json` — datos de la app (no editar a mano).
  - Sincroniza al abrir, cada minuto, al volver a la ventana y unos segundos después de cada cambio. Se sube con control de versión (rev): si dos personas editan el mismo contrato a la vez, se conserva la versión de Dropbox y la otra queda como "copia en conflicto". El indicador ☁ (arriba a la derecha) muestra el estado; al tocarlo sincroniza.
  - Configuración: App key y carpeta en `js/config.js` (o en Ajustes). Pasos para crear la app de Dropbox en Ajustes → Dropbox → "Cómo obtener la App key". La Redirect URI a registrar es la dirección exacta donde se publica la app.
- **Word y PDF (flujo de revisión)**: pestaña *Word y PDF* del contrato con estados Borrador → En revisión → Aprobado → Firmado.
  - *Generar Word para revisión* crea `… - vN revision.docx` con la leyenda "EN REVISIÓN · vN". Los abogados anotan con control de cambios y las correcciones se aplican en la app; cualquier edición regresa el contrato a borrador.
  - *Aprobar* (cualquier usuario) genera `… - APROBADO.docx` y `.pdf` sin leyendas y registra quién y cuándo.
  - Se guardan en Dropbox en `<expediente de la empresa del grupo>/CONTRATOS/<título>/`; si la carpeta no existe se crea. Se puede elegir otra carpeta por contrato.
  - Montos en letra automáticos: `$150,000.00 (CIENTO CINCUENTA MIL PESOS 00/100 M.N.)`.
- **Editar plantillas**: cualquier plantilla (incluidas las de la app) se edita desde *Plantillas → Editar plantilla*: secciones, variables (detecta las que faltan), firmantes. Las de la app se guardan como versión modificada, se pueden restaurar y se comparten por Dropbox. Los contratos ya creados no cambian.
- Biblioteca de 14 cláusulas para agregar con un toque.
- Edición por secciones: agregar, eliminar, duplicar y reordenar (botones ↑↓ o arrastrar en escritorio).
- Variables `{{clave}}` con tipo (texto, fecha, monto, número, dirección, correo); se detectan solas y se completan en todo el documento. Moneda configurable.
- Vista previa con datos faltantes resaltados (toca uno para llenarlo); en pantallas anchas, vista previa en vivo junto al editor.
- Firmas por firmante, a elegir:
  - **Autógrafa**: dibujada con el dedo/mouse.
  - **Firma electrónica avanzada con e.firma (SAT)**: carga `.cer` + `.key` + contraseña; firma RSA-SHA256 del texto íntegro del contrato y genera un PKCS#7 (`.p7s`) verificable con OpenSSL. La llave privada y la contraseña se usan solo en memoria: no se guardan ni se envían. El PDF incluye un sello por firmante y una página de **constancia** (titular, RFC, CURP, número de certificado, emisor, vigencia, fecha, huella SHA-256, firma). Si el contrato cambia después de firmar, la firma se marca como inválida.
  - Verificación desde la app y descarga del `.p7s` y del texto firmado (`.txt`). Verificación externa: `openssl cms -verify -inform DER -in firma.p7s -content texto-firmado.txt -binary -noverify -out /dev/null`.
- Estado Borrador/Final.
- Versiones con nota (ver, restaurar, eliminar) y registro de cambios automático.
- Exportar PDF (tamaño carta, justificado, numeración, firmas, marca de agua "BORRADOR") y compartir con la hoja nativa del teléfono.
- Guardar cualquier contrato como plantilla propia; duplicar; autoguardado de borradores.
- Respaldo/importación en JSON desde Ajustes.

## Ejecutar en local
```bash
cd crear-contratos
python3 -m http.server 5173
```
Abrir http://localhost:5173. (El service worker requiere `localhost` o HTTPS; no funciona abriendo `index.html` como archivo.)

## Publicar
Es un sitio estático: sube la carpeta tal cual a cualquier hosting con HTTPS (Netlify, Vercel, GitHub Pages, Cloudflare Pages). Al cambiar archivos, sube el número en `CACHE` de `sw.js` para forzar la actualización offline.

## Estructura
- `index.html`, `manifest.webmanifest`, `sw.js` — cascarón de la PWA
- `js/app.js` — interfaz y navegación
- `js/model.js` — variables, versiones, historial
- `js/templates.js` — plantillas y cláusulas (edítalas aquí). Cada firmante puede llevar `bind` para indicar qué variables llena el catálogo
- `js/parties.js` — catálogo de partes: modelo, texto de declaraciones y vinculación con contratos
- `js/catalog-xlsx.js` — catálogo ⇄ Excel (ExcelJS 4.4.0 en `vendor/`, se carga solo al usarlo)
- `js/pdf.js` — generación de PDF (jsPDF 2.5.1 en `vendor/`)
- `js/docx-export.js` — generación de Word (docx 9.5.1 en `vendor/`, se carga solo al usarlo)
- `js/letras.js` — montos en letra
- `js/signature.js` — panel de firma autógrafa
- `js/efirma.js` — firma electrónica avanzada (node-forge 1.3.1 en `vendor/`, se carga solo al usarla)
- `js/dropbox.js` — cliente de la API de Dropbox (OAuth PKCE, carga y descarga)
- `js/sync.js` — sincronización de contratos, plantillas y catálogo con la carpeta compartida
- `js/config.js` — App key de Dropbox y carpeta compartida
- `js/db.js` — IndexedDB

> Las plantillas son modelos generales y no sustituyen asesoría legal.
