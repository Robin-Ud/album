import test from "node:test";
import assert from "node:assert/strict";
import { casarOriginais, tipoPorNome, extensao } from "../web/logica/originais.js";

test("casa por nome+tamanho, depois por nome sem extensão (iPhone)", () => {
  const faltando = [
    { id: 1, arquivo: "IMG_1.jpg", tamanho: 100 },
    { id: 2, arquivo: "IMG_2.jpeg", tamanho: 200 },   // subiu convertido; original é HEIC
    { id: 3, arquivo: "IMG_3.jpg", tamanho: 300 },
  ];
  const arquivos = [
    { name: "IMG_1.jpg", size: 999 }, { name: "IMG_1.jpg", size: 100 },
    { name: "IMG_2.HEIC", size: 4000 }, { name: "notas.txt", size: 1 }, { name: "IMG_9.jpg", size: 5 },
  ];
  const { pares, sobraram } = casarOriginais(faltando, arquivos);
  assert.deepEqual(pares.map((p) => [p.foto.id, p.arquivo.name, p.arquivo.size]), [[1, "IMG_1.jpg", 100], [2, "IMG_2.HEIC", 4000]]);
  assert.deepEqual(sobraram.map((f) => f.id), [3]);
});

test("tipos aceitos pelo bucket", () => {
  assert.equal(tipoPorNome("a.HEIC"), "image/heic");
  assert.equal(tipoPorNome("a.dng"), null);
  assert.equal(extensao("sem"), "");
});
