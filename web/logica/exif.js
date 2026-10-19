// Lê só a hora em que a foto foi tirada (DateTimeOriginal) do EXIF de um JPEG.
// Precisa ser antes de redimensionar: o canvas joga o EXIF fora.

const TAG_EXIF_IFD = 0x8769, TAG_DATA_ORIGINAL = 0x9003, TAG_DATA = 0x0132;

/** buffer = ArrayBuffer com o começo do arquivo (64–128 KB bastam). → "2026-10-18T14:03:22" ou null */
export function dataDaFoto(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marcador = v.getUint16(p);
    if ((marcador & 0xff00) !== 0xff00) return null;
    const tam = v.getUint16(p + 2);
    if (marcador === 0xffe1 && p + 10 <= v.byteLength && texto(v, p + 4, 4) === "Exif") {
      return lerTiff(v, p + 10, Math.min(v.byteLength, p + 2 + tam));
    }
    if (marcador === 0xffda) return null;  // começou a imagem: não tem EXIF
    p += 2 + tam;
  }
  return null;
}

function lerTiff(v, base, fim) {
  const ordem = texto(v, base, 2);
  if (ordem !== "II" && ordem !== "MM") return null;
  const le = ordem === "II";
  const u16 = (o) => v.getUint16(base + o, le);
  const u32 = (o) => v.getUint32(base + o, le);
  if (u16(2) !== 42) return null;

  const entradas = (ifd) => {
    if (base + ifd + 2 > fim) return [];
    const n = u16(ifd), lista = [];
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (base + e + 12 > fim) break;
      lista.push({ tag: u16(e), tipo: u16(e + 2), qtd: u32(e + 4), valor: e + 8 });
    }
    return lista;
  };
  const ascii = (ent) => {
    const off = ent.qtd > 4 ? u32(ent.valor) : ent.valor;
    if (base + off + ent.qtd > fim) return null;
    return texto(v, base + off, ent.qtd).replace(/\0.*$/, "");
  };

  const ifd0 = entradas(u32(4));
  let data = null;
  const exif = ifd0.find((e) => e.tag === TAG_EXIF_IFD);
  if (exif) {
    const orig = entradas(u32(exif.valor)).find((e) => e.tag === TAG_DATA_ORIGINAL && e.tipo === 2);
    if (orig) data = ascii(orig);
  }
  if (!data) {
    const d = ifd0.find((e) => e.tag === TAG_DATA && e.tipo === 2);
    if (d) data = ascii(d);
  }
  return normalizar(data);
}

/** "2026:10:18 14:03:22" → "2026-10-18T14:03:22"; lixo ("0000:00:00 …") → null */
export function normalizar(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || "");
  if (!m || m[1] === "0000") return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Sem EXIF: usa a data de modificação do arquivo, na hora local. */
export function dataLocal(ms) {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function texto(v, p, n) {
  let s = "";
  for (let i = 0; i < n && p + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(p + i));
  return s;
}
