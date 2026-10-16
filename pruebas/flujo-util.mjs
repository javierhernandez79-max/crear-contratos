// Pasos del contrato (Documento → Revisión → Aprobación): genera el Word de revisión si falta y aprueba.
// Devuelve la descarga del aprobado.
export async function aprobar(pg) {
  await pg.waitForSelector('#app [data-wf=approve], #app [data-wf=revision]');
  if (!(await pg.locator('#app [data-wf=approve]').count())) {
    await Promise.all([pg.waitForEvent('download', { timeout: 8000 }).catch(() => null), pg.click('#app [data-wf=revision]')]);
    await pg.waitForSelector('#app [data-wf=approve]');
  }
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#app [data-wf=approve]').then(() => pg.click('dialog[open] button[value=ok]'))]);
  return dl;
}
