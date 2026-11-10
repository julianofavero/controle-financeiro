/* Configuração do Supabase.
 *
 * A chave abaixo é a PUBLISHABLE (ou "anon") do projeto, feita para ficar no
 * navegador: quem protege os dados são as políticas RLS do banco.
 * NUNCA coloque aqui a "service_role" nem a "secret".
 *
 * Onde achar: painel do Supabase > Project Settings > API Keys.
 */
window.APP_CONFIG = {
  supabaseUrl: 'https://ecfadtawqnjiyvjqpkvt.supabase.co',
  supabaseKey: 'COLE_AQUI_A_CHAVE_PUBLICAVEL',
  // O login é "usuário"; por baixo vira "usuário@emailDomain" no Supabase Auth.
  // Precisa ser igual à constante EMAIL_DOMAIN da função admin-users.
  emailDomain: 'usuarios.controle-financeiro.app',
};
