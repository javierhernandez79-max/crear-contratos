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

## Decisión de arquitectura pendiente
Hoy todo vive en el navegador de un solo equipo (IndexedDB). Con 3 usuarios, catálogo compartido y Dropbox, eso ya no alcanza. Propuesta: **Dropbox como almacén compartido** (catálogo, contratos y anexos en una carpeta del equipo), sin servidor propio. La firma remota sí requerirá un proveedor externo o un servidor.

## Backlog

| # | Funcionalidad | Por qué va en este lugar | Estado |
|---|---|---|---|
| 1 | **Catálogo de partes**: empresas propias (razón social, RFC, domicilio, escritura constitutiva, notario, folio mercantil, accionistas, apoderados y sus poderes) y contrapartes (PF/PM). Al elegir una parte, se llenan solas sus variables. | Base de todo lo demás: actas, lote y contratos dependen de estos datos. | Pendiente |
| 2 | **Exportar a Word (.docx)** + flujo Borrador → En revisión → Aprobado → PDF. Montos en letra. | Es el flujo real de trabajo con los abogados. | Pendiente |
| 3 | **Actas de asamblea**: ordinaria/extraordinaria (SA, SAPI, S de RL). Orden del día, lista de asistencia y quórum calculados con los accionistas del catálogo, resoluciones, delegado especial. | Segundo tipo de documento prioritario. | Pendiente |
| 4 | **Generación en lote desde Excel** (contratos individuales de trabajo): una fila = un contrato; salida en .docx/.zip. | Alto ahorro de tiempo; requiere 1 y 2. | Pendiente |
| 5 | **Dropbox**: carpeta compartida para catálogo, contratos y anexos de las partes (INE, actas, poderes); adjuntarlos al documento. | Habilita el trabajo de los 3 usuarios. | Pendiente |
| 6 | **Vencimientos y alertas**: fecha de término/renovación por contrato, tablero de próximos a vencer. | Control posterior a la firma. | Pendiente |
| 7 | **Firma remota** de la contraparte (proveedor externo, p. ej. Mifiel/DocuSign, o liga propia). | Necesaria, pero la más costosa; conviene tener el flujo resuelto antes. | Pendiente |
| 8 | **Extracción automática** de datos del expediente en Dropbox (actas constitutivas, poderes) para llenar el catálogo. | Ahorra captura, pero es lo más incierto técnicamente. | Pendiente |
| 9 | **Móvil y sincronización** entre dispositivos. | Se pidió empezar solo con computadora. | Pendiente |
| 10 | Cálculo de IVA/retenciones y tablas de pagos. | Opcional. | Pendiente |
