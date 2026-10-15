// Configuración del equipo. La App key de Dropbox no es secreta (se usa PKCE, sin "app secret"):
// escríbela aquí para que nadie tenga que capturarla en Ajustes.
export const DROPBOX_APP_KEY = 'wu2ha1sgj1gqeyc';
// Apps de Dropbox anteriores: los equipos que las tengan guardadas pasan a la nueva y se reconectan.
export const DROPBOX_RETIRED_KEYS = ['16o22x7le8ff56i', 'k48s9k4a17alpe3'];
// Carpeta compartida donde vive todo: catálogo en Excel, expedientes y datos de la app.
// En Dropbox Business la ruta se escribe desde la raíz del equipo.
export const DROPBOX_FOLDER = '/Legal - Documentos App';
// Subcarpeta (dentro de la anterior) con una carpeta por empresa o persona.
export const DROPBOX_EXPEDIENTES = 'EXPEDIENTES CORPORATIVOS RM';
// Carpeta de clientes y contrapartes; dentro, dos raíces con una carpeta por cliente:
// los documentos que genera la app (de clientes y empresas del grupo) y los expedientes corporativos (acta, CSF…)
export const DROPBOX_CLIENTES = 'EXPEDIENTES CLIENTES';
export const DROPBOX_GENERADOS = 'EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP';
export const DROPBOX_CORP_CLIENTES = 'EXPEDIENTES CLIENTES/EXPEDIENTES CORPORATIVOS CLIENTES';
// DocuSign (firma remota): Integration Key de la app "Documentos Legales" (no es secreto) y ambiente:
// 'demo' = cuenta de pruebas gratuita; 'prod' = cuenta de pago ya aprobada por DocuSign ("go-live").
export const DOCUSIGN_INTEGRATION_KEY = '4964b75c-8dfc-4ab9-8038-a748d41d4cf1';
export const DOCUSIGN_ENV = 'demo';
