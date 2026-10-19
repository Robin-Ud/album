// Junta as escolhas de todo mundo: finalistas pelos ❤ e álbum pelo torneio de cada um (Borda).
import { reconstruir, grupo } from "./torneio.js";

/**
 * Top K por ❤, incluindo TODAS as empatadas com a K-ésima (sem limbo de empate).
 * Foto sem ❤ nunca entra. fotos = [{id, coracoes}] (as removidas já devem vir de fora).
 */
export function finalistas(fotos, k) {
  const com = fotos.filter((f) => f.coracoes > 0).sort((a, b) => b.coracoes - a.coracoes || cmp(a.id, b.id));
  if (com.length <= k) return com.map((f) => f.id);
  const corte = com[k - 1].coracoes;
  return com.filter((f, i) => i < k || f.coracoes === corte).map((f) => f.id);
}

/** Quantas além de K entraram por empate no corte (pra avisar o admin). */
export function extrasPorEmpate(fotos, k) {
  return Math.max(0, finalistas(fotos, k).length - k);
}

export function sementeTorneio(viagem, participante, geracao) {
  return `${viagem}:${participante}:${geracao}`;
}

/** Estado do torneio de uma pessoa (mesma semente que o aparelho dela usa). */
export function torneioDe(viagem, participante, geracao, finalistasIds, meta, eventos) {
  return reconstruir({ fotos: finalistasIds, meta, semente: sementeTorneio(viagem, participante, geracao) }, eventos);
}

/**
 * Borda: pra cada pessoa que confirmou ≥1 lote, uma foto ganha 1 ponto por finalista que essa
 * pessoa deixou estritamente pior (torneio parcial vale: quem ainda não saiu empata no topo).
 * Desempate por ❤; o que sobrar empatado sai marcado com `empate: true`.
 * torneios = [{participante, est}] ; coracoes = {id: n}
 */
export function rankingGrupo(finalistasIds, torneios, coracoes = {}) {
  const pontos = Object.fromEntries(finalistasIds.map((f) => [f, 0]));
  let votantes = 0;
  for (const { est } of torneios) {
    if (!est.lotesFeitos) continue;
    votantes++;
    const grupos = finalistasIds.map((f) => grupo(est, f));
    finalistasIds.forEach((f, i) => {
      pontos[f] += grupos.filter((g) => g < grupos[i]).length;
    });
  }
  const linhas = finalistasIds.map((f) => ({ id: f, pontos: pontos[f], coracoes: coracoes[f] || 0 }))
    .sort((a, b) => b.pontos - a.pontos || b.coracoes - a.coracoes || cmp(a.id, b.id));
  let pos = 0;
  linhas.forEach((l, i) => {
    const ant = linhas[i - 1], prox = linhas[i + 1];
    const igual = (x) => x && x.pontos === l.pontos && x.coracoes === l.coracoes;
    if (!igual(ant)) pos = i + 1;
    l.posicao = pos;
    l.empate = igual(ant) || igual(prox);
  });
  return { linhas, votantes };
}

/**
 * Álbum final: forçadas 'dentro' sempre entram, 'fora' nunca; o resto completa até N na ordem
 * do ranking. `empateNoCorte` avisa quando a última vaga caiu no meio de um grupo empatado.
 */
export function montarAlbum(linhas, n, forcadas = {}) {
  const dentro = linhas.filter((l) => forcadas[l.id] === "dentro").map((l) => l.id);
  const extras = Object.keys(forcadas).filter((id) => forcadas[id] === "dentro" && !dentro.includes(id));
  const escolhidas = [...dentro, ...extras];
  let ultima = null;
  for (const l of linhas) {
    if (escolhidas.length >= n) break;
    if (forcadas[l.id] || escolhidas.includes(l.id)) continue;
    escolhidas.push(l.id);
    ultima = l;
  }
  const empateNoCorte = !!ultima && linhas.some((l) => !escolhidas.includes(l.id) && !forcadas[l.id] &&
    l.pontos === ultima.pontos && l.coracoes === ultima.coracoes);
  return { ids: escolhidas, empateNoCorte };
}

/** Ordem da viagem: pela hora da foto (EXIF), depois pelo nome do arquivo. */
export function ordemCronologica(fotos) {
  return [...fotos].sort((a, b) => cmp(a.tirada_em || "9999", b.tirada_em || "9999") || cmp(a.arquivo, b.arquivo));
}

/** Nome dentro do .zip: 07_Joao_IMG_1234.jpg */
export function nomeNoZip(i, pessoa, arquivo, ext) {
  const limpo = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = limpo(arquivo.replace(/\.[^.]+$/, "")) || "foto";
  return `${String(i + 1).padStart(2, "0")}_${limpo(pessoa) || "alguem"}_${base}.${ext.toLowerCase()}`;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
