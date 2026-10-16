# Pruebas automáticas

Pruebas de extremo a extremo (Playwright en Chromium) y unitarias de la app. Dropbox y DocuSign se simulan (`mockdbx.mjs` y rutas interceptadas en cada prueba): ninguna prueba toca cuentas reales.

## Correr

```bash
cd pruebas
./correr.sh          # todas
./correr.sh lote     # solo las que tienen "lote" en el nombre
```

`correr.sh` levanta la app en `http://localhost:5173` (si no está ya levantada), copia los datos a `salida/` y corre cada prueba. Al final dice cuántas pasan, cuáles fallan (con su registro en `salida/*.log`) y cuáles no se corrieron por falta del material del despacho.

Requisitos: Node 18+, Python 3 y Chromium de Playwright (`npx playwright install chromium`), o la variable `CHROMIUM` con la ruta de un Chromium ya instalado.

## Datos

- `datos/`: archivos ficticios (P1 de prueba, catálogos, Word de ejemplo). Se pueden subir al repositorio.
- `privado/`: material real del despacho (plantillas marco, formatos F1–F12, P1, Sugerido). **No se sube**: está en `.gitignore`. Ver `privado/LEEME.md`.

Los nombres de clientes y empresas en las pruebas son ficticios (ALFADOC, BETAMAR, EPSILON…). El correo autorizado para *Borrar datos de prueba* no aparece: `limpiar-e2e.mjs` sustituye el hash de `js/app.js` por el de un correo de ejemplo.

## Regla para cambios

Antes de fusionar un PR que cambie la app, correr `./correr.sh` y revisar que no haya fallas nuevas.
