export type SystemEmojiKey =
  | "visto"
  | "trofeu_alt"
  | "trofeu"
  | "robo"
  | "relogio"
  | "prancheta"
  | "prancheta_caneta"
  | "porta"
  | "perigo"
  | "link"
  | "liga"
  | "interrogacao"
  | "engrenagem"
  | "homem"
  | "folha"
  | "exclamacao"
  | "discord"
  | "dinheiro"
  | "prancheta_acertos"
  | "calendario"
  | "caixa"
  | "aniversario"
  | "acessar"
  | "nuvem"
  | "arma"
  | "banco"
  | "bandeira"
  | "mais"
  | "salvar"
  | "voltar"
  | "CHATBlack"
  | "CHATBlack_Crown"
  | "CHATBlack_hearts"
  | "CHATBlack_knife"
  | "CHATBlack_gun"
  | "CHATBlack_skull"
  | "CHATBlack_error"
  | "CHATBlack_insta"
  | "CHATDiscord_Black"
  | "CHATBlack_Broken_Heart"
  | "CHATBlack_1knife"
  | "CHATBlack_heart1"
  | "CHATblack_gun_ak47black"
  | "CHATLc_louis_vuitton_black"
  | "fantasma"
  | "CHATamor"
  | "CHATmessage_love";

export type SystemEmojiDefinition = {
  key: SystemEmojiKey;
  name: SystemEmojiKey;
  fallback: string;
  label: string;
  description: string;
};

