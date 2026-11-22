-- Ejecuta todo este archivo en Supabase → SQL Editor → New query → Run

-- 1) Tablas
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  rol text not null check (rol in ('disenador', 'encargado')),
  nombre text
);

create table if not exists miniaturas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users,
  cliente text not null,
  titulo text not null,
  fecha date not null default current_date,
  minutos int,
  revisiones int,            -- opcional
  link_video text,           -- opcional
  notas text,                -- notas del diseñador (opcional)
  imagen_path text
);

create table if not exists pagos (
  miniatura_id uuid primary key references miniaturas on delete cascade,
  monto numeric(12,2),
  pagado boolean not null default false,
  fecha_pago date,
  nota text,                 -- nota del encargado (opcional)
  updated_at timestamptz not null default now()
);

-- 2) Función auxiliar: rol del usuario conectado
create or replace function mi_rol() returns text
language sql security definer stable set search_path = public as $$
  select rol from profiles where id = auth.uid()
$$;

-- 3) Seguridad por filas
alter table profiles enable row level security;
alter table miniaturas enable row level security;
alter table pagos enable row level security;

create policy "ver perfiles" on profiles for select to authenticated using (true);

create policy "ver miniaturas" on miniaturas for select to authenticated using (mi_rol() is not null);
create policy "disenador crea" on miniaturas for insert to authenticated with check (mi_rol() = 'disenador');
create policy "disenador edita" on miniaturas for update to authenticated using (mi_rol() = 'disenador');
create policy "disenador borra" on miniaturas for delete to authenticated using (mi_rol() = 'disenador');

create policy "ver pagos" on pagos for select to authenticated using (mi_rol() is not null);
create policy "encargado crea pago" on pagos for insert to authenticated with check (mi_rol() = 'encargado');
create policy "encargado edita pago" on pagos for update to authenticated using (mi_rol() = 'encargado');
create policy "encargado borra pago" on pagos for delete to authenticated using (mi_rol() = 'encargado');

-- 4) Almacenamiento de imágenes (bucket público de lectura, solo el diseñador sube)
insert into storage.buckets (id, name, public) values ('miniaturas', 'miniaturas', true)
on conflict (id) do nothing;

create policy "disenador sube imagenes" on storage.objects for insert to authenticated
  with check (bucket_id = 'miniaturas' and mi_rol() = 'disenador');
create policy "disenador cambia imagenes" on storage.objects for update to authenticated
  using (bucket_id = 'miniaturas' and mi_rol() = 'disenador');
create policy "disenador borra imagenes" on storage.objects for delete to authenticated
  using (bucket_id = 'miniaturas' and mi_rol() = 'disenador');

-- 5) DESPUÉS de crear los 2 usuarios (Authentication → Users → Add user),
--    asigna roles cambiando los correos y descomentando:
-- insert into profiles (id, rol, nombre)
--   select id, 'disenador', 'Tu nombre' from auth.users where email = 'tu-correo@ejemplo.com';
-- insert into profiles (id, rol, nombre)
--   select id, 'encargado', 'Nombre de tu amigo' from auth.users where email = 'correo-de-tu-amigo@ejemplo.com';
