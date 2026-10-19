-- Álbum compartilhado da viagem.
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run". Pode rodar de novo sem perder dados.
--
-- As tabelas ficam no schema `album`, que o site NÃO enxerga. O site só chama as funções
-- `public.album_*` abaixo, e todas conferem o código da viagem antes de fazer qualquer coisa.
-- As fotos ficam no bucket `album` do Storage, numa pasta com nome secreto por viagem.
--
-- Criar uma viagem (só aqui no SQL Editor):
--   select album_criar_viagem('Serra de moto', 'codigo-da-turma', 'codigo-do-admin');
-- Apagar uma viagem inteira (registros; os arquivos você apaga no Storage, veja o LEIA-ME):
--   select album_limpar('<id da viagem>');

-- ---------------- tabelas ----------------
create schema if not exists album;
revoke all on schema album from public, anon, authenticated;

create table if not exists album.viagens (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  criada_em      timestamptz not null default now(),
  codigo_hash    text not null,
  admin_hash     text not null,
  pasta          text not null unique,          -- pasta secreta no Storage
  fase           text not null default 'envio' check (fase in ('envio', 'votos', 'final', 'album')),
  finalistas_k   int not null default 40 check (finalistas_k between 1 and 500),
  tamanho_album  int not null default 20 check (tamanho_album between 1 and 500),
  geracao        int not null default 0,        -- muda cada vez que os finalistas são refeitos
  finalistas     uuid[] not null default '{}',
  album          uuid[] not null default '{}'
);

create table if not exists album.participantes (
  id        uuid primary key default gen_random_uuid(),
  viagem    uuid not null references album.viagens (id) on delete cascade,
  nome      text not null check (char_length(nome) between 1 and 40),
  criado_em timestamptz not null default now()
);
create unique index if not exists participantes_nome_idx on album.participantes (viagem, lower(nome));

create table if not exists album.fotos (
  id           uuid primary key,                -- gerado no navegador (é o nome do arquivo no Storage)
  viagem       uuid not null references album.viagens (id) on delete cascade,
  participante uuid not null references album.participantes (id) on delete cascade,
  arquivo      text not null check (char_length(arquivo) <= 200),
  tamanho      bigint not null,
  tirada_em    text check (tirada_em ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'),
  largura      int,
  altura       int,
  bytes_t      int not null default 0,
  bytes_m      int not null default 0,
  bytes_orig   bigint,
  orig_ext     text check (orig_ext ~ '^[a-z0-9]{1,5}$'),
  forcada      text check (forcada in ('dentro', 'fora')),
  removida     boolean not null default false,
  criada_em    timestamptz not null default now(),
  unique (participante, arquivo, tamanho)
);
create index if not exists fotos_viagem_idx on album.fotos (viagem);

create table if not exists album.votos (
  foto         uuid not null references album.fotos (id) on delete cascade,
  participante uuid not null references album.participantes (id) on delete cascade,
  primary key (foto, participante)
);

create table if not exists album.eventos (
  id           bigint generated always as identity primary key,
  viagem       uuid not null references album.viagens (id) on delete cascade,
  participante uuid not null references album.participantes (id) on delete cascade,
  geracao      int not null,
  quando       timestamptz not null default now(),
  dados        jsonb not null check (pg_column_size(dados) < 8000)
);
create index if not exists eventos_participante_idx on album.eventos (participante, geracao, id);

revoke all on all tables in schema album from public, anon, authenticated;
-- RLS ligado sem policy = ninguém de fora lê nada, mesmo se alguém expor o schema por engano.
-- As funções album_* são security definer do dono das tabelas (postgres), que não passa pelo RLS.
alter table album.viagens       enable row level security;
alter table album.participantes enable row level security;
alter table album.fotos         enable row level security;
alter table album.votos         enable row level security;
alter table album.eventos       enable row level security;

-- ---------------- ajudantes (internos) ----------------
create or replace function album.hash(p_viagem uuid, p_codigo text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_viagem::text || ':' || lower(btrim(coalesce(p_codigo, ''))), 'UTF8')), 'hex')
$$;

-- devolve a viagem se o código bate (o código de admin também serve como código normal)
create or replace function album.confere(p_viagem uuid, p_codigo text, p_admin boolean default false)
returns album.viagens
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
  h text;
begin
  select * into v from album.viagens where id = p_viagem;
  h := album.hash(p_viagem, p_codigo);
  if v.id is null or not (h = v.admin_hash or (not p_admin and h = v.codigo_hash)) then
    perform pg_sleep(0.4);  -- freia quem tenta adivinhar
    raise exception 'Código errado.' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function album.membro(p_viagem uuid, p_participante uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from album.participantes where id = p_participante and viagem = p_viagem) then
    raise exception 'Participante desconhecido — entre de novo.' using errcode = '28000';
  end if;
