-- Prepared for managed provider schema; apply only to disposable localhost fixtures for now.
begin;
lock table public.relay_memberships, public.relay_tenants in share row exclusive mode;
alter table public.relay_tenants add column company boolean not null default false;
create table public.relay_membership_clock (id boolean primary key default true check(id), sequence bigint not null);
insert into public.relay_membership_clock values (true,0);
create table public.relay_membership_versions (user_id uuid primary key, revision bigint not null);
create table public.relay_membership_changes (
  sequence bigint primary key, event_id uuid not null unique default gen_random_uuid(),
  user_id uuid not null, revision bigint not null, memberships jsonb not null,
  created_at timestamptz not null default clock_timestamp(), unique(user_id,revision)
);
-- Transactional counter, not a sequence: rollback creates no gaps and commit order cannot overtake the cursor.
create function public.relay_lock_membership_stream() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='TRUNCATE' then raise exception 'MEMBERSHIP_TRUNCATE_FORBIDDEN'; end if;
  update public.relay_membership_clock set sequence=sequence where id=true;
  return null;
end $$;
create function public.relay_capture_membership(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare n bigint; v bigint; m jsonb;
begin
  update public.relay_membership_clock set sequence=sequence+1 where id=true returning sequence into n;
  insert into public.relay_membership_versions values (p_user,1)
    on conflict(user_id) do update set revision=public.relay_membership_versions.revision+1 returning revision into v;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'role',r.role,'company',t.company) order by t.id),'[]'::jsonb)
    into m from public.relay_memberships r join public.relay_tenants t on t.id=r.tenant_id where r.user_id=p_user;
  insert into public.relay_membership_changes(sequence,user_id,revision,memberships) values(n,p_user,v,m);
end $$;
create function public.relay_membership_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' and old.user_id<>new.user_id then perform public.relay_capture_membership(old.user_id); end if;
  if TG_OP='DELETE' then perform public.relay_capture_membership(old.user_id);
  else perform public.relay_capture_membership(new.user_id); end if;
  return null;
end $$;
create function public.relay_company_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  if old.company is distinct from new.company then
    for u in select user_id from public.relay_memberships where tenant_id=new.id order by user_id loop
      perform public.relay_capture_membership(u);
    end loop;
  end if;
  return null;
end $$;
create trigger relay_membership_lock before insert or update or delete on public.relay_memberships for each statement execute function public.relay_lock_membership_stream();
create trigger relay_membership_capture after insert or update or delete on public.relay_memberships for each row execute function public.relay_membership_changed();
create trigger relay_company_lock before update or delete on public.relay_tenants for each statement execute function public.relay_lock_membership_stream();
create trigger relay_company_capture after update of company on public.relay_tenants for each row execute function public.relay_company_changed();
create trigger relay_membership_no_truncate before truncate on public.relay_memberships for each statement execute function public.relay_lock_membership_stream();
create trigger relay_tenant_no_truncate before truncate on public.relay_tenants for each statement execute function public.relay_lock_membership_stream();
-- Initial complete snapshots are recorded while writes are locked, before incremental events.
do $$ declare u uuid; begin
  for u in select distinct user_id from public.relay_memberships order by user_id loop
    perform public.relay_capture_membership(u);
  end loop;
end $$;
alter table public.relay_membership_clock enable row level security;
alter table public.relay_membership_versions enable row level security;
alter table public.relay_membership_changes enable row level security;
revoke all on public.relay_membership_clock,public.relay_membership_versions,public.relay_membership_changes from public,anon,authenticated,service_role;
grant select on public.relay_membership_changes,public.relay_membership_clock to service_role;
create policy relay_change_reader on public.relay_membership_changes for select to service_role using(true);
create policy relay_clock_reader on public.relay_membership_clock for select to service_role using(true);
revoke all on function public.relay_lock_membership_stream(),public.relay_capture_membership(uuid),public.relay_membership_changed(),public.relay_company_changed() from public,anon,authenticated,service_role;
commit;
