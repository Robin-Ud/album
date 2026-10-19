import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { crc32, montarZip } from "../web/logica/zip.js";

test("crc32 bate com o valor de referência", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("zip abre no Python com nomes UTF-8 e conteúdo íntegro", () => {
  const dados = new Uint8Array(70_000).map((_, i) => (i * 31) & 255);
  const partes = montarZip([
    { nome: "01_João_IMG_1.jpg", dados, data: new Date(2026, 9, 18, 14, 3, 22) },
    { nome: "02_Ana_vazio.jpg", dados: new Uint8Array() },
  ]);
  const zip = Buffer.concat(partes.map((p) => Buffer.from(p)));
  const dir = mkdtempSync(join(tmpdir(), "album-zip-"));
  const arq = join(dir, "t.zip");
  writeFileSync(arq, zip);
  const saida = execFileSync("python3", ["-c", `
import zipfile, sys, hashlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print([(i.filename, i.file_size, i.date_time) for i in z.infolist()])
print(hashlib.sha1(z.read("01_João_IMG_1.jpg")).hexdigest())
`, arq]).toString();
  assert.match(saida, /01_João_IMG_1\.jpg', 70000, \(2026, 10, 18, 14, 3, 22\)/);
  assert.match(saida, /02_Ana_vazio\.jpg', 0/);
  assert.ok(saida.trim().endsWith(createHash("sha1").update(dados).digest("hex")));
});