export const SYSTEM_EMOJIS: readonly SystemEmojiDefinition[] = [
  { key: "visto", name: "visto", fallback: "✅", label: "Visto", description: "Confirmação, aprovação e sucesso." },
  { key: "trofeu_alt", name: "trofeu_alt", fallback: "🏅", label: "Troféu alternativo", description: "Destaques, benefícios e vantagens." },
  { key: "trofeu", name: "trofeu", fallback: "🏆", label: "Troféu", description: "Conquistas, cursos e rankings." },
  { key: "robo", name: "robo", fallback: "🤖", label: "Robô", description: "Bot, automação e módulos." },
  { key: "relogio", name: "relogio", fallback: "🕒", label: "Relógio", description: "Tempo, renovação e pendências." },
  { key: "prancheta", name: "prancheta", fallback: "📋", label: "Prancheta", description: "Painéis, listas e formulários." },
  { key: "prancheta_caneta", name: "prancheta_caneta", fallback: "📝", label: "Prancheta com caneta", description: "Edição, provas e solicitações." },
  { key: "porta", name: "porta", fallback: "🚪", label: "Porta", description: "Saída, voltar e fechar." },
  { key: "perigo", name: "perigo", fallback: "⚠️", label: "Perigo", description: "Alertas críticos e bloqueios." },
  { key: "link", name: "link", fallback: "🔗", label: "Link", description: "Links, convites e URLs." },
  { key: "liga", name: "liga", fallback: "🟢", label: "Liga", description: "Ativo, iniciar e online." },
  { key: "interrogacao", name: "interrogacao", fallback: "❓", label: "Interrogação", description: "Ajuda, dúvidas e suporte." },
  { key: "engrenagem", name: "engrenagem", fallback: "⚙️", label: "Engrenagem", description: "Configurações e administração." },
  { key: "homem", name: "homem", fallback: "👤", label: "Homem", description: "Usuário, membro e permissões." },
  { key: "folha", name: "folha", fallback: "📄", label: "Folha", description: "Documentos, regras e relatórios." },
  { key: "exclamacao", name: "exclamacao", fallback: "❗", label: "Exclamação", description: "Avisos, erros e atenção." },
  { key: "discord", name: "discord", fallback: "💬", label: "Discord", description: "Canais, servidor e comunidade." },
  { key: "dinheiro", name: "dinheiro", fallback: "💰", label: "Dinheiro", description: "Pagamentos, vendas e caixa." },
  { key: "prancheta_acertos", name: "prancheta_acertos", fallback: "☑️", label: "Prancheta de acertos", description: "Checklist, histórico e acertos." },
  { key: "calendario", name: "calendario", fallback: "📅", label: "Calendário", description: "Agendamento, datas e renovação." },
  { key: "caixa", name: "caixa", fallback: "📦", label: "Caixa", description: "Produtos, pacotes e entregas." },
  { key: "aniversario", name: "aniversario", fallback: "🎉", label: "Aniversário", description: "Boas-vindas, celebração e agradecimento." },
  { key: "acessar", name: "acessar", fallback: "➡️", label: "Acessar", description: "Abrir, entrar e avançar." },
  { key: "nuvem", name: "nuvem", fallback: "☁️", label: "Nuvem", description: "Deploy, sincronização e backup." },
  { key: "arma", name: "arma", fallback: "🔫", label: "Arma", description: "Ações, operações policiais e FAC." },
  { key: "banco", name: "banco", fallback: "🏦", label: "Banco", description: "Banco Central e ações financeiras." },
  { key: "bandeira", name: "bandeira", fallback: "🏁", label: "Bandeira", description: "Resultado e encerramento de ações." },
  { key: "mais", name: "mais", fallback: "➕", label: "Mais", description: "Cadastrar, adicionar e criar." },
  { key: "salvar", name: "salvar", fallback: "💾", label: "Salvar", description: "Salvar configurações e alterações." },
  { key: "voltar", name: "voltar", fallback: "⬅️", label: "Voltar", description: "Retornar para painel anterior." },
  { key: "CHATBlack", name: "CHATBlack", fallback: "◼️", label: "CHATBlack", description: "Emoji preto do servidor." },
  { key: "CHATBlack_Crown", name: "CHATBlack_Crown", fallback: "👑", label: "CHATBlack Crown", description: "Coroa preta do servidor." },
  { key: "CHATBlack_hearts", name: "CHATBlack_hearts", fallback: "🖤", label: "CHATBlack Hearts", description: "Corações pretos do servidor." },
  { key: "CHATBlack_knife", name: "CHATBlack_knife", fallback: "🔪", label: "CHATBlack Knife", description: "Faca preta do servidor." },
  { key: "CHATBlack_gun", name: "CHATBlack_gun", fallback: "🔫", label: "CHATBlack Gun", description: "Arma preta do servidor." },
  { key: "CHATBlack_skull", name: "CHATBlack_skull", fallback: "💀", label: "CHATBlack Skull", description: "Caveira preta do servidor." },
  { key: "CHATBlack_error", name: "CHATBlack_error", fallback: "❌", label: "CHATBlack Error", description: "Erro preto do servidor." },
  { key: "CHATBlack_insta", name: "CHATBlack_insta", fallback: "📷", label: "CHATBlack Insta", description: "Instagram preto do servidor." },
  { key: "CHATDiscord_Black", name: "CHATDiscord_Black", fallback: "💬", label: "CHATDiscord Black", description: "Discord preto do servidor." },
  { key: "CHATBlack_Broken_Heart", name: "CHATBlack_Broken_Heart", fallback: "💔", label: "CHATBlack Broken Heart", description: "Coração partido preto do servidor." },
  { key: "CHATBlack_1knife", name: "CHATBlack_1knife", fallback: "🗡️", label: "CHATBlack 1 Knife", description: "Faca alternativa preta do servidor." },
  { key: "CHATBlack_heart1", name: "CHATBlack_heart1", fallback: "🖤", label: "CHATBlack Heart 1", description: "Coração preto alternativo do servidor." },
  { key: "CHATblack_gun_ak47black", name: "CHATblack_gun_ak47black", fallback: "🔫", label: "CHATBlack AK47", description: "AK preto do servidor." },
  { key: "CHATLc_louis_vuitton_black", name: "CHATLc_louis_vuitton_black", fallback: "◆", label: "CHAT Louis Vuitton Black", description: "Louis Vuitton preto do servidor." },
  { key: "fantasma", name: "fantasma", fallback: "👻", label: "Fantasma", description: "Fantasma do servidor." },
  { key: "CHATamor", name: "CHATamor", fallback: "❤️", label: "CHAT Amor", description: "Amor do servidor." },
  { key: "CHATmessage_love", name: "CHATmessage_love", fallback: "💌", label: "CHAT Message Love", description: "Mensagem de amor do servidor." }
] as const;

export const SYSTEM_EMOJI_BY_KEY = new Map<SystemEmojiKey, SystemEmojiDefinition>(SYSTEM_EMOJIS.map((item) => [item.key, item]));
