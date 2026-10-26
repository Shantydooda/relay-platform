-- Dedicated staging project only. No prototype identities or data are imported.
begin;

create table public.relay_invites (
  email text primary key check (email = lower(btrim(email))),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.relay_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  workspace text not null check (workspace in ('buyer','builder')),
  created_at timestamptz not null default now()
);
create table public.relay_tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.relay_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.relay_tenants(id) on delete cascade,
  role text not null check (role in ('owner','employee','approver')),
  primary key (user_id,tenant_id)
);
create table public.relay_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.relay_tenants(id),
  created_by uuid not null references auth.users(id),
  title text not null check (length(btrim(title)) between 1 and 120),
  brief text not null check (length(btrim(brief)) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index relay_tasks_tenant_time on public.relay_tasks(tenant_id,updated_at desc,id);
create table public.relay_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.relay_tasks(id),
  author_id uuid not null references auth.users(id),
  author_name text not null,
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  sequence bigint generated always as identity
);
create index relay_messages_task_sequence on public.relay_messages(task_id,sequence);
create table public.relay_events (
  sequence bigint generated always as identity primary key,
  task_id uuid not null references public.relay_tasks(id),
  actor_id uuid not null references auth.users(id),
  type text not null,
  version integer not null,
  created_at timestamptz not null default now()
);
create index relay_events_task_sequence on public.relay_events(task_id,sequence);
create table public.relay_idempotency (
  user_id uuid not null references auth.users(id),
  key text not null,
  command text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id,key)
);
-- Only the BFF's server credential may read/write session verifiers. Provider
-- access tokens are AES-GCM encrypted before insertion. No refresh tokens stored.
create table public.relay_sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  csrf text not null,
  encrypted_access_token text not null,
  scope text not null check (scope in ('app','recovery')),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index relay_sessions_user on public.relay_sessions(user_id);
create table public.relay_auth_limits (
  key text primary key,
  attempts integer not null,
  reset_at timestamptz not null
);

-- Eligibility consults current provider-owned identity + current invite record,
-- not user-editable metadata, a stale custom JWT claim or a UI preference.
create function public.relay_eligible() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join public.relay_invites i on i.email=lower(u.email) and i.active
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=(select auth.jwt()->>'session_id'))
  );
$$;
revoke all on function public.relay_eligible() from public,anon;
grant execute on function public.relay_eligible() to authenticated;

alter table public.relay_invites enable row level security;
alter table public.relay_profiles enable row level security;
alter table public.relay_tenants enable row level security;
alter table public.relay_memberships enable row level security;
alter table public.relay_tasks enable row level security;
alter table public.relay_messages enable row level security;
alter table public.relay_events enable row level security;
alter table public.relay_idempotency enable row level security;
alter table public.relay_sessions enable row level security;
alter table public.relay_auth_limits enable row level security;

revoke all on public.relay_invites,public.relay_profiles,public.relay_tenants,
  public.relay_memberships,public.relay_tasks,public.relay_messages,
  public.relay_events,public.relay_idempotency,public.relay_sessions,
  public.relay_auth_limits from public,anon,authenticated;
grant all on public.relay_invites,public.relay_profiles,public.relay_tenants,
  public.relay_memberships,public.relay_tasks,public.relay_messages,
  public.relay_events,public.relay_idempotency,public.relay_sessions,
  public.relay_auth_limits to service_role;
grant select on public.relay_profiles,public.relay_tenants,public.relay_memberships,
  public.relay_tasks,public.relay_messages,public.relay_events to authenticated;

create policy relay_own_profile on public.relay_profiles for select to authenticated
  using (user_id=(select auth.uid()) and (select public.relay_eligible()));
create policy relay_own_tenant on public.relay_tenants for select to authenticated
  using (owner_id=(select auth.uid()) and (select public.relay_eligible()));
create policy relay_own_memberships on public.relay_memberships for select to authenticated
  using (user_id=(select auth.uid()) and (select public.relay_eligible()));
create policy relay_personal_tasks on public.relay_tasks for select to authenticated
  using (created_by=(select auth.uid()) and (select public.relay_eligible()) and exists (
    select 1 from public.relay_memberships m where m.tenant_id=relay_tasks.tenant_id and m.user_id=(select auth.uid())
  ));
create policy relay_task_messages on public.relay_messages for select to authenticated
  using (exists(select 1 from public.relay_tasks t where t.id=relay_messages.task_id));
create policy relay_task_events on public.relay_events for select to authenticated
  using (exists(select 1 from public.relay_tasks t where t.id=relay_events.task_id));

