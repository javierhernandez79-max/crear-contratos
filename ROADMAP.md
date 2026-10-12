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
- **Formato Word** (2026-10-10): Arial 10, márgenes laterales de 3 cm, encabezado "1 | Página" + título espaciado, datos capturados en negritas.
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
| 2 | ✅ **Dropbox**: carpeta compartida para catálogo, contratos y anexos de las partes (INE, actas, poderes); adjuntarlos al documento. | Habilita el trabajo de los 3 usuarios. Javier pidió adelantarlo antes que Word. El catálogo vivirá como Excel en la carpeta compartida. | Hecho |
| 3 | ✅ **Exportar a Word (.docx)** + flujo Borrador → En revisión → Aprobado → PDF. Montos en letra. | Es el flujo real de trabajo con los abogados. | Hecho: correcciones en la app (opción a), aprobación por cualquiera, archivos en `<expediente>/CONTRATOS/<título>/`, edición de plantillas. Documentos marco por subir a `PLANTILLAS MARCO/` |
| 4 | **Actas de asamblea**: ordinaria/extraordinaria (SA, SAPI, S de RL). Orden del día, lista de asistencia y quórum calculados con los accionistas del catálogo, resoluciones, delegado especial. | Segundo tipo de documento prioritario. | Pospuesta (2026-10-11): se retoma cuando Javier tenga las actas marco |
| 5 | ✅ **Generación en lote desde Excel** (contratos individuales de trabajo): una fila = un contrato; salida en .docx/.zip. | Alto ahorro de tiempo; requiere 1 y 3. | Hecho: Excel P1 (+ columnas Lugar de Trabajo, Fecha de Firma y Fecha de Terminación), una empresa y una plantilla por lote, periodicidad capturada por lote, género ajustado por sexo, validación de RFC/CURP, aprobación de cualquiera de los 3, salida solo .zip; los trabajadores no entran al catálogo; el tipo (determinado/indeterminado) lo define la plantilla elegida en el lote, el P1 ya no lleva columna Tipo (2026-10-12) |
| 5b | ✅ **Contratos de servicios desde el Excel “Sugerido de conceptos”**: un contrato de prestación de servicios por empresa del grupo para un mismo cliente; objeto = lista de conceptos sin clave SAT. | Pedido por Javier (2026-10-11). | Hecho: cliente del catálogo (búsqueda por nombre parcial) o capturado en pantalla sin guardarse; empresas emparejadas de forma flexible (tolera errores de captura); sin montos; plantilla marco de servicios con `{{servicios}}` en la cláusula de OBJETO |
| 5c | ✅ **Comisión mercantil en lote** desde el mismo Excel P1: un contrato por comisionista. | Pedido por Javier (2026-10-12). | Hecho (decidido: mismo P1, lote aparte, texto fijo salvo el lugar de firma): la plantilla con firmantes comitente/comisionista aparece en Nuevo lote; solo pide nombre, RFC, CURP, domicilio y Fecha de Firma; sin periodicidad ni sexo; “Lugar de firma” capturable en el lote (Ciudad de México por omisión); no entra a vencimientos |
| 6 | ✅ **Vencimientos y alertas**: fecha de término/renovación por contrato, tablero de próximos a vencer. | Control posterior a la firma. | Hecho (decidido 2026-10-11): solo trabajadores por tiempo determinado de lotes aprobados (Fecha de Terminación del P1); anticipación configurable en Ajustes, 15 días por omisión; alertas dentro de la app (tablero, contador en el menú y aviso en inicio); se marcan como atendidos (renovado/terminado) |
| 6b | ✅ **Aviso de firma de contratos de servicios**: días hábiles desde que se generó el contrato; pasados 15 sin marcarse como firmado, se avisa. | Pedido por Javier (2026-10-12). | Hecho: lunes a viernes sin días de descanso obligatorio (art. 74 LFT); aplica también a los contratos existentes; contador en la lista y en el contrato; aviso en inicio, contador del menú y sección en Vencimientos; desaparece al marcar el contrato como firmado (o firmarse en DocuSign); se puede descartar con motivo |
| 7 | **Firma remota** de la contraparte (proveedor externo, p. ej. Mifiel/DocuSign, o liga propia). | Necesaria, pero la más costosa; conviene tener el flujo resuelto antes. | Pendiente: faltan respuestas de Javier (qué contratos, si las contrapartes tienen e.firma, presupuesto y volumen mensual) para elegir proveedor o liga propia |
| 8 | ✅ **Extracción automática** (decidido: con revisión antes de aplicar y sin API de IA de pago; solo CSF y PDFs con texto, los escaneados se capturan a mano) de datos del expediente en Dropbox (actas constitutivas, poderes) para llenar el catálogo. | Ahorra captura, pero es lo más incierto técnicamente. | Hecho: botón “Llenar desde PDF” en la ficha del catálogo; PDF del expediente en Dropbox o del equipo; detecta Constancia de Situación Fiscal, escritura constitutiva o poder (se puede cambiar); muestra cada dato con el valor actual, marcados solo los vacíos, editables antes de aplicar; el poder se aplica a un apoderado existente (sugerido por nombre) o a uno nuevo; avisa si el PDF es escaneado |
| 9 | **Móvil y sincronización** entre dispositivos. | Se pidió empezar solo con computadora. | Pendiente: definir alcance en móvil (consulta, aprobación, firma o captura completa) |
| 10 | Cálculo de IVA/retenciones y tablas de pagos. | Opcional. | Pendiente: definir a qué contratos aplica |

## Cambios recientes (2026-10-12)
- Se quitaron de la biblioteca las plantillas incluidas “Contrato individual de trabajo” y “Contrato de prestación de servicios”; las reemplazan las plantillas marco de Dropbox.
- Plantilla marco de comisión mercantil: “cuenta con inscripción en el Registro Federal de Contribuyentes” (antes “empadronada”) y lugar de firma como variable `{{lugar_firma}}`.
- Guía de uso para el equipo en Google Slides (13 diapositivas, con logo de COH), en el Drive de la cuenta del equipo.

## Pendientes y limitaciones conocidas
- **Siguiente punto del backlog**: por decidir entre 7, 9 y 10 (4 espera las actas marco).
- **e.firma**: no se valida la cadena del certificado contra las raíces del SAT.
- **Extracción de PDF**: probada solo con documentos ficticios; falta probarla con CSF, escrituras y poderes reales del expediente.
- **README**: la lista de plantillas aún menciona las que se quitaron.
