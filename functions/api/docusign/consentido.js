// Regreso de DocuSign después de autorizar la conexión global (una sola vez). No hace falta canjear el código:
// con autorizar basta para que el servidor pueda entrar con JWT.
const pagina = (titulo, texto) => new Response(`<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;color:#1f2937">
<h1 style="font-size:22px">${titulo}</h1><p>${texto}</p><p><a href="/#/ajustes">Volver a la app</a></p></body></html>`,
{ headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  if (q.get('error')) return pagina('No se autorizó', 'DocuSign no dio la autorización. Vuelve a intentarlo desde Ajustes → DocuSign.');
  return pagina('Listo', 'DocuSign quedó autorizado para enviar los contratos del despacho. Ya puedes cerrar esta pestaña.');
}