end $$;

create or replace function album.fotos_json(p_viagem uuid, p_com_coracoes boolean) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
      'id', f.id, 'participante', f.participante, 'arquivo', f.arquivo, 'tamanho', f.tamanho,
      'tirada_em', f.tirada_em, 'largura', f.largura, 'altura', f.altura, 'orig_ext', f.orig_ext,
      'forcada', f.forcada,
      'coracoes', case when p_com_coracoes then (select count(*) from album.votos vo where vo.foto = f.id) end
    ) order by f.tirada_em nulls last, f.arquivo), '[]'::json)
  from album.fotos f
  where f.viagem = p_viagem and not f.removida
$$;

create or replace function album.viagem_json(v album.viagens) returns json
language sql stable set search_path = '' as $$
  select json_build_object('id', v.id, 'nome', v.nome, 'fase', v.fase, 'k', v.finalistas_k,
    'n', v.tamanho_album, 'geracao', v.geracao, 'finalistas', to_json(v.finalistas), 'album', to_json(v.album))
$$;

create or replace function album.participantes_json(v album.viagens) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
      'id', p.id, 'nome', p.nome,
      'fotos', (select count(*) from album.fotos f where f.participante = p.id and not f.removida),
      'votos', (select count(*) from album.votos vo where vo.participante = p.id),
      'eventos', (select count(*) from album.eventos e where e.participante = p.id and e.geracao = v.geracao),
      'terminou', coalesce((select (e.dados ->> 'terminou')::boolean from album.eventos e
                            where e.participante = p.id and e.geracao = v.geracao order by e.id desc limit 1), false)
    ) order by p.criado_em), '[]'::json)
  from album.participantes p
  where p.viagem = v.id
$$;

revoke all on all functions in schema album from public, anon, authenticated;

