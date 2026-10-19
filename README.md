# Álbum da viagem

Pra quando todo mundo da viagem tirou foto e vocês querem montar **um álbum só**, juntos.
Cada um sobe as próprias fotos pelo celular, todo mundo marca ♥ nas que quer, as mais votadas
vão pra uma final por lotes (igual ao [PhotoPicker](https://github.com/Robin-Ud/PhotoPicker)),
e o álbum sai da soma de todo mundo — sem limbo de empate. No fim, cada um sobe o original das
suas que entraram e qualquer um baixa o álbum inteiro num .zip.

Site estático (HTML/CSS/JS sem framework) no GitHub Pages + Supabase (banco e fotos).

## Como funciona

1. **Envio** — cada um escolhe as fotos no celular. O navegador reduz antes de mandar
   (miniatura + 2048 px) e lê a hora da foto no EXIF, pra viagem ficar em ordem no tempo
   entre todo mundo. Mandar de novo o mesmo arquivo não duplica.
2. **Votos ♥** — cada um marca as que quer no álbum. Ninguém vê os ♥ dos outros até fechar.
3. **Final** — as K mais votadas (mais as empatadas no corte) viram finalistas. Cada um faz o
   próprio torneio por lotes: aparecem ~6, você corta as piores, até sobrar o tamanho do álbum.
   Funciona trocando de aparelho no meio, e dá pra desfazer lote por lote.
   O ranking do grupo soma os torneios (contagem de Borda); o desempate é pelos ♥.
4. **Álbum** — grade em ordem cronológica, **Baixar álbum (.zip)** e download foto a foto.
   Cada um sobe o original das próprias fotos que entraram (pode escolher a pasta inteira:
   o site acha as certas pelo nome).

Quem organiza troca as fases pelo ⚙ com o código de admin.

## Testar sem banco

```
cd web && python3 -m http.server 8000
```

Abra `http://localhost:8000/?demo` (ou `?demo=votos`, `?demo=final`, `?demo=album`).
O modo demo inventa 4 pessoas e 30 fotos, guarda tudo na memória e não manda nada pra lugar
nenhum. O código de admin do demo é `admin1`.

## Configurar de verdade

Passo a passo em [`supabase/LEIA-ME.md`](supabase/LEIA-ME.md): colar o `schema.sql`, criar a
viagem e mandar o link + código no grupo.

## Arquivos

- `web/` — o site, publicado pelo GitHub Pages a cada push (`.github/workflows/pages.yml`)
  - `app.js` — telas e ações
  - `api.js` — chamadas ao Supabase + o backend demo
  - `logica/` — torneio, agregação, EXIF, zip e casamento dos originais (sem DOM, testado)
  - `config.js` — endereço e chave publishable do Supabase
- `supabase/schema.sql` — tabelas, funções, bucket e permissões
- `tests/` + `album_test.sh` — testes com `node --test` (não tocam no Supabase)
