-- =====================================================================
-- Consultorio Dr. Juan David Sánchez — Esquema v1
-- Ejecutar completo en Supabase > SQL Editor (proyecto NUEVO)
-- Módulos: usuarios/roles, pacientes, agenda, historia clínica, pagos
-- =====================================================================

-- ---------- Tipos ----------
create type public.rol_usuario as enum ('admin', 'odontologo', 'asistente');
create type public.estado_cita as enum ('pendiente', 'confirmada', 'reprogramar', 'cancelada', 'atendida', 'no_asistio');
create type public.metodo_pago as enum ('efectivo', 'nequi', 'transferencia', 'tarjeta', 'otro');
create type public.tipo_nota as enum ('evolucion', 'aclaracion');

-- ---------- Perfiles (usuarios del sistema) ----------
create table public.perfiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null default '',
  email       text not null default '',
  rol         public.rol_usuario not null default 'asistente',
  activo      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- Funciones auxiliares (esquema privado, no expuesto en la API) ----------
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.rol_actual()
returns public.rol_usuario
language sql stable security definer set search_path = ''
as $$
  select p.rol from public.perfiles p
  where p.id = (select auth.uid()) and p.activo
$$;

create or replace function private.es_activo()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.perfiles p where p.id = (select auth.uid()) and p.activo)
$$;

create or replace function private.es_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.rol_actual() = 'admin', false) $$;

create or replace function private.es_clinico()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.rol_actual() in ('admin', 'odontologo'), false) $$;

grant execute on all functions in schema private to authenticated;

-- Crea el perfil al registrarse. El PRIMER usuario queda como admin activo;
-- los demás quedan pendientes hasta que el admin los active.
create or replace function private.nuevo_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare primero boolean;
begin
  select not exists (select 1 from public.perfiles) into primero;
  insert into public.perfiles (id, nombre, email, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    coalesce(new.email, ''),
    case when primero then 'admin'::public.rol_usuario else 'asistente'::public.rol_usuario end,
    primero
  );
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function private.nuevo_usuario();

-- ---------- Pacientes ----------
create table public.pacientes (
  id                   uuid primary key default gen_random_uuid(),
  nombres              text not null,
  apellidos            text not null default '',
  tipo_documento       text not null default 'CC',
  documento            text,
  fecha_nacimiento     date,
  sexo                 text,
  telefono             text,          -- WhatsApp, con indicativo (57...)
  email                text,
  direccion            text,
  ocupacion            text,
  eps                  text,
  contacto_emergencia  text,
  telefono_emergencia  text,
  autoriza_datos       boolean not null default false,  -- Ley 1581 de 2012
  fecha_autorizacion   timestamptz,
  notas                text,
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.perfiles (id) default auth.uid()
);
create unique index pacientes_documento_uk on public.pacientes (tipo_documento, documento) where documento is not null;
create index pacientes_nombre_idx on public.pacientes (lower(nombres || ' ' || apellidos));
create index pacientes_created_by_idx on public.pacientes (created_by);

-- ---------- Procedimientos (catálogo y precios) ----------
create table public.procedimientos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  precio_base  numeric(12, 0) not null default 0,
  duracion_min integer not null default 30,
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- Citas ----------
create table public.citas (
  id                      uuid primary key default gen_random_uuid(),
  paciente_id             uuid not null references public.pacientes (id) on delete restrict,
  profesional_id          uuid references public.perfiles (id),
  procedimiento_id        uuid references public.procedimientos (id),
  inicio                  timestamptz not null,
  fin                     timestamptz not null,
  motivo                  text,
  estado                  public.estado_cita not null default 'pendiente',
  notas                   text,
  recordatorio_enviado_at timestamptz,   -- para la integración con WhatsApp
  respuesta_paciente_at   timestamptz,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.perfiles (id) default auth.uid(),
  constraint citas_rango_ck check (fin > inicio)
);
create index citas_inicio_idx on public.citas (inicio);
create index citas_paciente_idx on public.citas (paciente_id);
create index citas_profesional_idx on public.citas (profesional_id);
create index citas_procedimiento_idx on public.citas (procedimiento_id);
create index citas_created_by_idx on public.citas (created_by);

-- ---------- Historia clínica ----------
-- Anamnesis: una por paciente, se puede actualizar.
create table public.anamnesis (
  paciente_id                 uuid primary key references public.pacientes (id) on delete restrict,
  alergias                    text,
  medicamentos                text,
  antecedentes_medicos        text,
  antecedentes_odontologicos  text,
  habitos                     text,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.perfiles (id) default auth.uid()
);
create index anamnesis_updated_by_idx on public.anamnesis (updated_by);

-- Evoluciones: NO se editan ni se borran (Res. 1995/1999).
-- Para corregir, se agrega una nota de tipo 'aclaracion' que referencia la original.
create table public.evoluciones (
  id                uuid primary key default gen_random_uuid(),
  paciente_id       uuid not null references public.pacientes (id) on delete restrict,
  cita_id           uuid references public.citas (id),
  tipo              public.tipo_nota not null default 'evolucion',
  referencia_id     uuid references public.evoluciones (id),
  motivo_consulta   text,
  hallazgos         text,
  diagnostico       text,
  procedimiento     text,
  plan_tratamiento  text,
  profesional_id    uuid not null references public.perfiles (id) default auth.uid(),
  created_at        timestamptz not null default now()
);
create index evoluciones_paciente_idx on public.evoluciones (paciente_id, created_at desc);
create index evoluciones_cita_idx on public.evoluciones (cita_id);
create index evoluciones_ref_idx on public.evoluciones (referencia_id);
create index evoluciones_prof_idx on public.evoluciones (profesional_id);

