# Material del despacho (no se sube al repositorio)

Las pruebas que generan documentos con las plantillas reales del despacho leen estos archivos. Esta carpeta está en `.gitignore`: el repositorio es público y nada de esto debe subirse.

Se copian aquí desde el respaldo `pruebas-privado.zip` (guardado fuera del repositorio), con esta estructura:

```
privado/
  marco/out/u-marco-*.json        plantillas marco (servicios, trabajo, comisión, confidencialidad)
  fmt/formatos-cps.json           formatos de servicios F1–F12
  sug/u-marco-servicios.json      plantilla de servicios para el Sugerido de conceptos
  cti/original.docx               contrato de trabajo original (subida de Word)
  p1-dl.xlsx                      P1 del despacho
  p1/entrega/P1 - plantilla.xlsx  P1 vacío del despacho
```

Si falta, `correr.sh` marca esas pruebas como **SIN MATERIAL** en lugar de correrlas.
