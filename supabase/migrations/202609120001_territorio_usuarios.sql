begin;

alter table public.perfiles
  add column if not exists departamento text;

update public.perfiles
set departamento = 'NACIONAL'
where rol = 'administrador' and departamento is null;

comment on column public.perfiles.departamento is
  'Departamento territorial asignado al usuario; NACIONAL para administradores generales.';

commit;

select usuario, rol, departamento, unidad
from public.perfiles
order by rol, usuario;
