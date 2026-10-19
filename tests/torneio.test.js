import test from "node:test";
import assert from "node:assert/strict";
import { lotesDaRodada, reconstruir, terminou, loteAtual, proximoLote, sugestaoCorte, ranking, embaralhar } from "../web/logica/torneio.js";

const fotos = Array.from({ length: 20 }, (_, i) => `f${String(i).padStart(2, "0")}`);

test("lotes cobrem todas as vivas uma vez, equilibrados e determinísticos", () => {
  const lotes = lotesDaRodada(fotos, 1, "s", 6, 5);
  assert.deepEqual(lotes.flat().sort(), fotos);
  assert.deepEqual(lotes.map((l) => l.length), [5, 5, 5, 5]);
  assert.deepEqual(lotes, lotesDaRodada([...fotos].reverse(), 1, "s", 6, 5), "mesma rodada → mesmos lotes");
  assert.notDeepEqual(lotes, lotesDaRodada(fotos, 2, "s", 6, 5), "rodada nova embaralha de novo");
  assert.notDeepEqual(lotes, lotesDaRodada(fotos, 1, "outra", 6, 5), "semente de outra pessoa → outros lotes");
});

test("perto da meta junta lotes", () => {
  assert.deepEqual(lotesDaRodada(fotos, 1, "s", 6, 18).map((l) => l.length), [10, 10]);
  assert.deepEqual(lotesDaRodada(fotos.slice(0, 7), 1, "s", 6, 6).map((l) => l.length), [7]);
  assert.deepEqual(lotesDaRodada(fotos.slice(0, 1), 1, "s", 6, 0), []);
});

test("embaralhar é estável entre execuções", () => {
  assert.deepEqual(embaralhar(["a", "b", "c", "d", "e"], "x:1"), embaralhar(["a", "b", "c", "d", "e"], "x:1"));
});

function jogar(meta, cortar = (lote) => [...lote].sort().slice(0, Math.max(1, Math.floor(lote.length / 2)))) {
  const inicio = { fotos, meta, semente: "s" };
  const ev = [];
  let est = reconstruir(inicio, ev);
  let passos = 0;
  while (!terminou(est) && passos < 50) {
    ev.push({ tipo: "lote", cortadas: cortar(loteAtual(est)) });
    est = reconstruir(inicio, ev);
    passos++;
  }
  return { inicio, ev, est, passos };
}

test("torneio inteiro chega na meta sem perder ninguém", () => {
  const { est, passos } = jogar(5);
  assert.ok(terminou(est) && est.vivas.length <= 5 && passos < 20, `${est.vivas.length} vivas em ${passos} lotes`);
  assert.equal(est.vivas.length + Object.keys(est.eliminada).length, 20);
  const rk = ranking(est);
  assert.deepEqual(rk.filter((l) => l.rodada === null).map((l) => l.foto), [...est.vivas].sort());
  const rodadas = rk.filter((l) => l.rodada).map((l) => l.rodada);
  assert.deepEqual(rodadas, [...rodadas].sort((a, b) => b - a), "quem saiu depois fica na frente");
  assert.equal(rk[est.vivas.length].posicao, est.vivas.length + 1);
  assert.equal(new Set(rk.filter((l) => l.rodada === 1).map((l) => l.posicao)).size, 1, "mesma rodada empata");
});

test("desfazer volta exatamente um lote, e reabre o fim", () => {
  const { inicio, ev } = jogar(5);
  const antes = reconstruir(inicio, ev.slice(0, -1));
  const desfeito = reconstruir(inicio, [...ev, { tipo: "desfaz" }]);
  assert.deepEqual(desfeito.vivas, antes.vivas);
  assert.deepEqual(loteAtual(desfeito), loteAtual(antes));
  assert.ok(!terminou(desfeito));
  assert.equal(reconstruir(inicio, [{ tipo: "desfaz" }]).desfaziveis, 0);
});

test("sugestão, próximo lote e casos de borda", () => {
  const est = reconstruir({ fotos, meta: 5, semente: "s" }, []);
  assert.equal(loteAtual(est).length, 5);
  assert.equal(sugestaoCorte(est), 3);
  assert.equal(proximoLote(est).length, 5);
  const ja = reconstruir({ fotos: fotos.slice(0, 3), meta: 5, semente: "s" }, []);
  assert.ok(terminou(ja) && loteAtual(ja).length === 0, "meta ≥ fotos já termina");
  const invalido = reconstruir({ fotos, meta: 5, semente: "s" }, [{ tipo: "lote", cortadas: ["nao-existe"] }]);
  assert.equal(invalido.vivas.length, 20);
  assert.equal(invalido.indice, 1);
});
