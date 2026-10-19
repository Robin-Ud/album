// Torneio por lotes — porte do ~/deving/desktop/PhotoPicker/picker.py.
// Cada rodada embaralha as vivas em lotes; em cada lote a pessoa marca as que saem.
// Quem sai na rodada N fica atrás de quem sai na N+1. O estado nunca é salvo: é sempre
// refeito a partir dos eventos (replay), que é o que o servidor guarda.

export const LOTE = 6;        // fotos por lote (fixo: mudar quebra o replay de torneios em andamento)
export const CORTE_MAX = 2 / 3;

// hash de string → semente de 32 bits (xmur3) e gerador mulberry32: determinístico em qualquer navegador
function semente32(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function gerador(texto) {
  let a = semente32(texto);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function embaralhar(lista, texto) {
  const r = gerador(texto);
  const v = [...lista];
  for (let i = v.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [v[i], v[j]] = [v[j], v[i]];
  }
  return v;
}

/** Lotes equilibrados (diferença de no máx. 1), sempre iguais pra mesma rodada. */
export function lotesDaRodada(vivas, rodada, semente, tam, meta) {
  if (vivas.length <= 1) return [];
  const ordem = embaralhar([...vivas].sort(), `${semente}:${rodada}`);
  let n = Math.ceil(ordem.length / tam);
  // cada lote corta ≥1: perto da meta junta lotes (até 2× o tamanho) pra não forçar corte demais
  n = Math.max(Math.ceil(ordem.length / (2 * tam)), Math.min(n, Math.max(1, ordem.length - meta)));
  const base = Math.floor(ordem.length / n), sobra = ordem.length % n;
  const lotes = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const t = base + (k < sobra ? 1 : 0);
    lotes.push(ordem.slice(i, i + t));
    i += t;
  }
  return lotes;
}

function garantirLotes(est) {
  if (est.lotes === null) {
    est.lotes = lotesDaRodada(est.vivas, est.rodada, est.semente, est.lote, est.meta);
    est.vivasInicio = est.vivas.length;
  }
}

/**
 * Refaz o torneio. `inicio` = {fotos, meta, semente, lote?}; eventos = [{tipo:'lote', cortadas:[...]}
 * | {tipo:'desfaz'}] na ordem em que aconteceram. `desfaz` anula o último lote efetivo.
 */
export function reconstruir(inicio, eventos) {
  const efetivos = [];
  for (const e of eventos) {
    if (e.tipo === "lote") efetivos.push(e);
    else if (e.tipo === "desfaz" && efetivos.length) efetivos.pop();
  }
  const est = {
    fotos: [...inicio.fotos], semente: inicio.semente, lote: inicio.lote || LOTE, meta: inicio.meta,
    rodada: 1, indice: 0, lotes: null, vivas: [...inicio.fotos], vivasInicio: inicio.fotos.length,
    eliminada: {}, desfaziveis: efetivos.length, lotesFeitos: efetivos.length,
  };
  for (const e of efetivos) {
    garantirLotes(est);
    if (!est.lotes.length) break;   // evento sobrando depois do fim (não deveria existir)
    const lote = est.lotes[est.indice];
    for (const f of e.cortadas || []) {
      const i = est.vivas.indexOf(f);
      if (lote.includes(f) && i >= 0) {
        est.vivas.splice(i, 1);
        est.eliminada[f] = est.rodada;
      }
    }
    est.indice++;
    if (est.indice >= est.lotes.length) {
      est.rodada++;
      est.indice = 0;
      est.lotes = null;
    }
  }
  if (!terminou(est)) garantirLotes(est);
  return est;
}

/** Só termina entre rodadas: no meio, todo mundo da rodada ainda tem que ser julgado. */
export function terminou(est) {
  return est.indice === 0 && (est.vivas.length <= est.meta || est.vivas.length <= 1);
}

export function loteAtual(est) {
  return terminou(est) ? [] : est.lotes[est.indice];
}

/** Pra pré-carregar; na virada de rodada não dá pra saber. */
export function proximoLote(est) {
  if (terminou(est) || est.indice + 1 >= est.lotes.length) return [];
  return est.lotes[est.indice + 1];
}

/** Quantas cortar deste lote pra chegar perto da meta no fim da rodada (1 a tam−1). */
export function sugestaoCorte(est) {
  const tam = loteAtual(est).length;
  if (tam <= 1) return 0;
  const fracao = Math.min(CORTE_MAX, 1 - est.meta / est.vivasInicio);
  return Math.min(tam - 1, Math.max(1, Math.round(tam * fracao)));
}

/** Quanto falta, em lotes, só da rodada atual. */
export function lotesNaRodada(est) {
  return terminou(est) ? 0 : est.lotes.length;
}

/** Grupo de cada foto: 0 = viva (melhor), senão −rodada em que saiu (sair depois = melhor). */
export function grupo(est, f) {
  const r = est.eliminada[f];
  return r === undefined ? Infinity : r;
}

/** [{posicao, foto, rodada|null}] — vivas primeiro; quem saiu na mesma rodada empata. */
export function ranking(est) {
  const ordem = [...est.fotos].sort((a, b) => grupo(est, b) - grupo(est, a) || (a < b ? -1 : a > b ? 1 : 0));
  const linhas = [];
  let pos = 0, anterior = null;
  ordem.forEach((f, i) => {
    const g = grupo(est, f);
    if (g !== anterior) { pos = i + 1; anterior = g; }
    linhas.push({ posicao: pos, foto: f, rodada: est.eliminada[f] ?? null });
  });
  return linhas;
}
