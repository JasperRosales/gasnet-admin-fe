-- Rebuilt from the towngaz-portal schema (see schema.md).
-- Keys, defaults and RLS are inferred, not copied from the original.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  email text,
  full_name text,
  address text,
  contact_number text,
  role text not null default 'customer'
    check (role in ('admin','manager','staff','customer')),
  status text not null default 'pending'
    check (status in ('pending','approved')),
  branch smallint,
  customer_type text
);

create table public.lpg_prices (
  size text primary key,
  price numeric(12,2) not null default 0,
  sort_order smallint not null default 0,
  low_stock_level integer not null default 10
);

create table public.branch_prices (
  branch smallint not null,
  size text not null references public.lpg_prices(size)
    on update cascade on delete cascade,
  price numeric(12,2) not null default 0,
  primary key (branch, size)
);

create table public.stock (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  branch smallint not null,
  item_name text not null,
  quantity integer not null default 0,
  price numeric(12,2),
  unique (branch, item_name)
);

create table public.customer_profiles (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  branch smallint,
  full_name text not null,
  address text,
  contact text
);

create table public.orders (
  id bigint generated always as identity primary key,
  group_id uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  branch smallint not null,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_address text,
  customer_contact text,
  customer_type text,
  item_name text not null,
  quantity integer not null default 1,
  unit_price numeric(12,2),
  discount numeric(12,2) not null default 0,
  total_price numeric(12,2),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected')),
  source text,
  delivery_status text default 'not_started',
  utang_status text,
  paid_gcash boolean not null default false,
  other_income text,
  other_income_gcash boolean not null default false,
  borrowed_tank boolean not null default false,
  borrowed_qty integer not null default 0,
  remarks text
);
create index orders_branch_status_idx on public.orders (branch, status);
create index orders_accepted_at_idx on public.orders (accepted_at);

create table public.tank_returns (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  branch smallint not null,
  size text,
  quantity integer not null,
  returned_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);

create table public.daily_entries (
  day date not null,
  branch smallint not null,
  key text not null,
  amount numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (day, branch, key)
);

create table public.monthly_entries (
  month date not null,
  branch smallint not null,
  key text not null,
  amount numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (month, branch, key)
);

create table public.inventory_remarks (
  day date not null,
  branch smallint not null,
  remarks text,
  primary key (day, branch)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  actor_role text,
  branch integer,
  action text,
  table_name text,
  changed_columns text[],
  old_data jsonb,
  new_data jsonb
);

-- New sign-ups get a profile row from their metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, address, contact_number, role, branch)
  values (
    new.id, new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'contact_number',
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    nullif(new.raw_user_meta_data->>'branch', '')::smallint
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Approved admin/manager/staff can use the portal.
create function public.is_portal_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
      and role in ('admin','manager','staff'));
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.lpg_prices enable row level security;
alter table public.branch_prices enable row level security;
alter table public.stock enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.orders enable row level security;
alter table public.tank_returns enable row level security;
alter table public.daily_entries enable row level security;
alter table public.monthly_entries enable row level security;
alter table public.inventory_remarks enable row level security;
alter table public.audit_log enable row level security;

create policy "prices readable" on public.lpg_prices for select using (true);
create policy "branch prices readable" on public.branch_prices for select using (true);
create policy "own profile" on public.profiles for select using (id = auth.uid());

create policy "portal" on public.profiles for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.lpg_prices for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.branch_prices for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.stock for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.customer_profiles for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.orders for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.tank_returns for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.daily_entries for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.monthly_entries for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal" on public.inventory_remarks for all using (public.is_portal_user()) with check (public.is_portal_user());
create policy "portal read" on public.audit_log for select using (public.is_portal_user());
