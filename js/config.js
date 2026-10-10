// Configuración del equipo. La App key de Dropbox no es secreta (se usa PKCE, sin "app secret"):
// escríbela aquí para que nadie tenga que capturarla en Ajustes.
export const DROPBOX_APP_KEY = 'k48s9k4a17alpe3';
// Apps de Dropbox anteriores: los equipos que las tengan guardadas pasan a la nueva y se reconectan.
export const DROPBOX_RETIRED_KEYS = ['16o22x7le8ff56i'];
// Carpeta compartida donde vive todo: catálogo en Excel, expedientes y datos de la app.
// En Dropbox Business la ruta se escribe desde la raíz del equipo.
export const DROPBOX_FOLDER = '/Legal - Documentos App';
// Subcarpeta (dentro de la anterior) con una carpeta por empresa o persona.
export const DROPBOX_EXPEDIENTES = 'EXPEDIENTES CORPORATIVOS RM';
