-- ============================================================
-- PARKIUM · 03_permisos.sql
-- Permisos de acceso + creación automática de perfil + tiempo real.
-- Ejecutar DESPUÉS de 01_schema.sql y 02_seed.sql.
-- ============================================================

-- 0) Corrección de la vista de estados.
--    La dejamos como vista "definer" para que el cálculo de
--    libre/reservada/ocupada sea correcto para TODOS los usuarios
--    (si fuera security_invoker, un usuario no vería las reservas de
--     otros y una plaza reservada le aparecería como libre).
--    La vista solo expone disponibilidad (sin datos personales).
alter view public.v_plazas_estado set (security_invoker = false);

-- 1) Privilegios para los roles del Data API
--    anon          = visitante sin login (solo puede mirar disponibilidad)
--    authenticated = usuario logueado (gestiona lo suyo; RLS filtra filas)
grant usage on schema public to anon, authenticated;

grant select on centros_comerciales to anon, authenticated;
grant select on niveles             to anon, authenticated;
grant select on plazas              to anon, authenticated;
grant select on v_plazas_estado     to anon, authenticated;

grant select, insert, update         on perfiles              to authenticated;
grant select, insert, update, delete on vehiculos             to authenticated;
grant select, insert, update         on reservas              to authenticated;
grant select, insert, update, delete on metodos_pago          to authenticated;
grant select, insert, update         on notificaciones        to authenticated;
grant select                         on pagos                 to authenticated;
grant select                         on centro_administradores to authenticated;

-- 2) Crear el perfil automáticamente al registrarse un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre',''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Habilitar tiempo real en las tablas que cambian la disponibilidad
--    (idempotente: no falla si ya estaban agregadas)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='plazas') then
    alter publication supabase_realtime add table public.plazas;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='reservas') then
    alter publication supabase_realtime add table public.reservas;
  end if;
end $$;
