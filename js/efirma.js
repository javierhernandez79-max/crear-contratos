// Firma electrónica avanzada con e.firma (SAT) u otro certificado X.509 con llave RSA.
// Todo ocurre en el navegador: la llave privada y su contraseña nunca se guardan ni se envían.
const OID_UNIQUE_ID = '2.5.4.45'; // x500UniqueIdentifier → "RFC / RFC representante"
const OID_SERIAL = '2.5.4.5'; // serialNumber → "CURP / CURP representante"

let forgeReady;
export function loadForge() {
  if (window.forge) return Promise.resolve(window.forge);
  forgeReady ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'vendor/forge.min.js' });
    s.onload = () => resolve(window.forge);
    s.onerror = () => { forgeReady = null; reject(new Error('No se pudo cargar el módulo de firma')); };
    document.head.appendChild(s);
  });
  return forgeReady;
}

const readBinary = async (file) => {
  const buf = new Uint8Array(await file.arrayBuffer());
  let out = '';
  for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return out;
};

/** Acepta DER (.cer del SAT) o PEM. */
function toAsn1(forge, binary, pemLabel) {
  if (binary.includes(`-----BEGIN ${pemLabel}`) || binary.includes('-----BEGIN')) {
    const msg = forge.pem.decode(binary)[0];
    return forge.asn1.fromDer(msg.body);
  }
  return forge.asn1.fromDer(binary);
}

const utf8 = (forge, v) => { try { return forge.util.decodeUtf8(v); } catch { return v; } };

export function certInfo(forge, cert) {
  const field = (attrs, key) => {
    const a = attrs.find((x) => x.type === key || x.shortName === key || x.name === key);
    return a ? utf8(forge, a.value).trim() : '';
  };
  const subj = cert.subject.attributes;
  const iss = cert.issuer.attributes;
  // El SAT codifica el número de certificado (20 dígitos) como ASCII en hexadecimal
  const hex = cert.serialNumber;
  const ascii = /^(3[0-9])+$/.test(hex) ? hex.match(/../g).map((h) => String.fromCharCode(parseInt(h, 16))).join('') : hex;
  const issuerName = field(iss, 'CN') || field(iss, 'O');
  return {
    name: field(subj, 'CN') || field(subj, 'O'),
    rfc: field(subj, OID_UNIQUE_ID).split('/')[0].trim(),
    curp: field(subj, OID_SERIAL).split('/')[0].trim(),
    email: field(subj, 'E') || field(subj, 'emailAddress'),
    certNumber: ascii,
    issuer: issuerName,
    isSAT: /SERVICIO DE ADMINISTRACI/i.test(iss.map((a) => utf8(forge, a.value)).join(' ')),
    validFrom: cert.validity.notBefore.getTime(),
    validTo: cert.validity.notAfter.getTime(),
  };
}

export async function readCertificate(file) {
  const forge = await loadForge();
  let cert;
  try {
    cert = forge.pki.certificateFromAsn1(toAsn1(forge, await readBinary(file), 'CERTIFICATE'));
  } catch {
    throw new Error('El archivo .cer no es un certificado válido.');
  }
  return { cert, info: certInfo(forge, cert) };
}

export async function readPrivateKey(file, password, cert) {
  const forge = await loadForge();
  let asn1;
  try {
    asn1 = toAsn1(forge, await readBinary(file), 'ENCRYPTED PRIVATE KEY');
  } catch {
    throw new Error('El archivo .key no es una llave privada válida.');
  }
  let key = null;
  try {
    const info = forge.pki.decryptPrivateKeyInfo(asn1, password);
    if (info) key = forge.pki.privateKeyFromAsn1(info);
  } catch { /* contraseña incorrecta o formato no soportado */ }
  if (!key) throw new Error('La contraseña de la llave privada es incorrecta.');
  if (!key.n || !cert.publicKey.n || key.n.compareTo(cert.publicKey.n) !== 0) {
    throw new Error('La llave privada (.key) no corresponde al certificado (.cer).');
  }
  return key;
}

/** Firma el texto canónico del contrato. Devuelve sólo datos públicos. */
export async function signText(text, cert, privateKey) {
  const forge = await loadForge();
  const bytes = forge.util.encodeUtf8(text);
  const md = forge.md.sha256.create();
  md.update(bytes);
  const hash = md.digest().toHex();
  const signature = forge.util.encode64(privateKey.sign(md));

  // PKCS#7 / CMS desacoplado (.p7s) verificable con OpenSSL u otras herramientas
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(bytes);
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const p7s = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  return { hash, signature, p7s, certPem: forge.pki.certificateToPem(cert), info: certInfo(forge, cert) };
}

/** Verifica criptográficamente una firma contra el texto actual del contrato. */
export async function verifySignature(sig, currentText) {
  const forge = await loadForge();
  const cert = forge.pki.certificateFromPem(sig.certPem);
  const md = forge.md.sha256.create();
  md.update(forge.util.encodeUtf8(sig.signedText));
  let signatureOk = false;
  try { signatureOk = cert.publicKey.verify(md.digest().bytes(), forge.util.decode64(sig.signature)); } catch { /* firma corrupta */ }
  const hashOk = md.digest().toHex() === sig.hash;
  const unchanged = sig.signedText === currentText;
  const certValidAtSigning = sig.date >= cert.validity.notBefore.getTime() && sig.date <= cert.validity.notAfter.getTime();
  return { signatureOk: signatureOk && hashOk, unchanged, certValidAtSigning, valid: signatureOk && hashOk && unchanged && certValidAtSigning };
}

export const base64ToBlob = (b64, type) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
};
