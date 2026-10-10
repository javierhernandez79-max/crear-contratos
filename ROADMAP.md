# Roadmap – Crear Contratos

Backlog priorizado. Se construye una funcionalidad a la vez; no se avanza a la siguiente sin aprobación de Javier.

## Contexto (respuestas de Javier, 2026-10-09)
- **Documentos**: contratos y actas de asamblea; después se agregan más tipos.
- **Usuarios**: 3 (Javier + 2 abogados).
- **Datos**: catálogo de empresas propias precargado; expediente corporativo de cada una en Dropbox. Solo se capturan las personas físicas/morales externas.
- **Lote**: necesario, sobre todo para contratos individuales de trabajo.
- **Montos/IVA**: opcional.
- **Salida**: primero Word (.docx) para revisión; ya aprobado, PDF.
- **Firma remota**: necesaria en algunos casos.
- **Dispositivos**: arrancar en computadora; después móvil.
- **Vencimientos**: sí, con alertas.
- **Documentos de las partes**: se suben a Dropbox y se incluyen desde ahí.
- **Catálogo** (2026-10-09): ~30 empresas propias, cambian con el tiempo. Campos según cada contrato marco. Varios apoderados por empresa; siempre preguntar quién firma. No hay Excel previo: la app genera uno que queda como catálogo, actualizable a mano o automáticamente. Dropbox va antes que Word.

## Arquitectura
**Dropbox como almacén compartido** (catálogo en Excel, contratos, plantillas y expedientes en una carpeta del equipo), sin servidor propio; cada equipo mantiene copia local (IndexedDB) y sincroniza. La firma remota sí requerirá un proveedor externo o un servidor.
Publicada en https://documentos-legales-s0c.pages.dev (Cloudflare Pages, despliegue automático desde `main`), protegida con Cloudflare Access (código por correo, solo el equipo legal).
Dropbox Business (team space): carpeta `/Legal - Documentos App`, expedientes en `EXPEDIENTES CORPORATIVOS RM/<empresa>`.
App de Dropbox "Documentos Legales" (App key en `js/config.js`; la App secret no se usa con PKCE y no debe guardarse en el repositorio). Redirect URI `https://documentos-legales-s0c.pages.dev/`.

## Backlog

| # | Funcionalidad | Por qué va en este lugar | Estado |
|---|---|---|---|
| 1 | ✅ **Catálogo de partes**: empresas propias (razón social, RFC, domicilio, escritura constitutiva, notario, folio mercantil, accionistas, apoderados y sus poderes) y contrapartes (PF/PM). Al elegir una parte, se llenan solas sus variables. | Base de todo lo demás: actas, lote y contratos dependen de estos datos. | Hecho (Excel importable/exportable) |
| 2 | ✅ **Dropbox**: carpeta compartida para catálogo, contratos y anexos de las partes (INE, actas, poderes); adjuntarlos al documento. | Habilita el trabajo de los 3 usuarios. Javier pidió adelantarlo antes que Word. El catálogo vivirá como Excel en la carpeta compartida. | Hecho (falta crear la app en Dropbox y publicar la URL) |
| 3 | ✅ **Exportar a Word (.docx)** + flujo Borrador → En revisión → Aprobado → PDF. Montos en letra. | Es el flujo real de trabajo con los abogados. | Hecho: correcciones en la app (opción a), aprobación por cualquiera, archivos en `<expediente>/CONTRATOS/<título>/`, edición de plantillas. Documentos marco por subir a `PLANTILLAS MARCO/` |
| 4 | **Actas de asamblea**: ordinaria/extraordinaria (SA, SAPI, S de RL). Orden del día, lista de asistencia y quórum calculados con los accionistas del catálogo, resoluciones, delegado especial. | Segundo tipo de documento prioritario. | Pendiente |
| 5 | **Generación en lote desde Excel** (contratos individuales de trabajo): una fila = un contrato; salida en .docx/.zip. | Alto ahorro de tiempo; requiere 1 y 3. | Pendiente |
| 6 | **Vencimientos y alertas**: fecha de término/renovación por contrato, tablero de próximos a vencer. | Control posterior a la firma. | Pendiente |
| 7 | **Firma remota** de la contraparte (proveedor externo, p. ej. Mifiel/DocuSign, o liga propia). | Necesaria, pero la más costosa; conviene tener el flujo resuelto antes. | Pendiente |
| 8 | **Extracción automática** (decidido: con revisión antes de aplicar; pendiente confirmar si se usa API de IA de pago, necesaria para escaneados; sin ella solo CSF y PDFs con texto) de datos del expediente en Dropbox (actas constitutivas, poderes) para llenar el catálogo. | Ahorra captura, pero es lo más incierto técnicamente. | Pendiente |
| 9 | **Móvil y sincronización** entre dispositivos. | Se pidió empezar solo con computadora. | Pendiente |
| 10 | Cálculo de IVA/retenciones y tablas de pagos. | Opcional. | Pendiente |
