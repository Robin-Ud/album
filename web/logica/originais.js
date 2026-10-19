// Casa os arquivos que a pessoa escolheu com as fotos dela que entraram no álbum.

const EXTENSOES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif",
  webp: "image/webp", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff" };

export function extensao(nome) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(nome || "");
  return m ? m[1].toLowerCase() : "";
}

/** Tipo MIME pelo nome (o navegador às vezes manda vazio pra HEIC). null = formato que o bucket não aceita. */
export function tipoPorNome(nome) {
  return EXTENSOES[extensao(nome)] || null;
}

const base = (nome) => (nome || "").replace(/\.[^.]+$/, "").toLowerCase();

/**
 * faltando = [{id, arquivo, tamanho}] (fotos minhas do álbum sem original)
 * arquivos = [{name, size}] (File do navegador serve)
 * → {pares: [{foto, arquivo}], sobraram: [foto]}
 * Prioridade: mesmo nome e mesmo tamanho; depois mesmo nome sem a extensão (o iPhone troca .HEIC
 * por .jpeg ao escolher), desde que só um arquivo bata.
 */
export function casarOriginais(faltando, arquivos) {
  const usados = new Set(), pares = [], sobraram = [];
  const validos = arquivos.filter((a) => tipoPorNome(a.name));
  for (const foto of faltando) {
    let achou = validos.find((a) => !usados.has(a) && a.name === foto.arquivo && a.size === foto.tamanho);
    if (!achou) {
      const candidatos = validos.filter((a) => !usados.has(a) && base(a.name) === base(foto.arquivo));
      if (candidatos.length === 1) achou = candidatos[0];
      else if (candidatos.length > 1) achou = candidatos.reduce((m, a) => (a.size > m.size ? a : m));   // o maior é o original
    }
    if (achou) {
      usados.add(achou);
      pares.push({ foto, arquivo: achou });
    } else {
      sobraram.push(foto);
    }
  }
  return { pares, sobraram };
}
