# Álbum da viagem

Site estático (web/, sem framework, ES modules) + Supabase do pombaiera (schema `album`, bucket `album`).

- O site só fala com RPCs `public.album_*` (security definer, `search_path = ''`), que conferem o código
  via `album.confere` (sha256 de `viagem:codigo`; o código de admin também vale como da turma).
  Tabelas no schema `album`, sem grant pra anon. `schema.sql` tem que continuar idempotente.
- Storage: bucket público pra leitura; INSERT só com o 1º segmento do caminho = `pasta` válida
  (`album_pasta_valida`). Caminhos em `api.js#caminhos`: `<pasta>/<id>_t.jpg`, `_m.jpg`, `orig/<id>.<ext>`.
  Sem update/delete pelo site — remover é soft delete.
- Torneio: `web/logica/torneio.js` é porte do `~/deving/desktop/PhotoPicker/picker.py`, mas com RNG
  próprio (xmur3 + mulberry32) — os lotes NÃO batem com o do Python. Semente =
  `viagem:participante:geracao`. O servidor só guarda eventos (`lote`/`desfaz`); estado é replay.
  Mudar `LOTE`, `lotesDaRodada` ou o RNG muda torneios em andamento.
- `geracao` sobe quando a final abre vindo de envio/votos (finalistas novos = torneio novo pra todos);
  voltar de álbum → final mantém. K e N travam na final.
- Finalistas, Borda e álbum são calculados no navegador do admin (`logica/agregar.js`) e mandados
  prontos pro `album_admin_fase`.
- `criarDemo` em `api.js` replica as regras do SQL em memória (`?demo=fase`). Mudou regra no SQL →
  mude no demo e em `tests/demo.test.js`.
- Testes: `./album_test.sh` (node --test). Teste de navegador e de SQL ficam fora do repo: Firefox
  headless via Marionette (perfil próprio, nunca na tela do Matheus) e Postgres 15 + PostgREST no podman
  com stub do schema `storage`.
