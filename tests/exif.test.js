import test from "node:test";
import assert from "node:assert/strict";
import { dataDaFoto, normalizar, dataLocal } from "../web/logica/exif.js";

// monta um JPEG mínimo: SOI + APP1(Exif) com IFD0 → ExifIFD → DateTimeOriginal, e depois SOS
function jpegComExif({ le = true, data = "2026:10:18 14:03:22", soIfd0 = false } = {}) {
  const tiff = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const ascii = [...data].map((c) => c.charCodeAt(0)).concat([0]);   // 20 bytes
  // layout: header(8) | IFD0 em 8: 1 entrada (18 bytes) | ExifIFD em 26: 1 entrada (18) | texto em 44
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  if (soIfd0) {
    tiff.push(...u16(1), ...u16(0x0132), ...u16(2), ...u32(20), ...u32(26), ...u32(0));
    tiff.push(...ascii);
  } else {
    tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
    tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0));
    tiff.push(...ascii);
  }
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const tam = app1.length + 2;
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, tam >> 8, tam & 255, ...app1, 0xff, 0xda, 0, 2];
  return new Uint8Array(bytes).buffer;
}

test("lê DateTimeOriginal em little e big endian", () => {
  assert.equal(dataDaFoto(jpegComExif()), "2026-10-18T14:03:22");
  assert.equal(dataDaFoto(jpegComExif({ le: false })), "2026-10-18T14:03:22");
});

test("sem ExifIFD cai no DateTime do IFD0", () => {
  assert.equal(dataDaFoto(jpegComExif({ soIfd0: true, data: "2025:01:02 03:04:05" })), "2025-01-02T03:04:05");
});

test("sem EXIF, data zerada ou arquivo que não é JPEG → null", () => {
  assert.equal(dataDaFoto(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), null);
  assert.equal(dataDaFoto(jpegComExif({ data: "0000:00:00 00:00:00" })), null);
  assert.equal(dataDaFoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null);
  assert.equal(dataDaFoto(jpegComExif().slice(0, 30)), null, "cortado no meio não quebra");
  assert.equal(normalizar("lixo"), null);
});

test("dataLocal formata na hora local", () => {
  assert.match(dataLocal(Date.now()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});
