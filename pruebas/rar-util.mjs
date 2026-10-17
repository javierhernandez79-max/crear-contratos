// RAR 4 mínimo, sin compresión (método "store"), para las pruebas
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function mkRar(files) {
  const parts = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])];
  const block = (type, flags, rest) => {
    const h = Buffer.alloc(7 + rest.length); h.writeUInt8(type, 2); h.writeUInt16LE(flags, 3); h.writeUInt16LE(h.length, 5); rest.copy(h, 7);
    h.writeUInt16LE(crc32(h.subarray(2)) & 0xffff, 0); return h;
  };
  parts.push(block(0x73, 0, Buffer.alloc(6)));
  for (const { name, data } of files) {
    const n = Buffer.from(name); const r = Buffer.alloc(25 + n.length);
    r.writeUInt32LE(data.length, 0); r.writeUInt32LE(data.length, 4); r.writeUInt8(2, 8); r.writeUInt32LE(crc32(data), 9);
    r.writeUInt32LE(0x5a210000, 13); r.writeUInt8(20, 17); r.writeUInt8(0x30, 18); r.writeUInt16LE(n.length, 19); r.writeUInt32LE(0x20, 21); n.copy(r, 25);
    parts.push(block(0x74, 0x8000, r), data);
  }
  parts.push(block(0x7b, 0x4000, Buffer.alloc(0)));
  return Buffer.concat(parts);
}
