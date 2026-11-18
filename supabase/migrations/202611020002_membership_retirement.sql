-- Local fixture migration only; no hosted rollout.
begin;
alter table public.relay_membership_consumers add column retired_at timestamptz;
create table public.relay_membership_retirement_audit (
 request_id uuid primary key, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.relay_membership_retirement_audit enable row level security;
revoke all on public.relay_membership_retirement_audit from public,anon,authenticated,service_role;
create or replace function public.relay_register_membership_consumer(p_id text) returns void language plpgsql security definer set search_path='' as $$
declare floor bigint;
begin
  select retained_through into floor from public.relay_membership_clock where id=true for update;
  if exists(select 1 from public.relay_membership_consumers where consumer_id=p_id and retired_at is not null) then raise exception 'CONSUMER_RETIRED'; end if;
  if exists(select 1 from public.relay_membership_consumers where consumer_id=p_id) then return; end if;
  if floor<>0 then raise exception 'BOOTSTRAP_REQUIRED'; end if;
  insert into public.relay_membership_consumers(consumer_id) values(p_id);
end $$;
create or replace function public.relay_ack_membership_consumer(p_id text,p_sequence bigint) returns void language plpgsql security definer set search_path='' as $$
declare top bigint; previous bigint;
begin
  select sequence into top from public.relay_membership_clock where id=true for update;
  select acknowledged into previous from public.relay_membership_consumers where consumer_id=p_id and retired_at is null for update;
  if previous is null then raise exception 'CONSUMER_NOT_REGISTERED'; end if;
  if p_sequence is null or p_sequence<0 or p_sequence>top then raise exception 'INVALID_WATERMARK'; end if;
  update public.relay_membership_consumers set acknowledged=greatest(acknowledged,p_sequence) where consumer_id=p_id;
end $$;
create or replace function public.relay_prune_membership_changes() returns bigint language plpgsql security definer set search_path='' as $$
declare floor bigint; top bigint; safe bigint; edge bigint; r record;
begin
  select retained_through,sequence into floor,top from public.relay_membership_clock where id=true for update;
  select min(acknowledged) into safe from public.relay_membership_consumers where retired_at is null;
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

create function public.relay_retire_membership_consumer(
 p_id text,p_replacement text,p_stream uuid,p_top bigint,p_floor bigint,p_ack bigint,
 p_operator uuid,p_reason text,p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; target record; replacement record; prior record; body jsonb; result jsonb;
begin
 if p_request is null or p_operator is null or p_reason is null or length(btrim(p_reason)) not between 10 and 500
    or p_id is null or p_replacement is null or p_id=p_replacement then raise exception 'INVALID_RETIREMENT'; end if;
 select * into c from public.relay_membership_clock where id=true for update;
 body:=jsonb_build_object('consumer',p_id,'replacement',p_replacement,'stream',p_stream,'top',p_top,'floor',p_floor,'ack',p_ack,'operator',p_operator,'reason',p_reason);
 select * into prior from public.relay_membership_retirement_audit where request_id=p_request;
 if found then
   if prior.request<>body then raise exception 'RETIREMENT_REQUEST_CONFLICT'; end if;
   return prior.result;
 end if;
 if c.stream_id is distinct from p_stream or c.sequence is distinct from p_top or c.retained_through is distinct from p_floor then raise exception 'STALE_RETIREMENT_REVIEW'; end if;
 select * into target from public.relay_membership_consumers where consumer_id=p_id for update;
 if not found or target.retired_at is not null or target.acknowledged is distinct from p_ack then raise exception 'STALE_RETIREMENT_REVIEW'; end if;
 select * into replacement from public.relay_membership_consumers where consumer_id=p_replacement for update;
 if not found or replacement.retired_at is not null or replacement.acknowledged<c.sequence then raise exception 'REPLACEMENT_NOT_CURRENT'; end if;
 update public.relay_membership_consumers set retired_at=clock_timestamp() where consumer_id=p_id;
 result:=jsonb_build_object('consumer',p_id,'replacement',p_replacement,'status','retired','stream',p_stream,'through',p_top);
 insert into public.relay_membership_retirement_audit(request_id,request,result) values(p_request,body,result);
 return result;
end $$;
revoke all on function public.relay_retire_membership_consumer(text,text,uuid,bigint,bigint,bigint,uuid,text,uuid) from public,anon,authenticated,service_role;
commit;
