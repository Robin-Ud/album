// Álbum da viagem — tela única. Fases: envio → votos (❤) → final (torneio por lotes) → álbum.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { criarSupabase, criarDemo, caminhos, DEMO_VIAGEM, DEMO_CODIGO, DEMO_ADMIN } from "./api.js";
import { loteAtual, sugestaoCorte, terminou, proximoLote } from "./logica/torneio.js";
import { finalistas, extrasPorEmpate, torneioDe, rankingGrupo, montarAlbum, ordemCronologica, nomeNoZip } from "./logica/agregar.js";
import { dataDaFoto, dataLocal } from "./logica/exif.js";
import { montarZip } from "./logica/zip.js";
import { casarOriginais, extensao, tipoPorNome } from "./logica/originais.js";

const FASES = [["envio", "Envio"], ["votos", "Votos ❤"], ["final", "Final"], ["album", "Álbum"]];
const LIMITE_GRATIS = 1024 ** 3;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const st = {
  api: null, viagem: null, sessao: null, dados: null, adm: null,
  filtro: "todas", envio: null, orig: null, zip: null, marcadas: new Set(), visor: null, ocupado: false,
};
window.__erros = [];

// ---------------- erros e avisos ----------------
function mostrarErro(msg) {
  window.__erros.push(String(msg));
  const el = $("#erro-global");
  el.textContent = `Algo deu errado: ${msg}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 8000);
}
addEventListener("error", (e) => mostrarErro(e.message));
addEventListener("unhandledrejection", (e) => mostrarErro(e.reason?.message || e.reason));

let toastTimer = 0;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

async function tentar(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e));
    return undefined;
  }
}

// ---------------- sessão ----------------
const chaveSessao = () => `album:${st.viagem}`;
function lerSessao() {
  try { return JSON.parse(localStorage.getItem(chaveSessao())) || null; } catch { return null; }
}
function salvarSessao() {
  try { localStorage.setItem(chaveSessao(), JSON.stringify(st.sessao)); } catch { /* aba anônima: vale só nesta visita */ }
}

function telas(qual) {
  for (const t of document.querySelectorAll(".tela")) t.classList.toggle("ativa", t.id === qual);
}

// ---------------- início ----------------
async function iniciar() {
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) {
    st.api = criarDemo({ fase: params.get("demo") || "envio", imagem: imagemFalsa });
    st.viagem = DEMO_VIAGEM;
    const eu = st.api.db.participantes[0];
    st.sessao = { viagem: DEMO_VIAGEM, codigo: DEMO_CODIGO, participante: eu.id, nome: eu.nome, pasta: st.api.db.pasta, admin: DEMO_ADMIN };
    document.title = "Álbum (demo)";
  } else {
    st.api = criarSupabase(SUPABASE_URL, SUPABASE_KEY);
    st.viagem = location.hash.replace(/^#\/?/, "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(st.viagem)) return telas("tela-sem-link");
    st.sessao = lerSessao();
  }
  if (!st.sessao?.participante) return mostrarEntrar();
  telas("tela-app");
  await carregar();
  if (!st.dados) return;
  if (st.api.demo) toast("Modo demo: nada sai do seu aparelho.");
  setInterval(() => {
    if (document.visibilityState === "visible" && !st.ocupado && !st.visor && !st.envio?.rodando && !st.orig?.rodando && !st.zip?.rodando) {
      carregar(true);
    }
  }, 25000);
}

function mostrarEntrar(msg = "") {
  telas("tela-entrar");
  const anterior = lerSessao();
  if (anterior?.codigo) $("#in-codigo").value = anterior.codigo;
  if (anterior?.nome) $("#in-nome").value = anterior.nome;
  $("#msg-entrar").textContent = msg;
}

$("#form-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const codigo = $("#in-codigo").value.trim(), nome = $("#in-nome").value.trim();
  const botao = ev.target.querySelector("button");
  botao.disabled = true;
  try {
    const r = await st.api.entrar(st.viagem, codigo, nome);
    st.sessao = { viagem: st.viagem, codigo, participante: r.participante, nome: r.nome, pasta: r.pasta, admin: lerSessao()?.admin || null };
    salvarSessao();
    telas("tela-app");
    await carregar();
  } catch (e) {
    $("#msg-entrar").textContent = e.message;
  } finally {
    botao.disabled = false;
  }
});

async function carregar(silencioso = false) {
  try {
    st.dados = await st.api.estado(st.sessao);
    st.sessao.pasta = st.dados.pasta;
  } catch (e) {
    if (/Código errado|Participante desconhecido/.test(e.message)) return mostrarEntrar(e.message);
    if (!silencioso) toast(e.message);
    return;
  }
  render();
  if (!$("#painel").classList.contains("hidden") && st.sessao.admin) await atualizarPainel();
}

// ---------------- ajudantes de dados ----------------
const v = () => st.dados.viagem;
const eu = () => st.sessao.participante;
const fotoPorId = (id) => st.dados.fotos.find((f) => f.id === id);
const nomeDe = (pid) => (st.dados.participantes.find((p) => p.id === pid) || st.adm?.participantes.find((p) => p.id === pid))?.nome || "?";
const urlThumb = (f) => st.api.url(caminhos.thumb(st.sessao.pasta, f.id));
const urlMedia = (f) => st.api.url(caminhos.media(st.sessao.pasta, f.id));
const meusVotos = () => new Set(st.dados.meus_votos);
const meuTorneio = () => torneioDe(v().id, eu(), v().geracao, v().finalistas, v().n, st.dados.meus_eventos);
const albumFotos = () => ordemCronologica(v().album.map(fotoPorId).filter(Boolean));

function quando(iso) {
  if (!iso) return "";
  const [d, h] = iso.split("T");
  const [, m, dia] = d.split("-");
  return `${dia}/${m} ${h.slice(0, 5)}`;
}
function mb(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

// ---------------- render ----------------
function render() {
  $("#nome-viagem").textContent = v().nome;
  $("#btn-pessoa").textContent = st.sessao.nome;
  const iAtual = FASES.findIndex(([f]) => f === v().fase);
  $("#fases").innerHTML = FASES.map(([, rotulo], i) =>
    `<li class="${i === iAtual ? "atual" : i < iAtual ? "feita" : ""}">${i < iAtual ? "✓ " : ""}${rotulo}</li>`).join("");
  const conteudo = { envio: renderEnvio, votos: renderVotos, final: renderFinal, album: renderAlbum }[v().fase]();
  $("#conteudo").innerHTML = (st.api.demo ? `<div class="aviso destaque">Modo demo — troque a fase pelo ⚙ (código de admin: <b>${DEMO_ADMIN}</b>).</div>` : "") + conteudo;
  renderBarra();
}

function filtros(extras) {
  const opcoes = [["todas", "Todas"], ...extras, ...st.dados.participantes.filter((p) => p.fotos > 0).map((p) => [`p:${p.id}`, p.nome])];
  if (!opcoes.some(([k]) => k === st.filtro)) st.filtro = "todas";
  return `<div class="filtros">${opcoes.map(([k, r]) =>
    `<button data-acao="filtro" data-valor="${esc(k)}" class="${k === st.filtro ? "ativo" : ""}">${esc(r)}</button>`).join("")}</div>`;
}

function filtrar(fotos) {
  const f = st.filtro, votos = meusVotos();
  if (f.startsWith("p:")) return fotos.filter((x) => x.participante === f.slice(2));
  if (f === "minhas") return fotos.filter((x) => x.participante === eu());
  if (f === "com") return fotos.filter((x) => votos.has(x.id));
  if (f === "sem") return fotos.filter((x) => !votos.has(x.id));
  return fotos;
}

function grade(fotos, { coracao = false, contagem = false, modo = "ver" } = {}) {
  if (!fotos.length) return `<div class="vazio">Nenhuma foto aqui ainda.</div>`;
  const votos = meusVotos();
  const ids = fotos.map((f) => f.id).join(",");
  return `<div class="grade" data-ids="${ids}">${fotos.map((f, i) => `
    <div class="miniatura ${f.participante === eu() ? "minha" : ""}">
      <img src="${esc(urlThumb(f))}" alt="${esc(f.arquivo)}" loading="lazy" decoding="async">
      <button class="abrir" data-acao="abrir" data-i="${i}" data-modo="${modo}" aria-label="Abrir ${esc(f.arquivo)}"></button>
      <span class="dono">${esc(nomeDe(f.participante))}</span>
      ${coracao ? `<button class="coracao ${votos.has(f.id) ? "sim" : ""}" data-acao="coracao" data-id="${f.id}" aria-label="Marcar">${votos.has(f.id) ? "♥" : "♡"}</button>` : ""}
      ${contagem && f.coracoes != null ? `<span class="contagem">♥ ${f.coracoes}</span>` : ""}
      ${f.orig_ext && v().fase === "album" ? `<span class="tag">original</span>` : ""}
    </div>`).join("")}</div>`;
}

function renderEnvio() {
  const minhas = st.dados.fotos.filter((f) => f.participante === eu()).length;
  const e = st.envio;
  const prog = e ? `
    <div class="progresso"><div style="width:${e.total ? Math.round((e.feitos / e.total) * 100) : 100}%"></div></div>
    <p>${e.rodando ? `Enviando ${e.feitos} de ${e.total}…` : `Pronto: ${e.feitos - e.erros.length} enviadas`}${e.pulados ? ` · ${e.pulados} já estavam lá` : ""}${e.erros.length ? ` · ${e.erros.length} com erro` : ""}</p>
    ${e.erros.length ? `<div class="erros">${e.erros.slice(0, 8).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}` : "";
  return `
    <section class="bloco">
      <h2>Suba suas fotos da viagem</h2>
      <p>Pode mandar quantas quiser: o celular reduz antes de enviar. O original fica com você — no fim, só as que entrarem no álbum pedem o original.</p>
      <label class="btn primario grande" ${e?.rodando ? 'aria-disabled="true"' : ""}>
        ＋ Escolher fotos
        <input id="in-fotos" type="file" accept="image/*" multiple hidden ${e?.rodando ? "disabled" : ""}>
      </label>
      ${prog}
      <p>Você mandou <b>${minhas}</b> · todo mundo: <b>${st.dados.fotos.length}</b>. Pra tirar uma sua, abra a foto.</p>
    </section>
    ${filtros([["minhas", "Minhas"]])}
    ${grade(filtrar(st.dados.fotos), { modo: "envio" })}`;
}

function renderVotos() {
  const n = st.dados.meus_votos.length;
  return `
    <section class="bloco">
      <h2>Marque ♥ nas que você quer no álbum</h2>
      <p>Pode marcar quantas quiser. Ninguém vê os ♥ dos outros até a votação fechar. As mais votadas vão pra final.</p>
      <p>Você marcou <b>${n}</b> de ${st.dados.fotos.length}.</p>
    </section>
    ${filtros([["sem", "Sem meu ♥"], ["com", "Com meu ♥"]])}
    ${grade(filtrar(st.dados.fotos), { coracao: true, modo: "votos" })}`;
}

function progressoPessoas() {
  return `<div class="pessoas-progresso">${st.dados.participantes.map((p) =>
    `<div><span>${esc(p.nome)}</span><span>${p.terminou ? '<span class="ok">✓ terminou</span>' : p.eventos ? `${p.eventos} lotes` : "ainda não começou"}</span></div>`).join("")}</div>`;
}

function renderFinal() {
  const fin = v().finalistas;
  if (fin.length <= v().n) {
    return `<section class="bloco"><h2>Final</h2><p>São ${fin.length} finalistas pra ${v().n} vagas — nada pra cortar. Espere o organizador fechar o álbum.</p></section>`;
  }
  const est = meuTorneio();
  if (terminou(est)) {
    const vivas = est.vivas.map(fotoPorId).filter(Boolean);
    return `
      <section class="bloco">
        <h2>Pronto, seu voto foi! ✓</h2>
        <p>Essas são as suas ${vivas.length} preferidas. O álbum sai da soma do torneio de todo mundo.</p>
        <div class="linha"><button class="btn pequeno" data-acao="desfazer">⟲ Desfazer último lote</button></div>
      </section>
      ${grade(vivas, { contagem: true, modo: "ver" })}
      <section class="bloco"><h3>Quem já terminou</h3>${progressoPessoas()}</section>`;
  }
  const lote = loteAtual(est);
  const fotos = lote.map((id) => fotoPorId(id) || { id, arquivo: "(removida)", participante: null });
  for (const id of [...st.marcadas]) if (!lote.includes(id)) st.marcadas.delete(id);
  for (const id of proximoLote(est)) { const f = fotoPorId(id); if (f) new Image().src = urlMedia(f); }
  return `
    <section class="bloco">
      <h2>Final: corte as que saem</h2>
      <p>${fin.length} finalistas, ${v().n} vagas. Toque nas que <b>saem</b> deste lote e confirme embaixo. 🔍 amplia.</p>
      <div class="info-lote">
        <span>Rodada <b>${est.rodada}</b> · lote <b>${est.indice + 1}</b>/${est.lotes.length} · ${est.vivas.length} vivas</span>
        <span>sugestão: cortar <b>${sugestaoCorte(est)}</b> de ${lote.length}</span>
      </div>
    </section>
    <div class="lote" data-ids="${lote.join(",")}">${fotos.map((f, i) => `
      <div class="candidata ${st.marcadas.has(f.id) ? "cortada" : ""}">
        <img src="${esc(urlMedia(f))}" alt="${esc(f.arquivo)}" decoding="async">
        <button class="marcar" data-acao="cortar" data-id="${f.id}" aria-label="Cortar ${esc(f.arquivo)}"></button>
        <span class="num">${i + 1}</span>
        <button class="lupa" data-acao="abrir" data-i="${i}" data-modo="lote" aria-label="Ampliar">🔍</button>
      </div>`).join("")}</div>`;
}

function renderAlbum() {
  const fotos = albumFotos();
  const minhasSem = fotos.filter((f) => f.participante === eu() && !f.orig_ext);
  const minhas = fotos.filter((f) => f.participante === eu());
  const o = st.orig, z = st.zip;
  const blocoOrig = minhas.length ? `
    <section class="bloco">
      <h2>${minhasSem.length ? `Suba o original de ${minhasSem.length} foto${minhasSem.length > 1 ? "s" : ""} sua${minhasSem.length > 1 ? "s" : ""}` : "Seus originais estão todos lá ✓"}</h2>
      ${minhasSem.length ? `
        <p>Escolha os arquivos originais (pode escolher várias, ou a pasta inteira — eu acho as certas pelo nome). Faltam: ${minhasSem.slice(0, 12).map((f) => esc(f.arquivo)).join(", ")}${minhasSem.length > 12 ? "…" : ""}</p>
        <div class="linha">
          <label class="btn primario">Escolher originais<input id="in-orig" type="file" accept="image/*,.heic,.heif" multiple hidden></label>
          <label class="btn">Escolher a pasta<input id="in-orig-pasta" type="file" webkitdirectory multiple hidden></label>
        </div>` : ""}
      ${o ? `<div class="progresso"><div style="width:${o.total ? Math.round((o.feitos / o.total) * 100) : 100}%"></div></div>
        <p>${o.rodando ? `Enviando ${o.feitos} de ${o.total}…` : `${o.feitos - o.erros.length} originais enviados`}${o.semPar ? ` · ${o.semPar} não achei nos arquivos escolhidos` : ""}</p>
        ${o.erros.length ? `<div class="erros">${o.erros.slice(0, 6).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}` : ""}
    </section>` : "";
  const comOrig = fotos.filter((f) => f.orig_ext).length;
  return `
    <section class="bloco">
      <h2>Álbum fechado: ${fotos.length} fotos</h2>
      <p>${comOrig} de ${fotos.length} já com o original. O .zip usa o original quando tem e a versão reduzida (2048 px) quando não.</p>
      <button class="btn primario grande" data-acao="zip" ${z?.rodando ? "disabled" : ""}>
        ${z?.rodando ? `Baixando ${z.feitos} de ${z.total}…` : "⬇ Baixar álbum (.zip)"}
      </button>
      ${z?.rodando ? `<div class="progresso"><div style="width:${Math.round((z.feitos / z.total) * 100)}%"></div></div>` : ""}
    </section>
    ${blocoOrig}
    ${grade(fotos, { contagem: true, modo: "album" })}`;
}

function renderBarra() {
  const barra = $("#barra");
  let html = "";
  if (v().fase === "final" && v().finalistas.length > v().n) {
    const est = meuTorneio();
    if (!terminou(est)) {
      const tam = loteAtual(est).length, k = st.marcadas.size;
      html = `<button class="btn" data-acao="desfazer" ${est.desfaziveis ? "" : "disabled"}>⟲ Desfazer</button>
        <button class="btn perigo" data-acao="confirmar" ${k >= 1 && k <= tam - 1 && !st.ocupado ? "" : "disabled"}>
          ${k ? `Cortar ${k}` : "Toque nas que saem"}</button>`;
    }
  }
  barra.innerHTML = html;
  barra.classList.toggle("hidden", !html);
}

// ---------------- ações ----------------
$("#conteudo").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-acao]");
  if (!b) return;
  const acao = b.dataset.acao;
  if (acao === "filtro") { st.filtro = b.dataset.valor; render(); }
  else if (acao === "abrir") {
    const ids = b.closest("[data-ids]").dataset.ids.split(",");
    abrirVisor(ids, Number(b.dataset.i), b.dataset.modo);
  }
  else if (acao === "coracao") alternarCoracao(b.dataset.id);
  else if (acao === "cortar") alternarCorte(b.dataset.id);
  else if (acao === "desfazer") desfazer();
  else if (acao === "zip") baixarZip();
});
$("#barra").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-acao]");
  if (b?.dataset.acao === "confirmar") confirmarLote();
  if (b?.dataset.acao === "desfazer") desfazer();
});
$("#conteudo").addEventListener("change", (ev) => {
  if (ev.target.id === "in-fotos") enviarFotos([...ev.target.files]);
  if (ev.target.id === "in-orig" || ev.target.id === "in-orig-pasta") subirOriginais([...ev.target.files]);
});
$("#btn-pessoa").addEventListener("click", () => {
  if (st.api.demo) return toast("No demo você é sempre o Matheus.");
  st.sessao = { ...st.sessao, participante: null };
  salvarSessao();
  mostrarEntrar();
});

async function alternarCoracao(id) {
  const votos = meusVotos(), sim = !votos.has(id);
  st.dados.meus_votos = sim ? [...st.dados.meus_votos, id] : st.dados.meus_votos.filter((x) => x !== id);
  atualizarCoracoes();
  try {
    await st.api.votar(st.sessao, id, sim);
  } catch (e) {
    st.dados.meus_votos = sim ? st.dados.meus_votos.filter((x) => x !== id) : [...st.dados.meus_votos, id];
    atualizarCoracoes();
    toast(e.message);
  }
}

function atualizarCoracoes() {
  const votos = meusVotos();
  for (const b of document.querySelectorAll("#conteudo .coracao")) {
    const sim = votos.has(b.dataset.id);
    b.classList.toggle("sim", sim);
    b.textContent = sim ? "♥" : "♡";
  }
  const p = [...document.querySelectorAll("#conteudo .bloco p")].find((x) => x.textContent.startsWith("Você marcou"));
  if (p) p.innerHTML = `Você marcou <b>${votos.size}</b> de ${st.dados.fotos.length}.`;
  if (st.visor) mostrarVisor();
}

function alternarCorte(id) {
  if (st.marcadas.has(id)) st.marcadas.delete(id);
  else st.marcadas.add(id);
  for (const b of document.querySelectorAll("#conteudo .marcar")) {
    b.closest(".candidata").classList.toggle("cortada", st.marcadas.has(b.dataset.id));
  }
  renderBarra();
  if (st.visor) mostrarVisor();
}

async function confirmarLote() {
  const est = meuTorneio(), lote = loteAtual(est), k = st.marcadas.size;
  if (k < 1 || k > lote.length - 1) return toast("Corte pelo menos 1 e deixe pelo menos 1.");
  const novo = { tipo: "lote", rodada: est.rodada, indice: est.indice, cortadas: lote.filter((id) => st.marcadas.has(id)) };
  novo.terminou = terminou(torneioDe(v().id, eu(), v().geracao, v().finalistas, v().n, [...st.dados.meus_eventos, novo]));
  st.ocupado = true;
  renderBarra();
  const ok = await tentar(() => st.api.evento(st.sessao, novo));
  st.ocupado = false;
  if (ok === undefined) return renderBarra();
  st.dados.meus_eventos.push(novo);
  st.marcadas.clear();
  render();
  scrollTo({ top: 0, behavior: "smooth" });
  if (novo.terminou) carregar(true);
}

async function desfazer() {
  if (st.ocupado) return;
  st.ocupado = true;
  const ok = await tentar(() => st.api.evento(st.sessao, { tipo: "desfaz" }));
  st.ocupado = false;
  if (ok === undefined) return;
  st.dados.meus_eventos.push({ tipo: "desfaz" });
  st.marcadas.clear();
  render();
  toast("Lote desfeito.");
}

// ---------------- envio ----------------
function reduzir(bmp, lado, qualidade) {
  const s = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error("não consegui reduzir"))), "image/jpeg", qualidade));
}

async function subirUma(arquivo) {
  const cab = await arquivo.slice(0, 196608).arrayBuffer();
  const tirada = dataDaFoto(cab) || dataLocal(arquivo.lastModified);
  let bmp;
  try {
    bmp = await createImageBitmap(arquivo);
  } catch {
    throw new Error(/hei[cf]/i.test(arquivo.name + arquivo.type)
      ? "HEIC não abre neste navegador. No iPhone, escolha pela galeria (ele converte sozinho); no PC, converta pra JPG."
      : "não consegui abrir essa imagem.");
  }
  try {
    const t = await reduzir(bmp, 640, 0.8);
    const m = await reduzir(bmp, 2048, 0.85);
    const id = crypto.randomUUID();
    await st.api.subir(caminhos.thumb(st.sessao.pasta, id), t, "image/jpeg");
    await st.api.subir(caminhos.media(st.sessao.pasta, id), m, "image/jpeg");
    await st.api.registrarFoto(st.sessao, { id, arquivo: arquivo.name, tamanho: arquivo.size, tirada_em: tirada,
      largura: bmp.width, altura: bmp.height, bytes_t: t.size, bytes_m: m.size });
  } finally {
    bmp.close?.();
  }
}

async function enviarFotos(arquivos) {
  if (!arquivos.length || st.envio?.rodando) return;
  const ja = new Set(st.dados.fotos.filter((f) => f.participante === eu()).map((f) => `${f.arquivo}|${f.tamanho}`));
  const fila = arquivos.filter((a) => !ja.has(`${a.name}|${a.size}`));
  st.envio = { rodando: true, total: fila.length, feitos: 0, erros: [], pulados: arquivos.length - fila.length };
  render();
  let i = 0;
  const trabalhador = async () => {
    while (i < fila.length) {
      const a = fila[i++];
      try {
        await subirUma(a);
      } catch (e) {
        st.envio.erros.push(`${a.name}: ${e.message}`);
        if (/já fechou/.test(e.message)) i = fila.length;
      }
      st.envio.feitos++;
      if (v().fase === "envio") render();
    }
  };
  await Promise.all([trabalhador(), trabalhador()]);
  st.envio.rodando = false;
  await carregar(true);
  render();
}

// ---------------- originais e zip ----------------
async function subirOriginais(arquivos) {
  if (!arquivos.length || st.orig?.rodando) return;
  const faltando = albumFotos().filter((f) => f.participante === eu() && !f.orig_ext);
  const { pares, sobraram } = casarOriginais(faltando, arquivos);
  st.orig = { rodando: true, total: pares.length, feitos: 0, erros: [], semPar: sobraram.length };
  render();
  for (const { foto, arquivo } of pares) {
    const ext = extensao(arquivo.name);
    try {
      await st.api.subir(caminhos.original(st.sessao.pasta, foto.id, ext), arquivo, arquivo.type || tipoPorNome(arquivo.name));
      await st.api.original(st.sessao, foto.id, ext, arquivo.size);
    } catch (e) {
      st.orig.erros.push(`${arquivo.name}: ${e.message}`);
    }
    st.orig.feitos++;
    render();
  }
  st.orig.rodando = false;
  await carregar(true);
}

function caminhoMelhor(f) {
  return f.orig_ext ? caminhos.original(st.sessao.pasta, f.id, f.orig_ext) : caminhos.media(st.sessao.pasta, f.id);
}

async function baixarZip() {
  if (st.zip?.rodando) return;
  const fotos = albumFotos();
  st.zip = { rodando: true, total: fotos.length, feitos: 0 };
  render();
  const arquivos = [];
  try {
    for (const [i, f] of fotos.entries()) {
      const r = await fetch(st.api.url(caminhoMelhor(f)));
      if (!r.ok) throw new Error(`não consegui baixar ${f.arquivo} (${r.status})`);
      const ext = f.orig_ext || "jpg";
      const [d, h] = (f.tirada_em || "").split("T");
      arquivos.push({ nome: nomeNoZip(i, nomeDe(f.participante), f.arquivo, ext), dados: new Uint8Array(await r.arrayBuffer()),
        data: d ? new Date(`${d}T${h}`) : new Date() });
      st.zip.feitos++;
      render();
    }
    const blob = new Blob(montarZip(arquivos), { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${v().nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "album"}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`Álbum baixado (${mb(blob.size)}).`);
  } catch (e) {
    toast(e.message);
  } finally {
    st.zip.rodando = false;
    render();
  }
}

// ---------------- visor ----------------
function abrirVisor(ids, i, modo) {
  st.visor = { ids, i, modo };
  $("#visor").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  mostrarVisor();
}

function fecharVisor() {
  st.visor = null;
  $("#visor").classList.add("hidden");
  document.body.style.overflow = "";
  $("#visor-img").removeAttribute("src");
}

function mostrarVisor() {
  const { ids, i, modo } = st.visor;
  const f = fotoPorId(ids[i]);
  if (!f) return fecharVisor();
  $("#visor-img").src = urlMedia(f);
  const viz = fotoPorId(ids[(i + 1) % ids.length]);
  if (viz) new Image().src = urlMedia(viz);
  $("#visor-legenda").textContent = `${nomeDe(f.participante)} · ${quando(f.tirada_em)} · ${i + 1}/${ids.length}`;
  const acoes = [];
  if (modo === "votos") {
    const sim = meusVotos().has(f.id);
    acoes.push(`<button class="btn ${sim ? "sim" : ""}" data-visor="coracao">${sim ? "♥ Marcada" : "♡ Marcar"}</button>`);
  }
  if (modo === "lote") {
    const c = st.marcadas.has(f.id);
    acoes.push(`<button class="btn ${c ? "corte" : ""}" data-visor="cortar">${c ? "✕ Sai" : "Cortar"}</button>`);
  }
  if (modo === "album" || (modo === "ver" && v().fase === "album")) {
    const nome = nomeNoZip(v().album.indexOf(f.id), nomeDe(f.participante), f.arquivo, f.orig_ext || "jpg");
    acoes.push(`<a class="btn" href="${esc(st.api.urlDownload(caminhoMelhor(f), nome))}" download="${esc(nome)}">⬇ Baixar</a>`);
  }
  if (modo === "envio" && f.participante === eu() && ["envio", "votos"].includes(v().fase)) {
    acoes.push(`<button class="btn" data-visor="remover">Tirar do álbum</button>`);
  }
  if (st.sessao.admin && st.adm && ["envio", "votos"].includes(v().fase) && f.participante !== eu()) {
    acoes.push(`<button class="btn" data-visor="remover-admin">Remover (admin)</button>`);
  }
  $("#visor-acoes").innerHTML = acoes.join("");
}

function andarVisor(passo) {
  if (!st.visor) return;
  st.visor.i = (st.visor.i + passo + st.visor.ids.length) % st.visor.ids.length;
  mostrarVisor();
}

$("#visor").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-visor]");
  if (!b) return;
  const id = st.visor.ids[st.visor.i];
  const acao = b.dataset.visor;
  if (acao === "fechar") return fecharVisor();
  if (acao === "ant") return andarVisor(-1);
  if (acao === "prox") return andarVisor(1);
  if (acao === "coracao") return alternarCoracao(id);
  if (acao === "cortar") return alternarCorte(id);
  if (acao === "remover" || acao === "remover-admin") {
    if (!confirm("Tirar esta foto? Ela some pra todo mundo.")) return;
    const ok = await tentar(() => (acao === "remover" ? st.api.removerFoto(st.sessao, id)
      : st.api.adminRemover(st.viagem, st.sessao.admin, id)));
    if (ok === undefined) return;
    fecharVisor();
    await carregar();
  }
});
let toqueX = null;
$("#visor").addEventListener("touchstart", (ev) => { toqueX = ev.touches[0].clientX; }, { passive: true });
$("#visor").addEventListener("touchend", (ev) => {
  if (toqueX === null) return;
  const dx = ev.changedTouches[0].clientX - toqueX;
  toqueX = null;
  if (Math.abs(dx) > 50) andarVisor(dx < 0 ? 1 : -1);
});

addEventListener("keydown", (ev) => {
  if (ev.target.matches?.("input, textarea")) return;
  if (st.visor) {
    if (ev.key === "Escape") fecharVisor();
    else if (ev.key === "ArrowRight") andarVisor(1);
    else if (ev.key === "ArrowLeft") andarVisor(-1);
    else if (ev.key === " " || ev.key.toLowerCase() === "x") {
      ev.preventDefault();
      if (st.visor.modo === "lote") alternarCorte(st.visor.ids[st.visor.i]);
      if (st.visor.modo === "votos") alternarCoracao(st.visor.ids[st.visor.i]);
    }
    return;
  }
  if (!$("#painel").classList.contains("hidden")) {
    if (ev.key === "Escape") fecharPainel();
    return;
  }
  if (st.dados && v().fase === "final" && !terminou(meuTorneio())) {
    const lote = loteAtual(meuTorneio());
    if (/^[1-9]$/.test(ev.key) && lote[Number(ev.key) - 1]) alternarCorte(lote[Number(ev.key) - 1]);
    else if (ev.key === "Enter") confirmarLote();
    else if (ev.key === "Backspace") desfazer();
  }
});

// ---------------- painel do admin ----------------
$("#btn-admin").addEventListener("click", abrirPainel);
$("#painel").addEventListener("click", (ev) => {
  if (ev.target.id === "painel" || ev.target.closest("[data-painel=fechar]")) fecharPainel();
});

async function abrirPainel() {
  $("#painel").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (st.sessao.admin) await atualizarPainel();
  else renderPainelLogin();
}

function fecharPainel() {
  $("#painel").classList.add("hidden");
  document.body.style.overflow = "";
}

function renderPainelLogin(msg = "") {
  $("#painel-corpo").innerHTML = `
    <form id="form-admin" class="bloco">
      <p>Só pra quem organiza: trocar de fase, ver o progresso de todo mundo e fechar o álbum.</p>
      <label>Código do admin<input id="in-admin" autocomplete="off" autocapitalize="none" required></label>
      <button class="btn primario" type="submit">Entrar como admin</button>
      <p class="erro-txt">${esc(msg)}</p>
    </form>`;
  $("#form-admin").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const codigo = $("#in-admin").value.trim();
    try {
      st.adm = await st.api.admin(st.viagem, codigo);
      st.sessao.admin = codigo;
      salvarSessao();
      renderPainel();
    } catch (e) {
      renderPainelLogin(e.message);
    }
  });
}

async function atualizarPainel() {
  try {
    st.adm = await st.api.admin(st.viagem, st.sessao.admin);
  } catch (e) {
    if (/Código errado/.test(e.message)) {
      st.sessao.admin = null;
      salvarSessao();
      return renderPainelLogin(e.message);
    }
    return toast(e.message);
  }
  renderPainel();
}

function torneiosDoAdmin() {
  const a = st.adm, vv = a.viagem;
  return a.participantes.map((p) => ({
    participante: p.id,
    est: torneioDe(vv.id, p.id, vv.geracao, vv.finalistas, vv.n,
      a.eventos.filter((e) => e.participante === p.id).map((e) => e.dados)),
  }));
}

function rankingAdmin() {
  const a = st.adm;
  const cor = Object.fromEntries(a.fotos.map((f) => [f.id, f.coracoes]));
  const r = rankingGrupo(a.viagem.finalistas.filter((id) => cor[id] !== undefined), torneiosDoAdmin(), cor);
  const forcadas = Object.fromEntries(a.fotos.filter((f) => f.forcada).map((f) => [f.id, f.forcada]));
  return { ...r, album: montarAlbum(r.linhas, a.viagem.n, forcadas), forcadas };
}

function renderPainel() {
  const a = st.adm, vv = a.viagem, fase = vv.fase;
  const iFase = FASES.findIndex(([f]) => f === fase);
  const proxima = FASES[iFase + 1], anterior = FASES[iFase - 1];
  const thumb = (id) => {
    const f = a.fotos.find((x) => x.id === id);
    return f ? st.api.url(caminhos.thumb(st.sessao.pasta, f.id)) : "";
  };
  const uso = Math.min(100, (a.bytes_total / LIMITE_GRATIS) * 100);
  let extra = "";
  if (fase === "votos" || fase === "envio") {
    const fin = finalistas(a.fotos, vv.k), extras = extrasPorEmpate(a.fotos, vv.k);
    const top = [...a.fotos].filter((f) => f.coracoes > 0).sort((x, y) => y.coracoes - x.coracoes).slice(0, 40);
    extra = `
      <section class="bloco">
        <h3>Prévia da final</h3>
        <p>Com K = ${vv.k}: <b>${fin.length}</b> finalistas${extras ? ` (${extras} a mais por empate no corte)` : ""}. Foto sem ♥ não entra.</p>
        <div class="ranking">${top.map((f, i) => `
          <div class="ranking-item ${fin.includes(f.id) ? "dentro" : ""}">
            <span class="pos">${i + 1}</span><img src="${esc(thumb(f.id))}" alt="" loading="lazy">
            <span>${esc(f.arquivo)}<br><span class="muted">${esc(nomeDe(f.participante))}</span></span><span>♥ ${f.coracoes}</span>
          </div>`).join("") || '<div class="vazio">Ninguém votou ainda.</div>'}</div>
      </section>`;
  }
  if (fase === "final" || fase === "album") {
    const { linhas, votantes, album, forcadas } = rankingAdmin();
    extra = `
      <section class="bloco">
        <h3>Ranking do grupo</h3>
        <p>${votantes} de ${a.participantes.length} já jogaram (parcial conta). Pontos = quantas finalistas cada um deixou atrás desta; desempate por ♥.
          Verde = entra no álbum (${album.ids.length}/${vv.n}).</p>
        ${album.empateNoCorte ? `<div class="aviso destaque">A última vaga caiu num empate. Use Dentro/Fora pra decidir.</div>` : ""}
        <div class="ranking">${linhas.map((l) => `
          <div class="ranking-item ${album.ids.includes(l.id) ? "dentro" : ""}">
            <span class="pos">${l.posicao}</span><img src="${esc(thumb(l.id))}" alt="" loading="lazy">
            <span>${l.pontos} pts · ♥ ${l.coracoes}${l.empate ? '<span class="selo empate">empate</span>' : ""}${forcadas[l.id] ? `<span class="selo forcada">${forcadas[l.id]}</span>` : ""}</span>
            <span class="forcar">${[["", "Auto"], ["dentro", "Dentro"], ["fora", "Fora"]].map(([k, r]) =>
              `<button data-forcar="${l.id}" data-valor="${k}" class="${(forcadas[l.id] || "") === k ? "ativo" : ""}" ${fase === "album" ? "disabled" : ""}>${r}</button>`).join("")}</span>
          </div>`).join("")}</div>
      </section>`;
  }
  const textoAvancar = {
    envio: "Fechar o envio e abrir a votação",
    votos: "Fechar a votação e começar a final",
    final: "Fechar o álbum",
  }[fase];
  $("#painel-corpo").innerHTML = `
    <section class="bloco">
      <h3>Fase: ${FASES[iFase][1]}</h3>
      <div class="linha">
        ${anterior ? `<button class="btn pequeno" data-fase="${anterior[0]}">← Voltar pra ${anterior[1]}</button>` : ""}
        <span class="espaco"></span>
        ${proxima ? `<button class="btn primario pequeno" data-fase="${proxima[0]}">${textoAvancar} →</button>` : ""}
      </div>
    </section>
    <section class="bloco">
      <h3>Tamanhos</h3>
      <div class="linha">
        <label class="campo-num">Finalistas (K)<input id="in-k" type="number" min="1" max="500" value="${vv.k}" ${fase === "final" ? "disabled" : ""}></label>
        <label class="campo-num">Álbum (N)<input id="in-n" type="number" min="1" max="500" value="${vv.n}" ${fase === "final" ? "disabled" : ""}></label>
        <button class="btn pequeno" data-config ${fase === "final" ? "disabled" : ""}>Salvar</button>
      </div>
      ${fase === "final" ? "<p>Travado durante a final: mudar mudaria o torneio de todo mundo. Volte pra Votos se precisar.</p>" : ""}
    </section>
    <section class="bloco">
      <h3>Pessoas</h3>
      <table><tr><th>Nome</th><th class="num">Fotos</th><th class="num">♥ dados</th><th class="num">Final</th></tr>
        ${a.participantes.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${p.fotos}</td><td class="num">${p.votos}</td>
          <td class="num">${p.terminou ? '<span class="ok">✓</span>' : p.eventos ? `${p.eventos} lotes` : "—"}</td></tr>`).join("")}
      </table>
    </section>
    ${extra}
    <section class="bloco">
      <h3>Espaço no Supabase</h3>
      <div class="progresso uso"><div style="width:${uso.toFixed(1)}%"></div></div>
      <p>Esta viagem: ~${mb(a.bytes_viagem)} · todas: ~${mb(a.bytes_total)} de 1 GB grátis (aproximado).</p>
    </section>
    <button class="btn pequeno" data-sair-admin>Sair do modo admin</button>`;
}

$("#painel-corpo").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b || b.disabled) return;
  const a = st.adm, vv = a?.viagem;
  if (b.dataset.fase) {
    const alvo = b.dataset.fase;
    let fotos = null, pergunta = "";
    if (alvo === "votos" && vv.fase === "envio") pergunta = "Fechar o envio? Depois disso ninguém sobe foto nova (dá pra voltar).";
    else if (alvo === "final" && vv.fase !== "album") {
      fotos = finalistas(a.fotos, vv.k);
      if (fotos.length < 2) return toast("Precisa de pelo menos 2 fotos com ♥.");
      pergunta = `Começar a final com ${fotos.length} finalistas e álbum de ${vv.n}? Cada um faz o próprio torneio.`;
    } else if (alvo === "album") {
      const { album } = rankingAdmin();
      fotos = album.ids;
      pergunta = `Fechar o álbum com ${fotos.length} fotos?${album.empateNoCorte ? " ATENÇÃO: a última vaga está empatada." : ""}`;
    } else if (alvo === "votos" && vv.fase === "final") {
      pergunta = "Voltar pra votação? Quando a final abrir de novo, o torneio recomeça do zero pra todo mundo.";
    } else {
      pergunta = `Voltar pra fase ${FASES.find(([f]) => f === alvo)[1]}?`;
    }
    if (!confirm(pergunta)) return;
    const ok = await tentar(() => st.api.adminFase(st.viagem, st.sessao.admin, alvo, fotos));
    if (ok === undefined) return;
    st.marcadas.clear();
    await carregar();
    await atualizarPainel();
  } else if ("config" in b.dataset) {
    const k = Number($("#in-k").value), n = Number($("#in-n").value);
    const ok = await tentar(() => st.api.adminConfig(st.viagem, st.sessao.admin, k, n));
    if (ok !== undefined) { toast("Salvo."); await atualizarPainel(); await carregar(true); }
  } else if (b.dataset.forcar) {
    const ok = await tentar(() => st.api.adminForcar(st.viagem, st.sessao.admin, b.dataset.forcar, b.dataset.valor));
    if (ok !== undefined) await atualizarPainel();
  } else if ("sairAdmin" in b.dataset) {
    st.sessao.admin = null;
    st.adm = null;
    salvarSessao();
    renderPainelLogin();
  }
});

// ---------------- demo ----------------
function imagemFalsa(i, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const cor = (i * 47) % 360;
  const ceu = g.createLinearGradient(0, 0, 0, h);
  ceu.addColorStop(0, `hsl(${cor} 60% 70%)`);
  ceu.addColorStop(1, `hsl(${(cor + 40) % 360} 55% 45%)`);
  g.fillStyle = ceu;
  g.fillRect(0, 0, w, h);
  g.fillStyle = `hsl(${(cor + 180) % 360} 30% 22%)`;
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += w / 8) g.lineTo(x, h * (0.55 + 0.18 * Math.sin(x / w * 6 + i)));
  g.lineTo(w, h);
  g.fill();
  g.fillStyle = "rgba(255,255,255,.92)";
  g.font = `700 ${Math.round(h / 4)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.fillText(String(i + 1), w / 2, h / 2.6);
  return c.toDataURL("image/jpeg", 0.8);
}

// colou outro link na mesma aba: só o # muda, então recomeça do zero
addEventListener("hashchange", () => location.reload());

iniciar();
