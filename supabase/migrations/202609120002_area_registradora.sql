begin;

alter table public.fichas
  add column if not exists departamento_registro text;

alter table public.detenciones
  add column if not exists departamento_registro text;

update public.fichas f
set departamento_registro = p.departamento
from public.perfiles p
where p.id = f.creado_por and f.departamento_registro is null;

update public.detenciones d
set departamento_registro = p.departamento
from public.perfiles p
where p.id = d.creado_por and d.departamento_registro is null;

drop policy if exists "Usuarios activos consultan fichas de su unidad" on public.fichas;
drop policy if exists "Usuarios autorizados consultan fichas de su área" on public.fichas;
create policy "Usuarios autorizados consultan fichas de su área"
on public.fichas for select to authenticated
using (public.usuario_activo() and public.puede_acceder_unidad(unidad));

drop policy if exists "Usuarios activos crean fichas" on public.fichas;
drop policy if exists "Usuarios activos crean fichas de su área" on public.fichas;
create policy "Usuarios activos crean fichas de su área"
on public.fichas for insert to authenticated
with check (
  public.usuario_activo()
  and creado_por = auth.uid()
  and unidad = public.unidad_actual()
  and departamento_registro is not distinct from (
    select p.departamento from public.perfiles p where p.id = auth.uid() and p.activo = true
  )
);

drop policy if exists detenciones_creacion on public.detenciones;
create policy detenciones_creacion
on public.detenciones for insert to authenticated
with check (
  creado_por = auth.uid()
  and unidad = public.unidad_usuario_actual()
  and departamento_registro is not distinct from (
    select p.departamento from public.perfiles p where p.id = auth.uid() and p.activo = true
  )
);

commit;

select 'fichas' as tabla, count(*) as registros, count(departamento_registro) as con_departamento
from public.fichas
union all
select 'detenciones', count(*), count(departamento_registro)
from public.detenciones;
