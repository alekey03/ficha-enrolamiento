-- Modulo de detenidos: estructura normalizada, RLS e indices.
-- No modifica las tablas existentes de victimas (fichas/archivos).

create extension if not exists pg_trgm;

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  apellido_paterno text not null,
  apellido_materno text,
  nombres text not null,
  edad smallint check (edad between 0 and 120),
  genero text,
  nacionalidad text,
  tipo_documento text,
  numero_documento text,
  departamento text,
  provincia text,
  distrito text,
  creado_por uuid not null references public.perfiles(id),
  unidad text not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index if not exists personas_documento_unico
  on public.personas (upper(tipo_documento), upper(numero_documento))
  where numero_documento is not null and btrim(numero_documento) <> '';
create index if not exists personas_nombres_busqueda
  on public.personas using gin ((apellido_paterno || ' ' || coalesce(apellido_materno, '') || ' ' || nombres) gin_trgm_ops);
create index if not exists personas_unidad_idx on public.personas (unidad);

create table if not exists public.operativos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  lugar text,
  unidad text not null,
  estado text not null default 'activo' check (estado in ('planificado','activo','cerrado','cancelado')),
  creado_por uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists operativos_fecha_idx on public.operativos (fecha_inicio desc);
create index if not exists operativos_unidad_idx on public.operativos (unidad, estado);

create sequence if not exists public.detenciones_codigo_seq;

create table if not exists public.detenciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('DET-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.detenciones_codigo_seq')::text, 6, '0')),
  persona_id uuid not null references public.personas(id) on delete restrict,
  operativo_id uuid references public.operativos(id) on delete set null,
  fecha date not null,
  hora time,
  es_funcionario_publico boolean not null default false,
  entidad_publica text,
  detalle_entidad_publica text,
  motivo_detencion text,
  direccion_policial text,
  direccion_especializada_region text,
  division_policial text,
  departamento_policial text,
  unidad_area_equipo text,
  integra_organizacion boolean not null default false,
  nombre_organizacion text,
  situacion_actual text,
  documento_libertad text,
  documento_disposicion text,
  fiscal_nombre text,
  fiscalia text,
  disposicion_direccion text,
  disposicion_region text,
  disposicion_division text,
  disposicion_departamento text,
  disposicion_unidad text,
  nota_sicpip text,
  unidad text not null,
  creado_por uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists detenciones_persona_idx on public.detenciones (persona_id);
create index if not exists detenciones_fecha_idx on public.detenciones (fecha desc);
create index if not exists detenciones_unidad_fecha_idx on public.detenciones (unidad, fecha desc);
create index if not exists detenciones_situacion_idx on public.detenciones (situacion_actual);
create index if not exists detenciones_operativo_idx on public.detenciones (operativo_id) where operativo_id is not null;

create table if not exists public.detencion_delitos (
  id uuid primary key default gen_random_uuid(),
  detencion_id uuid not null references public.detenciones(id) on delete cascade,
  orden smallint not null default 1 check (orden > 0),
  es_tentativa boolean not null default false,
  fuero_ley_especial text,
  delito_general text,
  delito_especifico text,
  subtipo text,
  creado_en timestamptz not null default now(),
  unique (detencion_id, orden)
);
create index if not exists detencion_delitos_detencion_idx on public.detencion_delitos (detencion_id);
create index if not exists detencion_delitos_clasificacion_idx on public.detencion_delitos (delito_general, delito_especifico);
create index if not exists detencion_delitos_texto_idx on public.detencion_delitos using gin ((coalesce(delito_general,'') || ' ' || coalesce(delito_especifico,'') || ' ' || coalesce(subtipo,'')) gin_trgm_ops);

create table if not exists public.detencion_armas (
  id uuid primary key default gen_random_uuid(),
  detencion_id uuid not null references public.detenciones(id) on delete cascade,
  categoria text not null,
  tipo text,
  cantidad smallint not null default 1 check (cantidad > 0),
  observacion text,
  creado_en timestamptz not null default now()
);
create index if not exists detencion_armas_detencion_idx on public.detencion_armas (detencion_id);

