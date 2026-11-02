-- Prepared migration; local fixtures only until a separate hosted rollout.
begin;
alter table public.relay_membership_clock add column retained_through bigint not null default 0;
alter table public.relay_membership_clock add column stream_id uuid not null default gen_random_uuid();
create table public.relay_membership_consumers (
  consumer_id text primary key check(consumer_id ~ '^[a-z0-9_-]{1,64}$'),
  acknowledged bigint not null default 0 check(acknowledged>=0)
);
alter table public.relay_membership_consumers enable row level security;
revoke all on public.relay_membership_consumers from public,anon,authenticated,service_role;
create function public.relay_register_membership_consumer(p_id text) returns void language plpgsql security definer set search_path='' as $$
declare floor bigint;
begin
  select retained_through into floor from public.relay_membership_clock where id=true for update;
  if exists(select 1 from public.relay_membership_consumers where consumer_id=p_id) then return; end if;
  if floor<>0 then raise exception 'BOOTSTRAP_REQUIRED'; end if;
  insert into public.relay_membership_consumers(consumer_id) values(p_id);
end $$;
create function public.relay_ack_membership_consumer(p_id text,p_sequence bigint) returns void language plpgsql security definer set search_path='' as $$
declare top bigint; previous bigint;
begin
  select sequence into top from public.relay_membership_clock where id=true for update;
  select acknowledged into previous from public.relay_membership_consumers where consumer_id=p_id for update;
  if previous is null then raise exception 'CONSUMER_NOT_REGISTERED'; end if;
  if p_sequence is null or p_sequence<0 or p_sequence>top then raise exception 'INVALID_WATERMARK'; end if;
  update public.relay_membership_consumers set acknowledged=greatest(acknowledged,p_sequence) where consumer_id=p_id;
end $$;
create function public.relay_prune_membership_changes() returns bigint language plpgsql security definer set search_path='' as $$
declare floor bigint; top bigint; safe bigint; edge bigint; r record;
begin
  select retained_through,sequence into floor,top from public.relay_membership_clock where id=true for update;
  select min(acknowledged) into safe from public.relay_membership_consumers;
  if safe is null then return 0; end if;
  edge:=floor;
  -- Only contiguous, acknowledged, old prefixes; keep at least 100 latest changes.
  for r in select sequence,created_at from public.relay_membership_changes where sequence>floor order by sequence limit 100 loop
    exit when r.sequence<>edge+1 or r.sequence>safe or r.sequence>top-100 or r.created_at>=clock_timestamp()-interval '30 days';
    edge:=r.sequence;
  end loop;
  delete from public.relay_membership_changes where sequence>floor and sequence<=edge;
  update public.relay_membership_clock set retained_through=edge where id=true;
  return edge-floor;
end $$;
revoke all on function public.relay_register_membership_consumer(text),public.relay_ack_membership_consumer(text,bigint),public.relay_prune_membership_changes() from public,anon,authenticated,service_role;
-- Trusted adapter can acknowledge; registration and pruning stay operator-only.
grant execute on function public.relay_ack_membership_consumer(text,bigint) to service_role;
commit;
