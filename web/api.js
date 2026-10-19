// Conversa com o Supabase: só funções RPC `album_*` e envio pro bucket `album`.
// `criarDemo` tem a mesma cara, mas guarda tudo na memória (?demo na URL) — pra testar sem banco.
import { finalistas as calcFinalistas, torneioDe, rankingGrupo, montarAlbum } from "./logica/agregar.js";
import { loteAtual, sugestaoCorte, terminou } from "./logica/torneio.js";

export const BUCKET = "album";
export const caminhos = {
  thumb: (pasta, id) => `${pasta}/${id}_t.jpg`,
  media: (pasta, id) => `${pasta}/${id}_m.jpg`,
  original: (pasta, id, ext) => `${pasta}/orig/${id}.${ext}`,
};

export function criarSupabase(url, chave) {
  const base = url.replace(/\/$/, "");
  async function rpc(nome, args) {
    let res;
    try {
      res = await fetch(`${base}/rest/v1/rpc/${nome}`, {
        method: "POST",
        headers: { apikey: chave, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      throw new Error("Sem conexão com o servidor. Confira a internet e tente de novo.");
    }
    const texto = await res.text();
    const dados = texto ? JSON.parse(texto) : null;
    if (!res.ok) throw new Error(dados?.message || `Erro ${res.status} no servidor.`);
    return dados;
  }
  const s = (x) => ({ p_viagem: x.viagem, p_codigo: x.codigo, p_participante: x.participante });
  return {
    demo: false,
    entrar: (viagem, codigo, nome) => rpc("album_entrar", { p_viagem: viagem, p_codigo: codigo, p_nome: nome }),
    estado: (x) => rpc("album_estado", s(x)),
    registrarFoto: (x, foto) => rpc("album_registrar_foto", { ...s(x), p_foto: foto }),
    removerFoto: (x, id) => rpc("album_remover_foto", { ...s(x), p_foto: id }),
    votar: (x, id, sim) => rpc("album_votar", { ...s(x), p_foto: id, p_sim: sim }),
    evento: (x, dados) => rpc("album_evento", { ...s(x), p_dados: dados }),
    original: (x, id, ext, bytes) => rpc("album_original", { ...s(x), p_foto: id, p_ext: ext, p_bytes: bytes }),
    admin: (viagem, adm) => rpc("album_admin", { p_viagem: viagem, p_admin: adm }),
    adminConfig: (viagem, adm, k, n) => rpc("album_admin_config", { p_viagem: viagem, p_admin: adm, p_k: k, p_n: n }),
    adminFase: (viagem, adm, fase, fotos = null) =>
      rpc("album_admin_fase", { p_viagem: viagem, p_admin: adm, p_fase: fase, p_fotos: fotos }),
    adminForcar: (viagem, adm, id, forcada) =>
      rpc("album_admin_forcar", { p_viagem: viagem, p_admin: adm, p_foto: id, p_forcada: forcada || "" }),
    adminRemover: (viagem, adm, id) => rpc("album_admin_remover", { p_viagem: viagem, p_admin: adm, p_foto: id }),

    async subir(caminho, blob, tipo) {
      let res;
      try {
        res = await fetch(`${base}/storage/v1/object/${BUCKET}/${caminho}`, {
          method: "POST",
          headers: { apikey: chave, "Content-Type": tipo, "cache-control": "max-age=31536000", "x-upsert": "false" },
          body: blob,
        });
      } catch {
        throw new Error("Sem conexão pra enviar a foto.");
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        if (/duplicate|already exists/i.test(t)) return;   // reenvio do mesmo arquivo: já está lá
        let msg = t;
        try { msg = JSON.parse(t).message || t; } catch { /* texto puro */ }
        throw new Error(`Storage recusou (${res.status}): ${msg}`.slice(0, 200));
      }
    },
    url: (caminho) => `${base}/storage/v1/object/public/${BUCKET}/${caminho}`,
    urlDownload: (caminho, nome) => `${base}/storage/v1/object/public/${BUCKET}/${caminho}?download=${encodeURIComponent(nome)}`,
  };
}

// ======================= demo (sem banco) =======================

export const DEMO_VIAGEM = "00000000-0000-4000-8000-00000000d3e0";
export const DEMO_CODIGO = "turma1";
export const DEMO_ADMIN = "admin1";

/**
 * Backend em memória com as mesmas regras do schema.sql. `fase` escolhe em que ponto a viagem
 * começa (pessoas, fotos, ❤ e torneios dos outros já simulados). `imagem(i, w, h)` devolve a URL
 * de uma imagem falsa (no navegador: canvas → blob URL); sem ela as URLs ficam vazias (node).
 */
export function criarDemo({ fase = "envio", imagem = null, nFotos = 30 } = {}) {
  const db = {
    viagem: { id: DEMO_VIAGEM, nome: "Serra da Mantiqueira de moto", fase: "envio", k: 12, n: 6, geracao: 0, finalistas: [], album: [] },
    pasta: "pasta-demo",
    participantes: [],
    fotos: [],
    votos: new Set(),       // `${foto}|${participante}`
    eventos: [],            // {participante, geracao, dados}
    arquivos: new Map(),    // caminho → url
  };
  let contador = 0;   // ids fixos: o demo sai sempre igual (empates no ranking dependem do id)
  const uid = () => `00000000-0000-4000-8000-${(++contador).toString(16).padStart(12, "0")}`;
  const erro = (m) => { throw new Error(m); };
  const confere = (codigo, admin = false) => {
    const c = (codigo || "").trim().toLowerCase();
    if (!(c === DEMO_ADMIN || (!admin && c === DEMO_CODIGO))) erro("Código errado.");
  };
  const membro = (p) => db.participantes.some((x) => x.id === p) || erro("Participante desconhecido — entre de novo.");
  const viva = (id) => db.fotos.find((f) => f.id === id && !f.removida);
  const coracoes = (id) => [...db.votos].filter((v) => v.startsWith(id + "|")).length;
  const fotosJson = (com) => db.fotos.filter((f) => !f.removida)
    .sort((a, b) => (a.tirada_em || "9").localeCompare(b.tirada_em || "9") || a.arquivo.localeCompare(b.arquivo))
    .map((f) => ({ ...f, coracoes: com ? coracoes(f.id) : null }));
  const partJson = () => db.participantes.map((p) => {
    const ev = db.eventos.filter((e) => e.participante === p.id && e.geracao === db.viagem.geracao);
    return {
      id: p.id, nome: p.nome,
      fotos: db.fotos.filter((f) => f.participante === p.id && !f.removida).length,
      votos: [...db.votos].filter((v) => v.endsWith("|" + p.id)).length,
      eventos: ev.length, terminou: !!ev.at(-1)?.dados.terminou,
    };
  });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const entrar = (nome) => {
    const n = (nome || "").trim();
    if (n.length < 1 || n.length > 40) erro("Nome inválido (de 1 a 40 letras).");
    let p = db.participantes.find((x) => x.nome.toLowerCase() === n.toLowerCase());
    if (!p) db.participantes.push((p = { id: uid(), nome: n }));
    return p;
  };
  const url = (caminho) => db.arquivos.get(caminho) || "";

  // ---------- semeadura ----------
  const pessoas = ["Matheus", "João", "Ana", "Bia"].map(entrar);
  for (let i = 0; i < nFotos; i++) {
    const dono = pessoas[i % 4], id = uid();
    const deitada = i % 5 !== 2;
    const h = String(8 + Math.floor(i / 3)).padStart(2, "0"), m = String((i * 7) % 60).padStart(2, "0");
    db.fotos.push({ id, participante: dono.id, arquivo: `IMG_${2400 + i}.jpg`, tamanho: 3_000_000 + i,
      tirada_em: `2026-10-18T${h}:${m}:00`, largura: deitada ? 4000 : 3000, altura: deitada ? 3000 : 4000,
      orig_ext: null, forcada: null, removida: false, bytes_t: 60_000, bytes_m: 450_000, bytes_orig: null });
    if (imagem) {
      const [w, hh] = deitada ? [400, 300] : [300, 400];
      db.arquivos.set(caminhos.thumb(db.pasta, id), imagem(i, w, hh));
      db.arquivos.set(caminhos.media(db.pasta, id), imagem(i, w * 3, hh * 3));
    }
  }
  const ordemFases = ["envio", "votos", "final", "album"];
  if (ordemFases.indexOf(fase) >= 1) {
    db.viagem.fase = "votos";
    // ❤ espalhados: fotos "boas" (múltiplas de 3) ganham mais
    db.fotos.forEach((f, i) => pessoas.forEach((p, j) => {
      if ((i % 3 === 0 && j !== 3) || (i * 7 + j * 3) % 11 === 0) db.votos.add(`${f.id}|${p.id}`);
    }));
  }
  if (ordemFases.indexOf(fase) >= 2) {
    const fin = calcFinalistas(fotosJson(true), db.viagem.k);
    Object.assign(db.viagem, { fase: "final", finalistas: fin, geracao: 1 });
    // os outros jogam o torneio cortando sempre a sugestão (Matheus fica pra quem testa)
    pessoas.slice(1, fase === "album" ? 4 : 3).forEach((p, j) => {
      const ev = [];
      for (let passo = 0; passo < 50; passo++) {
        const est = torneioDe(DEMO_VIAGEM, p.id, 1, fin, db.viagem.n, ev);
        if (terminou(est)) break;
        const lote = loteAtual(est);
        const cortar = [...lote].sort((a, b) => ((a.charCodeAt(j) || 0) - (b.charCodeAt(j) || 0))).slice(0, sugestaoCorte(est));
        const novo = { tipo: "lote", rodada: est.rodada, indice: est.indice, cortadas: cortar };
        novo.terminou = terminou(torneioDe(DEMO_VIAGEM, p.id, 1, fin, db.viagem.n, [...ev, novo]));
        ev.push(novo);
        db.eventos.push({ participante: p.id, geracao: 1, dados: novo });
      }
    });
  }
  if (fase === "album") {
    const torneios = pessoas.map((p) => ({ participante: p.id,
      est: torneioDe(DEMO_VIAGEM, p.id, 1, db.viagem.finalistas, db.viagem.n,
        db.eventos.filter((e) => e.participante === p.id).map((e) => e.dados)) }));
    const cor = Object.fromEntries(db.fotos.map((f) => [f.id, coracoes(f.id)]));
    const { linhas } = rankingGrupo(db.viagem.finalistas, torneios, cor);
    Object.assign(db.viagem, { fase: "album", album: montarAlbum(linhas, db.viagem.n).ids });
  }

  const s = (x) => { confere(x.codigo); membro(x.participante); };
  const espera = (v) => new Promise((ok) => setTimeout(() => ok(clone(v ?? null)), 40));
  const tenta = (f) => new Promise((ok, falha) => setTimeout(() => { try { ok(clone(f() ?? null)); } catch (e) { falha(e); } }, 40));

  return {
    demo: true,
    db,
    entrar: (viagem, codigo, nome) => tenta(() => {
      if (viagem !== DEMO_VIAGEM) erro("Código errado.");
      confere(codigo);
      const p = entrar(nome);
      return { participante: p.id, nome: p.nome, pasta: db.pasta, viagem: db.viagem };
    }),
    estado: (x) => tenta(() => {
      s(x);
      return {
        viagem: db.viagem, pasta: db.pasta, participantes: partJson(),
        fotos: fotosJson(["final", "album"].includes(db.viagem.fase)),
        meus_votos: [...db.votos].filter((v) => v.endsWith("|" + x.participante) && viva(v.split("|")[0])).map((v) => v.split("|")[0]),
        meus_eventos: db.eventos.filter((e) => e.participante === x.participante && e.geracao === db.viagem.geracao).map((e) => e.dados),
      };
    }),
    registrarFoto: (x, foto) => tenta(() => {
      s(x);
      if (db.viagem.fase !== "envio") erro("O envio de fotos já fechou.");
      const igual = db.fotos.find((f) => f.participante === x.participante && f.arquivo === foto.arquivo && f.tamanho === foto.tamanho);
      if (igual) { igual.removida = false; return igual.id; }
      db.fotos.push({ orig_ext: null, forcada: null, removida: false, bytes_orig: null, ...foto, participante: x.participante });
      return foto.id;
    }),
    removerFoto: (x, id) => tenta(() => {
      s(x);
      if (!["envio", "votos"].includes(db.viagem.fase)) erro("Nesta fase não dá mais pra tirar fotos.");
      const f = db.fotos.find((f) => f.id === id && f.participante === x.participante);
      if (!f) erro("Só quem enviou pode tirar a foto.");
      f.removida = true;
      for (const v of [...db.votos]) if (v.startsWith(id + "|")) db.votos.delete(v);
    }),
    votar: (x, id, sim) => tenta(() => {
      s(x);
      if (db.viagem.fase !== "votos") erro("A votação não está aberta.");
      if (!viva(id)) erro("Foto não encontrada.");
      db.votos[sim ? "add" : "delete"](`${id}|${x.participante}`);
    }),
    evento: (x, dados) => tenta(() => {
      s(x);
      if (db.viagem.fase !== "final") erro("O torneio não está aberto.");
      if (!["lote", "desfaz"].includes(dados?.tipo)) erro("Evento inválido.");
      db.eventos.push({ participante: x.participante, geracao: db.viagem.geracao, dados: clone(dados) });
      return db.eventos.length;
    }),
    original: (x, id, ext, bytes) => tenta(() => {
      s(x);
      if (db.viagem.fase !== "album" || !db.viagem.album.includes(id)) erro("Original só das fotos do álbum, depois que ele fecha.");
      const f = db.fotos.find((f) => f.id === id && f.participante === x.participante);
      if (!f) erro("Só quem tirou a foto sobe o original.");
      Object.assign(f, { orig_ext: ext.toLowerCase(), bytes_orig: bytes });
    }),
    admin: (viagem, adm) => tenta(() => {
      confere(adm, true);
      const soma = db.fotos.reduce((t, f) => t + f.bytes_t + f.bytes_m + (f.bytes_orig || 0), 0);
      return {
        viagem: db.viagem, participantes: partJson(), fotos: fotosJson(true),
        eventos: db.eventos.filter((e) => e.geracao === db.viagem.geracao).map((e) => ({ participante: e.participante, dados: e.dados })),
        bytes_viagem: soma, bytes_total: soma + 120_000_000,
      };
    }),
    adminConfig: (viagem, adm, k, n) => tenta(() => {
      confere(adm, true);
      if (db.viagem.fase === "final") erro("Durante o torneio não dá pra mudar K nem N (mudaria o torneio de todo mundo).");
      if (!(k >= 1 && k <= 500 && n >= 1 && n <= 500)) erro("K e N vão de 1 a 500.");
      Object.assign(db.viagem, { k, n });
    }),
    adminFase: (viagem, adm, fase, fotos = null) => tenta(() => {
      confere(adm, true);
      if (!ordemFases.includes(fase)) erro("Fase inválida.");
      const validas = (fotos || []).filter((id) => viva(id));
      if (fase === "final" && ["envio", "votos"].includes(db.viagem.fase)) {
        if (validas.length < 2) erro("Precisa de pelo menos 2 finalistas.");
        Object.assign(db.viagem, { fase, finalistas: validas, geracao: db.viagem.geracao + 1 });
      } else if (fase === "album") {
        if (validas.length < 1) erro("O álbum precisa de pelo menos 1 foto.");
        Object.assign(db.viagem, { fase, album: validas });
      } else {
        db.viagem.fase = fase;
      }
    }),
    adminForcar: (viagem, adm, id, forcada) => tenta(() => {
      confere(adm, true);
      const f = db.fotos.find((f) => f.id === id);
      if (f) f.forcada = forcada || null;
    }),
    adminRemover: (viagem, adm, id) => tenta(() => {
      confere(adm, true);
      const f = db.fotos.find((f) => f.id === id);
      if (f) f.removida = true;
      for (const v of [...db.votos]) if (v.startsWith(id + "|")) db.votos.delete(v);
    }),
    async subir(caminho, blob) {
      await espera();
      db.arquivos.set(caminho, typeof URL !== "undefined" && URL.createObjectURL && blob instanceof Blob ? URL.createObjectURL(blob) : "");
    },
    url,
    urlDownload: (caminho) => url(caminho),
  };
}