create table if not exists public.detencion_archivos (
  id uuid primary key default gen_random_uuid(),
  detencion_id uuid not null references public.detenciones(id) on delete cascade,
  tipo text not null check (tipo in ('foto_principal','tatuaje','documento','otro')),
  ruta_privada text not null unique,
  creado_por uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now()
);
create index if not exists detencion_archivos_detencion_idx on public.detencion_archivos (detencion_id, tipo);

create or replace function public.unidad_usuario_actual()
returns text language sql stable security definer set search_path = public
as $$ select unidad from public.perfiles where id = auth.uid() and activo = true $$;

create or replace function public.puede_acceder_unidad(unidad_registro text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.es_administrador()
      or exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo = true and p.unidad = unidad_registro)
$$;

alter table public.personas enable row level security;
alter table public.operativos enable row level security;
alter table public.detenciones enable row level security;
alter table public.detencion_delitos enable row level security;
alter table public.detencion_armas enable row level security;
alter table public.detencion_archivos enable row level security;

drop policy if exists personas_lectura on public.personas;
create policy personas_lectura on public.personas for select to authenticated using (public.puede_acceder_unidad(unidad));
drop policy if exists personas_creacion on public.personas;
create policy personas_creacion on public.personas for insert to authenticated with check (creado_por = auth.uid() and public.puede_acceder_unidad(unidad));
drop policy if exists personas_edicion on public.personas;
create policy personas_edicion on public.personas for update to authenticated using (public.puede_acceder_unidad(unidad)) with check (public.puede_acceder_unidad(unidad));

drop policy if exists operativos_acceso on public.operativos;
create policy operativos_acceso on public.operativos for select to authenticated using (public.puede_acceder_unidad(unidad));
drop policy if exists operativos_creacion on public.operativos;
create policy operativos_creacion on public.operativos for insert to authenticated with check (creado_por = auth.uid() and public.puede_acceder_unidad(unidad));
drop policy if exists operativos_edicion on public.operativos;
create policy operativos_edicion on public.operativos for update to authenticated using (public.puede_acceder_unidad(unidad)) with check (public.puede_acceder_unidad(unidad));

drop policy if exists detenciones_lectura on public.detenciones;
create policy detenciones_lectura on public.detenciones for select to authenticated using (public.puede_acceder_unidad(unidad));
drop policy if exists detenciones_creacion on public.detenciones;
create policy detenciones_creacion on public.detenciones for insert to authenticated with check (creado_por = auth.uid() and public.puede_acceder_unidad(unidad));
drop policy if exists detenciones_edicion on public.detenciones;
create policy detenciones_edicion on public.detenciones for update to authenticated using (public.puede_acceder_unidad(unidad)) with check (public.puede_acceder_unidad(unidad));
drop policy if exists detenciones_eliminacion on public.detenciones;
create policy detenciones_eliminacion on public.detenciones for delete to authenticated using (public.es_administrador());

drop policy if exists detencion_delitos_acceso on public.detencion_delitos;
create policy detencion_delitos_acceso on public.detencion_delitos for all to authenticated
using (exists (select 1 from public.detenciones d where d.id = detencion_id and public.puede_acceder_unidad(d.unidad)))
with check (exists (select 1 from public.detenciones d where d.id = detencion_id and public.puede_acceder_unidad(d.unidad)));
drop policy if exists detencion_armas_acceso on public.detencion_armas;
create policy detencion_armas_acceso on public.detencion_armas for all to authenticated
using (exists (select 1 from public.detenciones d where d.id = detencion_id and public.puede_acceder_unidad(d.unidad)))
with check (exists (select 1 from public.detenciones d where d.id = detencion_id and public.puede_acceder_unidad(d.unidad)));
drop policy if exists detencion_archivos_acceso on public.detencion_archivos;
create policy detencion_archivos_acceso on public.detencion_archivos for all to authenticated
using (exists (select 1 from public.detenciones d where d.id = detencion_id and public.puede_acceder_unidad(d.unidad)))
with check (creado_por = auth.uid() and exists (select 1 from public.detenciones d where d.id = detencion_id and public.puede_acceder_unidad(d.unidad)));

grant select, insert, update on public.personas, public.operativos, public.detenciones to authenticated;
grant delete on public.detenciones to authenticated;
grant select, insert, update, delete on public.detencion_delitos, public.detencion_armas, public.detencion_archivos to authenticated;
grant usage, select on sequence public.detenciones_codigo_seq to authenticated;