-- Configure this function as the Before User Created hook in Supabase Auth.
-- No SECURITY DEFINER: auth admin gets only the explicit invite SELECT policy.
create function public.relay_before_user_created(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.relay_invites where email=lower(event->'user'->>'email') and active) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Registration is invitation-only.'));
  end if;
  return '{}'::jsonb;
end;
$$;
grant usage on schema public to supabase_auth_admin;
grant select on public.relay_invites to supabase_auth_admin;
create policy relay_hook_invites on public.relay_invites for select to supabase_auth_admin using (true);
revoke all on function public.relay_before_user_created(jsonb) from public,anon,authenticated;
grant execute on function public.relay_before_user_created(jsonb) to supabase_auth_admin;

create function public.relay_bootstrap(p_name text,p_workspace text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_tenant uuid;
begin
  if not public.relay_eligible() then raise exception using errcode='P0001',message='ACCESS_DENIED'; end if;
  if p_workspace is null or p_workspace not in ('buyer','builder') or p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception using errcode='P0001',message='INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('relay-bootstrap:'||v_user::text,0));
  insert into public.relay_profiles(user_id,name,workspace) values(v_user,btrim(p_name),p_workspace) on conflict(user_id) do nothing;
  insert into public.relay_tenants(owner_id,name) values(v_user,btrim(p_name)||'’s workspace') on conflict(owner_id) do nothing;
  select id into strict v_tenant from public.relay_tenants where owner_id=v_user;
  insert into public.relay_memberships(user_id,tenant_id,role) values(v_user,v_tenant,'owner') on conflict do nothing;
end;
$$;
revoke all on function public.relay_bootstrap(text,text) from public,anon;
grant execute on function public.relay_bootstrap(text,text) to authenticated;

create function public.relay_set_workspace(p_workspace text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.relay_eligible() then raise exception using errcode='P0001',message='ACCESS_DENIED'; end if;
  if p_workspace is null or p_workspace not in ('buyer','builder') then raise exception using errcode='P0001',message='INVALID_INPUT'; end if;
  update public.relay_profiles set workspace=p_workspace where user_id=auth.uid();
end;
$$;
revoke all on function public.relay_set_workspace(text) from public,anon;
grant execute on function public.relay_set_workspace(text) to authenticated;

-- One transactional entry point: callers have no direct task/message/event writes.
-- Advisory lock serializes retry-key checks per actor; row locks/version checks
-- protect a task. JSONB request comparison does not depend on JSON key ordering.
create function public.relay_task_command(p_command text,p_key text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_task public.relay_tasks; v_prior public.relay_idempotency;
  v_id uuid; v_tenant uuid; v_role text; v_name text; v_response jsonb; v_type text;
begin
  if not public.relay_eligible() then raise exception using errcode='P0001',message='ACCESS_DENIED'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception using errcode='P0001',message='IDEMPOTENCY_REQUIRED'; end if;
  if p_command is null or p_command not in ('create','edit','post','cancel','message') or jsonb_typeof(p_body) is distinct from 'object' then
    raise exception using errcode='P0001',message='INVALID_INPUT';
  end if;
  if (p_command='create' and (p_body-array['tenantId','title','brief'])<>'{}'::jsonb)
    or (p_command='edit' and (p_body-array['taskId','expectedVersion','title','brief'])<>'{}'::jsonb)
    or (p_command='message' and (p_body-array['taskId','expectedVersion','body'])<>'{}'::jsonb)
    or (p_command in ('post','cancel') and (p_body-array['taskId','expectedVersion'])<>'{}'::jsonb) then
    raise exception using errcode='P0001',message='INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('relay-command:'||v_user::text,0));
  select * into v_prior from public.relay_idempotency where user_id=v_user and key=p_key;
  if found then
    if v_prior.command<>p_command or v_prior.request<>p_body then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    if not exists(select 1 from public.relay_tasks t join public.relay_memberships m on m.tenant_id=t.tenant_id
      where t.id=(v_prior.response->>'taskId')::uuid and t.created_by=v_user and m.user_id=v_user and m.role in ('owner','employee')) then
      raise exception using errcode='P0001',message='ACCESS_DENIED';
    end if;
    return v_prior.response;
  end if;
  select name into strict v_name from public.relay_profiles where user_id=v_user;
  if p_command='create' then
    if jsonb_typeof(p_body->'title') is distinct from 'string' or jsonb_typeof(p_body->'brief') is distinct from 'string'
      or length(btrim(p_body->>'title')) not between 1 and 120 or length(btrim(p_body->>'brief')) not between 1 and 10000 then
      raise exception using errcode='P0001',message='INVALID_INPUT';
    end if;
    v_tenant := (p_body->>'tenantId')::uuid;
    select role into v_role from public.relay_memberships where tenant_id=v_tenant and user_id=v_user;
    if v_role is null or v_role not in ('owner','employee') then raise exception using errcode='P0001',message='ACCESS_DENIED'; end if;
    insert into public.relay_tasks(tenant_id,created_by,title,brief)
      values(v_tenant,v_user,btrim(p_body->>'title'),btrim(p_body->>'brief')) returning * into v_task;
    insert into public.relay_messages(task_id,author_id,author_name,body) values(v_task.id,v_user,v_name,v_task.brief);
    v_type := 'task.created';
  else
    v_id := (p_body->>'taskId')::uuid;
    select * into v_task from public.relay_tasks where id=v_id and created_by=v_user for update;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    select role into v_role from public.relay_memberships where tenant_id=v_task.tenant_id and user_id=v_user;
    if v_role is null or v_role not in ('owner','employee') then raise exception using errcode='P0001',message='ACCESS_DENIED'; end if;
    if jsonb_typeof(p_body->'expectedVersion') is distinct from 'number'
      or (p_body->>'expectedVersion')::numeric<>v_task.version then
      raise exception using errcode='P0001',message='VERSION_CONFLICT';
    end if;
    if v_task.status='cancelled' then raise exception using errcode='P0001',message='TASK_CLOSED'; end if;
    if p_command='edit' then
      if v_task.status<>'draft' then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
      if jsonb_typeof(p_body->'title') is distinct from 'string' or jsonb_typeof(p_body->'brief') is distinct from 'string'
        or length(btrim(p_body->>'title')) not between 1 and 120 or length(btrim(p_body->>'brief')) not between 1 and 10000 then
        raise exception using errcode='P0001',message='INVALID_INPUT';
      end if;
      update public.relay_tasks set title=btrim(p_body->>'title'),brief=btrim(p_body->>'brief') where id=v_id;
      v_type := 'task.edited';
    elsif p_command='message' then
      if jsonb_typeof(p_body->'body') is distinct from 'string' or length(btrim(p_body->>'body')) not between 1 and 10000 then
        raise exception using errcode='P0001',message='INVALID_INPUT';
      end if;
      insert into public.relay_messages(task_id,author_id,author_name,body) values(v_id,v_user,v_name,btrim(p_body->>'body'));
      v_type := 'message.added';
    elsif p_command='post' then
      if v_task.status<>'draft' then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
      update public.relay_tasks set status='posted' where id=v_id;
      v_type := 'task.posted';
    else
      update public.relay_tasks set status='cancelled' where id=v_id;
      v_type := 'task.cancelled';
    end if;
    update public.relay_tasks set version=version+1,updated_at=now() where id=v_id returning * into v_task;
  end if;
  insert into public.relay_events(task_id,actor_id,type,version) values(v_task.id,v_user,v_type,v_task.version);
  v_response := jsonb_build_object('taskId',v_task.id,'version',v_task.version);
  insert into public.relay_idempotency(user_id,key,command,request,response) values(v_user,p_key,p_command,p_body,v_response);
  return v_response;
end;
$$;
revoke all on function public.relay_task_command(text,text,jsonb) from public,anon;
grant execute on function public.relay_task_command(text,text,jsonb) to authenticated;

create function public.relay_auth_attempt(p_keys text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_key text; v_count integer;
begin
  if coalesce(array_length(p_keys,1),0)<>2 then return false; end if;
  -- Deterministic lock order prevents two requests taking reversed bucket locks.
  for v_key in select k from unnest(p_keys) k order by k loop
    if v_key !~ '^[a-f0-9]{64}$' then return false; end if;
    insert into public.relay_auth_limits(key,attempts,reset_at) values(v_key,1,now()+interval '15 minutes')
      on conflict(key) do update set attempts=case when relay_auth_limits.reset_at<=now() then 1 else relay_auth_limits.attempts+1 end,
      reset_at=case when relay_auth_limits.reset_at<=now() then now()+interval '15 minutes' else relay_auth_limits.reset_at end
      returning attempts into v_count;
    if v_count>20 then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.relay_auth_attempt(text[]) from public,anon,authenticated;
grant execute on function public.relay_auth_attempt(text[]) to service_role;

commit;
