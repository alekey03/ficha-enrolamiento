-- Estructura de catálogos protegidos. Los datos se cargan desde el SQL privado de instalación.

create table if not exists public.catalogos_protegidos (
  clave text primary key,
  contenido jsonb not null,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

alter table public.catalogos_protegidos enable row level security;

drop policy if exists catalogos_lectura_usuarios_activos on public.catalogos_protegidos;
create policy catalogos_lectura_usuarios_activos
on public.catalogos_protegidos
for select
to authenticated
using (
  activo = true
  and exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.activo = true
  )
);

revoke all on table public.catalogos_protegidos from anon;
revoke insert, update, delete on table public.catalogos_protegidos from authenticated;
grant select on table public.catalogos_protegidos to authenticated;

alter table public.detenciones add column if not exists rol_organizacion text;
alter table public.detenciones drop constraint if exists detenciones_rol_organizacion_check;
alter table public.detenciones add constraint detenciones_rol_organizacion_check
  check (rol_organizacion is null or rol_organizacion in ('Integrante', 'Cabecilla'));