-- ---------- Pagos ----------
create table public.cargos (
  id               uuid primary key default gen_random_uuid(),
  paciente_id      uuid not null references public.pacientes (id) on delete restrict,
  procedimiento_id uuid references public.procedimientos (id),
  cita_id          uuid references public.citas (id),
  descripcion      text not null,
  valor            numeric(12, 0) not null check (valor >= 0),
  fecha            date not null default (now() at time zone 'America/Bogota')::date,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.perfiles (id) default auth.uid()
);
create index cargos_paciente_idx on public.cargos (paciente_id);
create index cargos_proc_idx on public.cargos (procedimiento_id);
create index cargos_cita_idx on public.cargos (cita_id);
create index cargos_created_by_idx on public.cargos (created_by);
create index cargos_fecha_idx on public.cargos (fecha);

create table public.abonos (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references public.pacientes (id) on delete restrict,
  valor        numeric(12, 0) not null check (valor > 0),
  metodo       public.metodo_pago not null default 'efectivo',
  fecha        date not null default (now() at time zone 'America/Bogota')::date,
  nota         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.perfiles (id) default auth.uid()
);
create index abonos_paciente_idx on public.abonos (paciente_id);
create index abonos_created_by_idx on public.abonos (created_by);
create index abonos_fecha_idx on public.abonos (fecha);

-- Saldo por paciente (respeta RLS de quien consulta)
create view public.saldos_pacientes with (security_invoker = true) as
select p.id as paciente_id,
       p.nombres, p.apellidos, p.telefono,
       coalesce(c.total, 0) as total_cargos,
       coalesce(a.total, 0) as total_abonos,
       coalesce(c.total, 0) - coalesce(a.total, 0) as saldo
from public.pacientes p
left join (select paciente_id, sum(valor) total from public.cargos group by paciente_id) c on c.paciente_id = p.id
left join (select paciente_id, sum(valor) total from public.abonos group by paciente_id) a on a.paciente_id = p.id;

-- =====================================================================
-- Seguridad (RLS)
--  admin      → todo, incluido usuarios y precios
--  odontologo → todo menos usuarios y precios
--  asistente  → agenda, pacientes y pagos; NO ve historia clínica
-- =====================================================================
alter table public.perfiles      enable row level security;
alter table public.pacientes     enable row level security;
alter table public.procedimientos enable row level security;
alter table public.citas         enable row level security;
alter table public.anamnesis     enable row level security;
alter table public.evoluciones   enable row level security;
alter table public.cargos        enable row level security;
alter table public.abonos        enable row level security;

-- Perfiles
create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select private.es_activo()));
create policy perfiles_admin_editar on public.perfiles for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));

-- Pacientes
create policy pacientes_ver on public.pacientes for select to authenticated using ((select private.es_activo()));
create policy pacientes_crear on public.pacientes for insert to authenticated with check ((select private.es_activo()));
create policy pacientes_editar on public.pacientes for update to authenticated using ((select private.es_activo())) with check ((select private.es_activo()));

-- Procedimientos
create policy proc_ver on public.procedimientos for select to authenticated using ((select private.es_activo()));
create policy proc_crear on public.procedimientos for insert to authenticated with check ((select private.es_admin()));
create policy proc_editar on public.procedimientos for update to authenticated using ((select private.es_admin())) with check ((select private.es_admin()));

-- Citas
create policy citas_ver on public.citas for select to authenticated using ((select private.es_activo()));
create policy citas_crear on public.citas for insert to authenticated with check ((select private.es_activo()));
create policy citas_editar on public.citas for update to authenticated using ((select private.es_activo())) with check ((select private.es_activo()));
create policy citas_borrar on public.citas for delete to authenticated using ((select private.es_admin()));

-- Historia clínica: solo admin y odontólogo
create policy anam_ver on public.anamnesis for select to authenticated using ((select private.es_clinico()));
create policy anam_crear on public.anamnesis for insert to authenticated with check ((select private.es_clinico()));
create policy anam_editar on public.anamnesis for update to authenticated using ((select private.es_clinico())) with check ((select private.es_clinico()));

create policy evol_ver on public.evoluciones for select to authenticated using ((select private.es_clinico()));
create policy evol_crear on public.evoluciones for insert to authenticated
  with check ((select private.es_clinico()) and profesional_id = (select auth.uid()));
-- (sin políticas de update/delete: las evoluciones son inmodificables)

-- Pagos
create policy cargos_ver on public.cargos for select to authenticated using ((select private.es_activo()));
create policy cargos_crear on public.cargos for insert to authenticated with check ((select private.es_activo()));
create policy cargos_borrar on public.cargos for delete to authenticated using ((select private.es_admin()));

create policy abonos_ver on public.abonos for select to authenticated using ((select private.es_activo()));
create policy abonos_crear on public.abonos for insert to authenticated with check ((select private.es_activo()));
create policy abonos_borrar on public.abonos for delete to authenticated using ((select private.es_admin()));

-- ---------- Procedimientos de ejemplo (edita precios desde el sistema) ----------
insert into public.procedimientos (nombre, precio_base, duracion_min) values
  ('Valoración', 0, 30),
  ('Exodoncia simple', 0, 45),
  ('Exodoncia de cordal', 0, 60),
  ('Control postoperatorio', 0, 20),
  ('Biopsia', 0, 45);