-- ---------------- o que o site chama ----------------
create or replace function public.album_entrar(p_viagem uuid, p_codigo text, p_nome text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
  n text := btrim(coalesce(p_nome, ''));
  pid uuid;
begin
  v := album.confere(p_viagem, p_codigo);
  if char_length(n) not between 1 and 40 then
    raise exception 'Nome inválido (de 1 a 40 letras).';
  end if;
  select id into pid from album.participantes where viagem = v.id and lower(nome) = lower(n);
  if pid is null then
    insert into album.participantes (viagem, nome) values (v.id, n) returning id into pid;
  end if;
  return json_build_object('participante', pid, 'nome', (select nome from album.participantes where id = pid),
                           'pasta', v.pasta, 'viagem', album.viagem_json(v));
end $$;

create or replace function public.album_estado(p_viagem uuid, p_codigo text, p_participante uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_codigo);
  perform album.membro(v.id, p_participante);
  return json_build_object(
    'viagem', album.viagem_json(v),
    'pasta', v.pasta,
    'participantes', album.participantes_json(v),
    -- os ❤ dos outros só aparecem depois que a votação fecha
    'fotos', album.fotos_json(v.id, v.fase in ('final', 'album')),
    'meus_votos', (select coalesce(json_agg(vo.foto), '[]'::json) from album.votos vo
                   join album.fotos f on f.id = vo.foto
                   where vo.participante = p_participante and f.viagem = v.id and not f.removida),
    'meus_eventos', (select coalesce(json_agg(e.dados order by e.id), '[]'::json) from album.eventos e
                     where e.participante = p_participante and e.geracao = v.geracao)
  );
end $$;

create or replace function public.album_registrar_foto(p_viagem uuid, p_codigo text, p_participante uuid, p_foto jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
  fid uuid;
begin
  v := album.confere(p_viagem, p_codigo);
  perform album.membro(v.id, p_participante);
  if v.fase <> 'envio' then
    raise exception 'O envio de fotos já fechou.';
  end if;
  if (select count(*) from album.fotos where participante = p_participante and not removida) >= 600 then
    raise exception 'Limite de 600 fotos por pessoa.';
  end if;
  insert into album.fotos as f (id, viagem, participante, arquivo, tamanho, tirada_em, largura, altura, bytes_t, bytes_m)
  values ((p_foto ->> 'id')::uuid, v.id, p_participante, left(p_foto ->> 'arquivo', 200),
          (p_foto ->> 'tamanho')::bigint, nullif(p_foto ->> 'tirada_em', ''),
          (p_foto ->> 'largura')::int, (p_foto ->> 'altura')::int,
          coalesce((p_foto ->> 'bytes_t')::int, 0), coalesce((p_foto ->> 'bytes_m')::int, 0))
  on conflict (participante, arquivo, tamanho) do update set removida = false
  returning f.id into fid;
  return fid;
end $$;

create or replace function public.album_remover_foto(p_viagem uuid, p_codigo text, p_participante uuid, p_foto uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_codigo);
  perform album.membro(v.id, p_participante);
  if v.fase not in ('envio', 'votos') then
    raise exception 'Nesta fase não dá mais pra tirar fotos.';
  end if;
  update album.fotos set removida = true where id = p_foto and viagem = v.id and participante = p_participante;
  if not found then
    raise exception 'Só quem enviou pode tirar a foto.';
  end if;
  delete from album.votos where foto = p_foto;
end $$;

create or replace function public.album_votar(p_viagem uuid, p_codigo text, p_participante uuid, p_foto uuid, p_sim boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_codigo);
  perform album.membro(v.id, p_participante);
  if v.fase <> 'votos' then
    raise exception 'A votação não está aberta.';
  end if;
  if not exists (select 1 from album.fotos where id = p_foto and viagem = v.id and not removida) then
    raise exception 'Foto não encontrada.';
  end if;
  if p_sim then
    insert into album.votos (foto, participante) values (p_foto, p_participante) on conflict do nothing;
  else
    delete from album.votos where foto = p_foto and participante = p_participante;
  end if;
end $$;

create or replace function public.album_evento(p_viagem uuid, p_codigo text, p_participante uuid, p_dados jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
  eid bigint;
begin
  v := album.confere(p_viagem, p_codigo);
  perform album.membro(v.id, p_participante);
  if v.fase <> 'final' then
    raise exception 'O torneio não está aberto.';
  end if;
  if coalesce(p_dados ->> 'tipo', '') not in ('lote', 'desfaz') then
    raise exception 'Evento inválido.';
  end if;
  insert into album.eventos (viagem, participante, geracao, dados)
  values (v.id, p_participante, v.geracao, p_dados) returning id into eid;
  return eid;
end $$;

create or replace function public.album_original(p_viagem uuid, p_codigo text, p_participante uuid, p_foto uuid,
                                                 p_ext text, p_bytes bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_codigo);
  perform album.membro(v.id, p_participante);
  if v.fase <> 'album' or not (p_foto = any (v.album)) then
    raise exception 'Original só das fotos do álbum, depois que ele fecha.';
  end if;
  update album.fotos set orig_ext = lower(p_ext), bytes_orig = p_bytes
  where id = p_foto and viagem = v.id and participante = p_participante;
  if not found then
    raise exception 'Só quem tirou a foto sobe o original.';
  end if;
end $$;

-- ---------------- admin (código do admin) ----------------
create or replace function public.album_admin(p_viagem uuid, p_admin text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_admin, true);
  return json_build_object(
    'viagem', album.viagem_json(v),
    'participantes', album.participantes_json(v),
    'fotos', album.fotos_json(v.id, true),
    'eventos', (select coalesce(json_agg(json_build_object('participante', e.participante, 'dados', e.dados) order by e.id), '[]'::json)
                from album.eventos e where e.viagem = v.id and e.geracao = v.geracao),
    -- inclui as removidas: o arquivo continua no Storage
    'bytes_viagem', (select coalesce(sum(bytes_t + bytes_m + coalesce(bytes_orig, 0)), 0) from album.fotos where viagem = v.id),
    'bytes_total', (select coalesce(sum(bytes_t + bytes_m + coalesce(bytes_orig, 0)), 0) from album.fotos)
  );
end $$;

create or replace function public.album_admin_config(p_viagem uuid, p_admin text, p_k int, p_n int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_admin, true);
  if v.fase = 'final' then
    raise exception 'Durante o torneio não dá pra mudar K nem N (mudaria o torneio de todo mundo).';
  end if;
  update album.viagens set finalistas_k = p_k, tamanho_album = p_n where id = v.id;
end $$;

-- p_fotos: finalistas (indo pra 'final') ou o álbum (indo pra 'album'), calculados no site
create or replace function public.album_admin_fase(p_viagem uuid, p_admin text, p_fase text, p_fotos uuid[] default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
  validas uuid[];
begin
  v := album.confere(p_viagem, p_admin, true);
  if p_fase not in ('envio', 'votos', 'final', 'album') then
    raise exception 'Fase inválida.';
  end if;
  if p_fotos is not null then
    select coalesce(array_agg(id), '{}') into validas from album.fotos
    where viagem = v.id and not removida and id = any (p_fotos);
  end if;
  if p_fase = 'final' and v.fase in ('envio', 'votos') then
    if coalesce(cardinality(validas), 0) < 2 then
      raise exception 'Precisa de pelo menos 2 finalistas.';
    end if;
    -- finalistas novos = torneio novo pra todo mundo
    update album.viagens set fase = 'final', finalistas = validas, geracao = geracao + 1 where id = v.id;
  elsif p_fase = 'album' then
    if coalesce(cardinality(validas), 0) < 1 then
      raise exception 'O álbum precisa de pelo menos 1 foto.';
    end if;
    update album.viagens set fase = 'album', album = validas where id = v.id;
  else
    update album.viagens set fase = p_fase where id = v.id;
  end if;
end $$;

create or replace function public.album_admin_forcar(p_viagem uuid, p_admin text, p_foto uuid, p_forcada text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_admin, true);
  update album.fotos set forcada = nullif(p_forcada, '') where id = p_foto and viagem = v.id;
end $$;

create or replace function public.album_admin_remover(p_viagem uuid, p_admin text, p_foto uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v album.viagens;
begin
  v := album.confere(p_viagem, p_admin, true);
  update album.fotos set removida = true where id = p_foto and viagem = v.id;
  delete from album.votos where foto = p_foto;
end $$;

-- ---------------- só no SQL Editor ----------------
create or replace function public.album_criar_viagem(p_nome text, p_codigo text, p_admin text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  vid uuid := gen_random_uuid();
begin
  if char_length(btrim(coalesce(p_codigo, ''))) < 6 or char_length(btrim(coalesce(p_admin, ''))) < 6 then
    raise exception 'Use códigos com pelo menos 6 caracteres.';
  end if;
  if lower(btrim(p_codigo)) = lower(btrim(p_admin)) then
    raise exception 'O código do admin tem que ser diferente do da turma.';
  end if;
  insert into album.viagens (id, nome, codigo_hash, admin_hash, pasta)
  values (vid, p_nome, album.hash(vid, p_codigo), album.hash(vid, p_admin),
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  return 'https://robin-ud.github.io/album/#' || vid;
end $$;

create or replace function public.album_limpar(p_viagem uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p text;
begin
  delete from album.viagens where id = p_viagem returning pasta into p;
  if p is null then
    raise exception 'Viagem não encontrada.';
  end if;
  return 'Registros apagados. Agora apague a pasta ' || p || ' do bucket album (Storage).';
end $$;

-- ---------------- Storage ----------------
create or replace function public.album_pasta_valida(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from album.viagens where pasta = p)
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album', 'album', true, 52428800,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/avif', 'image/tiff'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- qualquer um lê pelo endereço exato (bucket público); enviar só pra dentro de uma pasta de viagem;
-- ninguém lista, troca nem apaga pelo site
drop policy if exists "album: enviar pra pasta da viagem" on storage.objects;
create policy "album: enviar pra pasta da viagem" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'album' and public.album_pasta_valida((storage.foldername(name))[1]));

-- ---------------- permissões ----------------
revoke all on function public.album_entrar(uuid, text, text) from public;
revoke all on function public.album_estado(uuid, text, uuid) from public;
revoke all on function public.album_registrar_foto(uuid, text, uuid, jsonb) from public;
revoke all on function public.album_remover_foto(uuid, text, uuid, uuid) from public;
revoke all on function public.album_votar(uuid, text, uuid, uuid, boolean) from public;
revoke all on function public.album_evento(uuid, text, uuid, jsonb) from public;
revoke all on function public.album_original(uuid, text, uuid, uuid, text, bigint) from public;
revoke all on function public.album_admin(uuid, text) from public;
revoke all on function public.album_admin_config(uuid, text, int, int) from public;
revoke all on function public.album_admin_fase(uuid, text, text, uuid[]) from public;
revoke all on function public.album_admin_forcar(uuid, text, uuid, text) from public;
revoke all on function public.album_admin_remover(uuid, text, uuid) from public;
revoke all on function public.album_pasta_valida(text) from public;
revoke all on function public.album_criar_viagem(text, text, text) from public, anon, authenticated;
revoke all on function public.album_limpar(uuid) from public, anon, authenticated;

grant execute on function
  public.album_entrar(uuid, text, text),
  public.album_estado(uuid, text, uuid),
  public.album_registrar_foto(uuid, text, uuid, jsonb),
  public.album_remover_foto(uuid, text, uuid, uuid),
  public.album_votar(uuid, text, uuid, uuid, boolean),
  public.album_evento(uuid, text, uuid, jsonb),
  public.album_original(uuid, text, uuid, uuid, text, bigint),
  public.album_admin(uuid, text),
  public.album_admin_config(uuid, text, int, int),
  public.album_admin_fase(uuid, text, text, uuid[]),
  public.album_admin_forcar(uuid, text, uuid, text),
  public.album_admin_remover(uuid, text, uuid),
  public.album_pasta_valida(text)
to anon, authenticated;

notify pgrst, 'reload schema';
