import test from "node:test";
import assert from "node:assert/strict";
import { finalistas, extrasPorEmpate, rankingGrupo, montarAlbum, torneioDe, ordemCronologica, nomeNoZip } from "../web/logica/agregar.js";
import { loteAtual, terminou } from "../web/logica/torneio.js";

test("finalistas: top K com todos os empatados no corte, sem foto zerada", () => {
  const fotos = [["a", 5], ["b", 4], ["c", 3], ["d", 3], ["e", 3], ["f", 1], ["g", 0]].map(([id, coracoes]) => ({ id, coracoes }));
  assert.deepEqual(finalistas(fotos, 3), ["a", "b", "c", "d", "e"]);
  assert.equal(extrasPorEmpate(fotos, 3), 2);
  assert.deepEqual(finalistas(fotos, 2), ["a", "b"]);
  assert.deepEqual(finalistas(fotos, 10), ["a", "b", "c", "d", "e", "f"], "zerada nunca entra");
});

const est = (vivas, eliminada, lotesFeitos = 1) => ({ vivas, eliminada, lotesFeitos });

test("Borda soma o torneio de cada um e desempata por ❤", () => {
  const fin = ["a", "b", "c", "d"];
  const torneios = [
    { est: est(["a"], { b: 2, c: 1, d: 1 }) },     // a > b > c=d
    { est: est(["b"], { a: 2, c: 1, d: 1 }) },     // b > a > c=d
    { est: est(fin, {}, 0) },                       // não jogou: não conta
  ];
  const { linhas, votantes } = rankingGrupo(fin, torneios, { a: 3, b: 1 });
  assert.equal(votantes, 2);
  assert.deepEqual(linhas.map((l) => [l.id, l.pontos]), [["a", 5], ["b", 5], ["c", 0], ["d", 0]]);
  assert.equal(linhas[0].empate, false, "❤ desempata a e b");
  assert.ok(linhas[2].empate && linhas[3].empate && linhas[2].posicao === 3 && linhas[3].posicao === 3);
});

test("torneio parcial vale: quem não saiu empata no topo", () => {
  const { linhas } = rankingGrupo(["a", "b", "c"], [{ est: est(["a", "b"], { c: 1 }) }]);
  assert.deepEqual(linhas.map((l) => l.pontos), [1, 1, 0]);
});

test("álbum: forçadas entram/saem e o resto completa por ranking", () => {
  const linhas = [["a", 9], ["b", 7], ["c", 5], ["d", 5], ["e", 1]].map(([id, pontos]) => ({ id, pontos, coracoes: 0 }));
  assert.deepEqual(montarAlbum(linhas, 3).ids, ["a", "b", "c"]);
  assert.ok(montarAlbum(linhas, 3).empateNoCorte, "c e d empatados na última vaga");
  assert.ok(!montarAlbum(linhas, 2).empateNoCorte);
  const r = montarAlbum(linhas, 3, { e: "dentro", a: "fora", z: "dentro" });
  assert.deepEqual(r.ids, ["e", "z", "b"]);
});

test("torneioDe usa a mesma semente que o aparelho da pessoa", () => {
  const fin = Array.from({ length: 12 }, (_, i) => `x${i}`);
  const e1 = torneioDe("v", "p1", 1, fin, 4, []);
  const e2 = torneioDe("v", "p1", 1, fin, 4, []);
  assert.deepEqual(loteAtual(e1), loteAtual(e2));
  assert.notDeepEqual(e1.lotes, torneioDe("v", "p1", 2, fin, 4, []).lotes, "geração nova = torneio novo");
  assert.ok(!terminou(e1));
});

test("ordem cronológica e nome no zip", () => {
  const fotos = [{ arquivo: "b.jpg", tirada_em: "2026-10-18T10:00:00" }, { arquivo: "a.jpg", tirada_em: null },
    { arquivo: "c.jpg", tirada_em: "2026-10-18T09:00:00" }];
  assert.deepEqual(ordemCronologica(fotos).map((f) => f.arquivo), ["c.jpg", "b.jpg", "a.jpg"]);
  assert.equal(nomeNoZip(6, "João Pé", "IMG 0001.HEIC", "HEIC"), "07_Joao-Pe_IMG-0001.heic");
  assert.equal(nomeNoZip(0, "", ".jpg", "jpg"), "01_alguem_foto.jpg");
});
