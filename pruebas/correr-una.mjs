// Corre una prueba y termina el proceso en cuanto acaba (varias dejan abierto el navegador o el simulador)
import { pathToFileURL } from 'url';
import { resolve } from 'path';
const archivo = process.argv[2];
process.argv.splice(2, 1); // la prueba recibe sus argumentos como si la llamaran directo
try {
  await import(pathToFileURL(resolve(archivo)).href);
  process.exit(process.exitCode ?? 0);
} catch (err) {
  console.log('Error: ' + (err?.stack || err));
  process.exit(1);
}
