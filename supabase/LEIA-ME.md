# Álbum — configurar o Supabase

Usa o **mesmo projeto do Jogo do Pombo** (o endereço e a chave já estão em `web/config.js`).
Nada do pombo é mexido: o álbum fica num schema próprio (`album`) e num bucket próprio (`album`).

## 1. Criar as tabelas, funções e o bucket (uma vez só)

1. Abra o projeto em [supabase.com](https://supabase.com) → **SQL Editor** → *New query*.
2. Cole o arquivo inteiro [`schema.sql`](schema.sql) e clique em **Run**. Deve aparecer "Success".
   Pode rodar de novo quando o arquivo mudar: não perde nada.
3. Confira em **Storage** que apareceu o bucket **album** marcado como *Public*.

## 2. Criar a viagem

Ainda no SQL Editor, rode (troque os três textos):

```sql
select album_criar_viagem('Serra da Mantiqueira de moto', 'serra-turma-2026', 'serra-admin-bem-dificil');
```

- 1º: o nome que aparece no topo.
- 2º: o **código da turma** — você manda no grupo junto com o link. Mínimo 6 caracteres;
  quanto mais comprido, mais difícil de adivinhar.
- 3º: o **código de admin** — só seu. Ele também serve pra entrar como participante.

O resultado é o link, tipo `https://robin-ud.github.io/album/#3f74666c-…`. Mande o link e o
código da turma no grupo. Cada um entra, digita o código e o nome, e o celular lembra.

## 3. Organizar (no site)

Toque no ⚙ e digite o código de admin. Dali você:

- avança as fases: **Envio** → **Votos ♥** → **Final** → **Álbum** (e volta, se precisar);
- define **K** (quantas vão pra final pelos ♥ — as empatadas no corte entram todas) e
  **N** (tamanho do álbum). Durante a final os dois ficam travados;
- acompanha quem já mandou foto, quem votou e quem terminou o torneio;
- na final, vê o ranking somado e pode forçar uma foto **Dentro** ou **Fora** antes de fechar.

## 4. Quanto cabe

O plano grátis tem **1 GB** de Storage. Cada foto ocupa ~0,5 MB (miniatura + versão de 2048 px);
os originais só das fotos do álbum, uns 3–8 MB cada. 4 pessoas × 150 fotos + 30 originais ≈ 450 MB.
O painel ⚙ mostra o uso aproximado.

## 5. Ver os dados / apagar uma viagem

No **Table Editor**, troque o schema de `public` para **`album`**.

Pra apagar tudo de uma viagem depois que todo mundo baixou:

```sql
select album_limpar('<id da viagem — o que vem depois do # no link>');
```

Isso apaga os registros e devolve o nome da pasta. Os **arquivos** você apaga em
**Storage → album → (a pasta) → selecionar tudo → Delete** (o SQL não consegue apagar arquivo do Storage).

## Segurança, em uma frase por item

- O site não lê tabela nenhuma: só chama as funções `album_*`, e todas conferem o código.
- Os códigos ficam guardados com hash (sha256); errar o código demora meio segundo de propósito.
- As fotos ficam numa pasta com nome aleatório de 64 letras. O bucket é público pra leitura,
  mas só quem sabe o endereço exato de cada foto consegue abrir — e esse endereço só sai pras
  funções que pedem o código. Ninguém lista, troca ou apaga arquivo pelo site.
- Quem tem o código da turma consegue entrar com qualquer nome. É um álbum entre amigos, não um banco.
