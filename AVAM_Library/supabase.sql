-- A.V.A.M. Library — one-time Supabase setup
create extension if not exists pgcrypto;
-- Free tier is enough for a small student certificate lookup site.

create table if not exists public.admins (
  id integer primary key,
  password_hash text not null,
  password_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.certificates (
  id text primary key,
  status text not null check (status in ('Active','Suspended','Revoked')),
  mech_name text not null,
  owner text not null,
  faction text not null default '',
  date_issued date not null,
  pvp_types text not null default '',
  combat integer not null default 0 check (combat between 0 and 15),
  aesthetic integer not null default 0 check (aesthetic between 0 and 15),
  technical integer not null default 0 check (technical between 0 and 15),
  admin integer not null default 0 check (admin between 0 and 5),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.certificates enable row level security;

-- Keep an existing deployment in sync with the final 15/15/15/5 scoring model.
alter table public.certificates drop constraint if exists certificates_combat_check;
alter table public.certificates drop constraint if exists certificates_aesthetic_check;
alter table public.certificates drop constraint if exists certificates_technical_check;
alter table public.certificates drop constraint if exists certificates_admin_check;
alter table public.certificates add constraint certificates_combat_check check (combat between 0 and 15);
alter table public.certificates add constraint certificates_aesthetic_check check (aesthetic between 0 and 15);
alter table public.certificates add constraint certificates_technical_check check (technical between 0 and 15);
alter table public.certificates add constraint certificates_admin_check check (admin between 0 and 5);

-- No public policies: the website's server-side API uses the private service-role key.

-- Migrate any legacy sequential IDs to non-sequential random IDs.
-- Existing certificate records are preserved; only their public IDs change.
do $$
declare
  r record;
  new_id text;
begin
  for r in select id from public.certificates where id ~ '^AVAM-[0-9]{4}-[0-9]{4}$' loop
    loop
      new_id := 'AVAM-' || upper(encode(gen_random_bytes(6), 'hex'));
      exit when not exists (select 1 from public.certificates where id = new_id);
    end loop;
    update public.certificates set id = new_id, updated_at = now() where id = r.id;
  end loop;
end $$;


insert into public.admins (id, password_hash, password_version)
values (1, 'scrypt$W8r23p59nr4BwsxGI8uE-w$v6f_M2cCnt874bfmBtegsAV1JqPy2K-xBEHLzfV9DqoXNmWqm8O-8fxqwcdSrHtg_gkWBZk-bCUux7mfdYaC1A', 1)
on conflict (id) do nothing;

insert into public.certificates (id,status,mech_name,owner,faction,date_issued,pvp_types,combat,aesthetic,technical,admin,notes)
values
('AVAM-X7K4M9Q2R6TZ','Revoked','Halcyon Wake','R. Dune','Ninth Foundry','2025-11-20','1v1 Duel, Arena Free-for-All',12,7,9,2,'Mechanical compliance failures documented during review.'),
('AVAM-P3W8R6TZN5QH','Active','Iron Vesper','K. Ardent','Vanguard Alliance','2026-01-15','Squad Skirmish, Tactical Domination',14,9,12,4,''),
('AVAM-L9C4V7B2K8MX','Suspended','Grave Lantern','M. Solveig','','2026-02-07','1v1 Duel, Squad Skirmish',11,8,13,4,'Pending registrar review.')
on conflict (id) do nothing;
