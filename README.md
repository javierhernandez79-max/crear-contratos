# Crear Contratos – Legales (PWA)

App web instalable para crear, personalizar, firmar y exportar contratos. Funciona sin conexión y guarda todo **solo en el dispositivo** (IndexedDB); no hay servidor ni cuentas.

## Funciones
- Biblioteca de plantillas: NDA mutuo y unilateral, prestación de servicios, consultoría, contrato laboral, acuerdo entre socios, cesión de PI, licencia de uso, compraventa y documento en blanco.
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
- `js/templates.js` — plantillas y cláusulas (edítalas aquí)
- `js/pdf.js` — generación de PDF (jsPDF 2.5.1 en `vendor/`)
- `js/signature.js` — panel de firma autógrafa
- `js/efirma.js` — firma electrónica avanzada (node-forge 1.3.1 en `vendor/`, se carga solo al usarla)
- `js/db.js` — IndexedDB

> Las plantillas son modelos generales y no sustituyen asesoría legal.
