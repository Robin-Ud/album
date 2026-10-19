import test from "node:test";
import assert from "node:assert/strict";
import { criarDemo, DEMO_VIAGEM, DEMO_CODIGO, DEMO_ADMIN } from "../web/api.js";
import { torneioDe, finalistas } from "../web/logica/agregar.js";
import { terminou, loteAtual, sugestaoCorte } from "../web/logica/torneio.js";

test("fluxo inteiro no backend demo segue as regras do schema", async () => {
  const api = criarDemo({ fase: "envio" });
  await assert.rejects(api.entrar(DEMO_VIAGEM, "errado", "X"), /Código errado/);
  const eu = await api.entrar(DEMO_VIAGEM, ` ${DEMO_CODIGO.toUpperCase()} `, "matheus");
  assert.equal(eu.nome, "Matheus", "mesmo nome (sem caixa) = mesma pessoa");
  const s = { viagem: DEMO_VIAGEM, codigo: DEMO_CODIGO, participante: eu.participante };
  const id = "11111111-1111-4111-8111-111111111111";
  await api.registrarFoto(s, { id, arquivo: "nova.jpg", tamanho: 10, tirada_em: "2026-10-18T07:00:00", bytes_t: 1, bytes_m: 2 });
  assert.equal(await api.registrarFoto(s, { id: "outro", arquivo: "nova.jpg", tamanho: 10 }), id, "reenvio devolve o id antigo");
  let e = await api.estado(s);
  assert.equal(e.fotos[0].id, id, "ordem cronológica");
  assert.equal(e.fotos[0].coracoes, null);
  await assert.rejects(api.votar(s, id, true), /não está aberta/);
  await assert.rejects(api.adminFase(DEMO_VIAGEM, DEMO_CODIGO, "votos"), /Código errado/, "código da turma não é admin");
  await api.adminFase(DEMO_VIAGEM, DEMO_ADMIN, "votos");
  await assert.rejects(api.registrarFoto(s, { id: "x", arquivo: "y.jpg", tamanho: 1 }), /já fechou/);
  await api.votar(s, id, true);
  e = await api.estado(s);
  assert.deepEqual(e.meus_votos, [id]);
  assert.ok(e.fotos.every((f) => f.coracoes === null), "❤ dos outros escondidos na votação");
  for (const f of e.fotos.slice(1, 15)) await api.votar(s, f.id, true);
  await api.votar(s, e.fotos[14].id, false);
  const adm = await api.admin(DEMO_VIAGEM, DEMO_ADMIN);
  assert.equal(adm.fotos.filter((f) => f.coracoes > 0).length, 14);
  const fin = finalistas(adm.fotos, adm.viagem.k);
  await api.adminFase(DEMO_VIAGEM, DEMO_ADMIN, "final", fin);
  await assert.rejects(api.adminConfig(DEMO_VIAGEM, DEMO_ADMIN, 5, 5), /Durante o torneio/);
  e = await api.estado(s);
  assert.equal(e.viagem.geracao, 1);
  assert.ok(e.fotos.every((f) => typeof f.coracoes === "number"));

  // joga o próprio torneio até o fim
  const ev = [];
  for (let i = 0; i < 40; i++) {
    const est = torneioDe(DEMO_VIAGEM, s.participante, 1, e.viagem.finalistas, e.viagem.n, ev);
    if (terminou(est)) break;
    const novo = { tipo: "lote", cortadas: loteAtual(est).slice(0, sugestaoCorte(est)) };
    novo.terminou = terminou(torneioDe(DEMO_VIAGEM, s.participante, 1, e.viagem.finalistas, e.viagem.n, [...ev, novo]));
    await api.evento(s, novo);
    ev.push(novo);
  }
  e = await api.estado(s);
  assert.deepEqual(e.meus_eventos, ev);
  assert.ok(e.participantes.find((p) => p.id === s.participante).terminou);

  await api.adminFase(DEMO_VIAGEM, DEMO_ADMIN, "album", [id, fin[0]]);
  await api.original(s, id, "JPG", 5_000_000);
  e = await api.estado(s);
  assert.equal(e.fotos.find((f) => f.id === id).orig_ext, "jpg");
  await api.adminFase(DEMO_VIAGEM, DEMO_ADMIN, "final");
  assert.equal((await api.estado(s)).viagem.geracao, 1, "voltar do álbum não reinicia o torneio");
});

test("demo já começa em cada fase com dados coerentes", async () => {
  for (const fase of ["votos", "final", "album"]) {
    const api = criarDemo({ fase });
    const adm = await api.admin(DEMO_VIAGEM, DEMO_ADMIN);
    assert.equal(adm.viagem.fase, fase);
    if (fase !== "votos") assert.ok(adm.viagem.finalistas.length >= adm.viagem.k);
    if (fase === "album") assert.equal(adm.viagem.album.length, adm.viagem.n);
    if (fase === "final") assert.ok(adm.participantes.filter((p) => p.terminou).length === 2, "João e Ana terminaram");
  }
});
