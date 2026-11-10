// Edge Function "admin-users": gestão de usuários, só para administradores.
//
// O navegador nunca recebe a service_role. Ele chama esta função com o token
// da própria sessão; a função confere no banco se quem chama é um admin ativo
// e só então usa a service_role para criar, alterar ou apagar contas.
//
// Deploy: painel > Edge Functions > Deploy a new function > "admin-users",
// cole este arquivo e DESLIGUE "Verify JWT" (a função valida o token sozinha).
// Pela CLI: supabase functions deploy admin-users --no-verify-jwt
//
// Corpo da requisição (POST, JSON):
//   { action: 'list' }
//   { action: 'create', username, password, display_name?, role? }
//   { action: 'update', id, display_name?, role?, active?, password? }
//   { action: 'delete', id }

import { createClient } from 'npm:@supabase/supabase-js@2';

// Precisa ser igual a emailDomain em js/config.js.
const EMAIL_DOMAIN = 'usuarios.controle-financeiro.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = '876000h'; // ~100 anos

const passwordError = (p: unknown): string | null => {
  if (typeof p !== 'string' || p.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (p.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  return null;
};

const cleanName = (v: unknown) => String(v ?? '').trim().slice(0, 80);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  // 1) quem está chamando?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Não autenticado.' }, 401);
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  if (authErr || !auth?.user) return json({ error: 'Sessão inválida. Entre novamente.' }, 401);

  // 2) é um administrador ativo?
  const { data: me } = await db
    .from('profiles')
    .select('id, role, active')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!me || !me.active || me.role !== 'admin') {
    return json({ error: 'Acesso restrito a administradores.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Requisição inválida.' }, 400);
  }

  try {
    switch (body.action) {
      case 'list': return await listUsers();
      case 'create': return await createUser(body, me.id);
      case 'update': return await updateUser(body, me.id);
      case 'delete': return await deleteUser(body, me.id);
      default: return json({ error: 'Ação desconhecida.' }, 400);
    }
  } catch (e) {
    console.error('admin-users', e);
    return json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
});

async function listUsers() {
  const { data: profiles, error } = await db
    .from('profiles')
    .select('id, username, display_name, role, active, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const lastSeen = new Map<string, string | null>();
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of list?.users ?? []) lastSeen.set(u.id, u.last_sign_in_at ?? null);

  return json({
    users: (profiles ?? []).map((p) => ({ ...p, last_sign_in_at: lastSeen.get(p.id) ?? null })),
  });
}

async function createUser(b: Record<string, unknown>, adminId: string) {
  const username = String(b.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return json({ error: 'Usuário: 3 a 32 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado.' }, 400);
  }
  const pe = passwordError(b.password);
  if (pe) return json({ error: pe }, 400);
  const role = b.role === 'admin' ? 'admin' : 'user';

  const { data: taken } = await db.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) return json({ error: 'Esse nome de usuário já existe.' }, 409);

  const { data: created, error: ce } = await db.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password: b.password as string,
    email_confirm: true,
    user_metadata: { username },
  });
  if (ce || !created?.user) {
    console.error('createUser', ce);
    const dup = /already|registered|exists/i.test(ce?.message ?? '');
    return json({ error: dup ? 'Já existe um login com esse nome. Escolha outro.' : 'Não foi possível criar a conta.' }, dup ? 409 : 400);
  }

  const id = created.user.id;
  const { error: pErr } = await db.from('profiles').insert({
    id,
    username,
    display_name: cleanName(b.display_name) || username,
    role,
    created_by: adminId,
  });
  if (pErr) {
    console.error('profile insert', pErr);
    await db.auth.admin.deleteUser(id); // não deixa conta sem perfil
    return json({ error: 'Não foi possível criar o perfil.' }, 500);
  }
  await db.from('user_settings').upsert({ user_id: id }, { onConflict: 'user_id', ignoreDuplicates: true });

  return json({ id, username }, 201);
}

async function updateUser(b: Record<string, unknown>, adminId: string) {
  const id = String(b.id ?? '');
  if (!UUID_RE.test(id)) return json({ error: 'Usuário inválido.' }, 400);

  const { data: target } = await db.from('profiles').select('id').eq('id', id).maybeSingle();
  if (!target) return json({ error: 'Usuário não encontrado.' }, 404);

  const patch: Record<string, unknown> = {};
  if (b.display_name !== undefined) patch.display_name = cleanName(b.display_name);
  if (b.role !== undefined) {
    if (b.role !== 'admin' && b.role !== 'user') return json({ error: 'Perfil inválido.' }, 400);
    patch.role = b.role;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return json({ error: 'Valor inválido.' }, 400);
    patch.active = b.active;
  }
  // quem administra não pode se rebaixar nem se desativar (evita ficar sem admin)
  if (id === adminId && (patch.role === 'user' || patch.active === false)) {
    return json({ error: 'Você não pode remover o próprio acesso de administrador.' }, 400);
  }

  if (b.password !== undefined) {
    const pe = passwordError(b.password);
    if (pe) return json({ error: pe }, 400);
  }

  if (Object.keys(patch).length) {
    const { error } = await db.from('profiles').update(patch).eq('id', id);
    if (error) throw error;
  }

  const authPatch: Record<string, unknown> = {};
  if (b.password !== undefined) authPatch.password = b.password;
  if (patch.active !== undefined) authPatch.ban_duration = patch.active ? 'none' : BAN_FOREVER;
  if (Object.keys(authPatch).length) {
    const { error } = await db.auth.admin.updateUserById(id, authPatch);
    if (error) {
      console.error('updateUserById', error);
      return json({ error: 'Não foi possível atualizar o login desse usuário.' }, 500);
    }
  }
  return json({ ok: true });
}

async function deleteUser(b: Record<string, unknown>, adminId: string) {
  const id = String(b.id ?? '');
  if (!UUID_RE.test(id)) return json({ error: 'Usuário inválido.' }, 400);
  if (id === adminId) return json({ error: 'Você não pode excluir a própria conta.' }, 400);

  const { data: target } = await db.from('profiles').select('id').eq('id', id).maybeSingle();
  if (!target) return json({ error: 'Usuário não encontrado.' }, 404);

  // apaga o login; perfil, lançamentos, orçamentos e ajustes saem em cascata
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) {
    console.error('deleteUser', error);
    return json({ error: 'Não foi possível excluir o usuário.' }, 500);
  }
  return json({ ok: true });
}
