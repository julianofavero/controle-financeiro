-- =====================================================================
-- Controle Financeiro · cria o primeiro administrador
--
-- Rode DEPOIS de 001_schema.sql e DEPOIS de criar a conta no painel:
--
--   1. Authentication > Users > Add user > Create new user
--   2. E-mail: admin@usuarios.controle-financeiro.app
--      (é "<usuário>@<domínio de js/config.js>"; para outro login, troque
--       o "admin" abaixo e o e-mail pelo mesmo nome)
--   3. Defina uma senha forte e marque "Auto Confirm User"
--   4. Cole este arquivo no SQL Editor e rode
--
-- A senha nunca passa por este arquivo nem pelo repositório.
-- =====================================================================
do $$
declare
  v_username text := 'admin';
  v_domain   text := 'usuarios.controle-financeiro.app';
  v_id       uuid;
begin
  select id into v_id
  from auth.users
  where email = v_username || '@' || v_domain;

  if v_id is null then
    raise exception 'Conta % não encontrada em Authentication > Users. Crie-a antes (veja o topo deste arquivo).',
      v_username || '@' || v_domain;
  end if;

  insert into public.profiles (id, username, display_name, role, active)
  values (v_id, v_username, 'Administrador', 'admin', true)
  on conflict (id) do update
    set role = 'admin', active = true;

  insert into public.user_settings (user_id)
  values (v_id)
  on conflict (user_id) do nothing;
end;
$$;

-- Conferir: deve listar uma linha com role = admin.
select id, username, role, active from public.profiles where role = 'admin';
