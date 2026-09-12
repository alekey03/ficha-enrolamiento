begin;

alter table public.perfiles
  add column if not exists ambito text;

update public.perfiles
set ambito = case
  when rol = 'administrador' then 'NACIONAL'
  when departamento = 'LIMA' then 'SEDE_CENTRAL'
  else 'DESCONCENTRADO'
end
where ambito is null;

update public.perfiles
set departamento = 'NACIONAL',
    unidad = 'ADMINISTRACIÓN GENERAL DIRITPTIM',
    ambito = 'NACIONAL'
where rol = 'administrador';

update public.perfiles
set unidad = 'SEDE CENTRAL DIRITPTIM',
    ambito = 'SEDE_CENTRAL'
where rol <> 'administrador'
  and departamento = 'LIMA'
  and unidad = 'MEJIA';

alter table public.perfiles
  drop constraint if exists perfiles_ambito_check;

alter table public.perfiles
  add constraint perfiles_ambito_check
  check (ambito in ('NACIONAL', 'SEDE_CENTRAL', 'DESCONCENTRADO'));

-- Jerarquía de lectura:
-- administrador = todo el país;
-- supervisor de sede central = todas las dependencias de sede central;
-- demás usuarios = solamente su propia dependencia.
create or replace function public.puede_acceder_unidad(unidad_registro text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.perfiles actual
    where actual.id = auth.uid()
      and actual.activo = true
      and (
        actual.rol = 'administrador'
        or actual.unidad = unidad_registro
        or (
          actual.rol = 'supervisor'
          and actual.ambito = 'SEDE_CENTRAL'
          and exists (
            select 1
            from public.perfiles dependencia
            where dependencia.ambito = 'SEDE_CENTRAL'
              and dependencia.unidad = unidad_registro
          )
        )
      )
  )
$$;

revoke all on function public.puede_acceder_unidad(text) from public;
grant execute on function public.puede_acceder_unidad(text) to authenticated;

commit;

select usuario, rol, ambito, departamento, unidad
from public.perfiles
order by rol, usuario;
