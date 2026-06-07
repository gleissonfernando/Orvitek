# Discord Bot Dashboard Platform

Arquitetura separada em tres aplicacoes independentes:

- `frontend`: dashboard React + TSX + Vite + Tailwind + componentes no estilo shadcn/ui.
- `backend`: API Node.js + Express + TypeScript + MongoDB + Redis + Socket.IO.
- `bot`: bot Discord.js v14 + TypeScript, sem paginas HTML ou rotas web.

## Fluxo

```txt
Frontend
  |
  v
Backend API
  |-- MongoDB
  |-- Redis
  v
Bot Discord
```

O frontend nunca acessa banco de dados diretamente. O bot nunca importa ou renderiza componentes do frontend. Todas as integracoes passam pela API HTTP ou por Socket.IO no backend.

## Primeiros passos

```bash
npm install
docker compose up -d
```

Depois, em terminais separados:

```bash
npm run dev:backend
npm run dev:frontend
npm run dev:bot
```

Ou rode backend e frontend juntos:

```bash
npm run dev
```

Se alguma porta ficar presa por um processo antigo do projeto:

```bash
npm run stop
npm run dev
```

## Deploy Sharclaud

Use o projeto pela raiz.

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm start
```

O `npm start` de producao sobe o backend e o bot juntos. O backend tambem serve o build do frontend em `frontend/dist`.
Nao cadastre `NODE_ENV` no painel da hospedagem antes do build; o script de start define `NODE_ENV=production` sozinho. Se `NODE_ENV=production` existir durante o `npm install`, algumas hospedagens pulam dependencias de build como TypeScript/Vite.
Em producao na Shard, o backend forca `HOST=0.0.0.0` e `PORT=80`, que e a porta esperada pelo proxy `shardweb.app`.

Configure as variaveis no painel da Sharclaud usando `.env.example` como checklist. Em producao, nao use `localhost`, `127.0.0.1` ou `0.0.0.0` em URLs publicas: a aplicacao recusa iniciar com URLs locais.

```env
SITE_ORIGIN="https://ricardinho98.shardweb.app"
FRONTEND_URL="https://ricardinho98.shardweb.app"
MONGODB_URI=
SESSION_SECRET="troque-por-um-segredo-grande-de-sessao"
JWT_SECRET="troque-por-um-segredo-grande-de-jwt"
BOT_API_TOKEN="troque-por-um-token-interno-do-bot"
DASHBOARD_BOT_ID=""
DISCORD_BOT_TOKEN="token-do-bot"
DISCORD_CLIENT_ID="client-id-oauth"
DISCORD_CLIENT_SECRET="client-secret-oauth"
DISCORD_OAUTH_REDIRECT_URI="https://ricardinho98.shardweb.app/auth/discord/callback"
DISCORD_CALLBACK_URL="https://ricardinho98.shardweb.app/auth/discord/callback"
DASHBOARD_AUTH_REQUIRED="true"
DASHBOARD_AUTHORIZED_USER_IDS=
DASHBOARD_GUILD_IDS="1213384118356803594"
DEV_AUTH_ENABLED="false"
```

Quando frontend, API e bot rodam no mesmo dominio, `BACKEND_API_URL`, `BACKEND_SOCKET_URL`, `VITE_API_URL` e `VITE_SOCKET_URL` podem ficar vazias. O bot deriva as URLs a partir de `FRONTEND_URL`; o frontend usa `/api` e o dominio atual no build.

Configure `BACKEND_API_URL`, `BACKEND_SOCKET_URL`, `VITE_API_URL` e `VITE_SOCKET_URL` apenas se separar frontend/API em dominios diferentes.

Para multi-bot, cadastre cada bot na aba Dev e configure `DASHBOARD_BOT_ID` no ambiente do processo daquele bot com o ID interno exibido/salvo pelo painel. Sem esse valor, o bot usa o escopo legado sem `botId`.

Preencha tambem as variaveis da Twitch se for usar esses recursos.

Para reduzir RAM, o bot limita caches do Discord e deixa logs de mensagens/presenca desligados por padrao:

```env
BOT_MEMBER_EVENTS_ENABLED="true"
BOT_MESSAGE_LOGS_ENABLED="false"
BOT_PRESENCE_MONITOR_ENABLED="false"
BOT_CACHE_MEMBERS_MAX="200"
BOT_CACHE_MESSAGES_PER_CHANNEL="10"
BOT_CACHE_PRESENCES_MAX="0"
BOT_CACHE_USERS_MAX="200"
```

Ative `BOT_MESSAGE_LOGS_ENABLED` apenas se precisar registrar mensagens apagadas/editadas. Ative `BOT_PRESENCE_MONITOR_ENABLED` apenas se precisar monitorar lives via status/presenca do Discord.

## Desenvolvimento local

Use apenas o `.env` da raiz do projeto para desenvolvimento. Se nenhuma URI de MongoDB for informada em modo dev, o backend usa `mongodb://localhost:27017/ricardinho98`.

URLs locais de desenvolvimento:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000/api`
- Socket.IO: `http://localhost:4000`

## OAuth2 Discord

Em desenvolvimento, a dashboard pode abrir sem OAuth2 usando o usuario local `Admin Local`. Esse modo tambem emite JWT httpOnly para manter o mesmo fluxo interno do painel.

Em producao, `DASHBOARD_AUTH_REQUIRED` precisa ficar `true`; o modo local/dev fica bloqueado para evitar deploy aberto ou preso em usuario local.

Para exigir login Discord novamente, defina no `.env`:

```env
DASHBOARD_AUTH_REQUIRED="true"
```

Crie uma aplicacao no Discord Developer Portal e configure:

- Redirect URI: `https://ricardinho98.shardweb.app/auth/discord/callback`
- Escopos: `identify`, `email`, `guilds`

Para desenvolvimento local, preencha no `.env`:

```env
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
SITE_ORIGIN="https://ricardinho98.shardweb.app"
FRONTEND_URL="https://ricardinho98.shardweb.app"
DISCORD_OAUTH_REDIRECT_URI="https://ricardinho98.shardweb.app/auth/discord/callback"
DISCORD_CALLBACK_URL="https://ricardinho98.shardweb.app/auth/discord/callback"
JWT_SECRET="troque-por-um-segredo-grande-de-jwt"
DASHBOARD_AUTH_REQUIRED="true"
DASHBOARD_DEV_USER_IDS="1426287249020158018"
DASHBOARD_VERIFICATION_MODE="roles"
```

Use sempre a URL publica em `SITE_ORIGIN`, `DISCORD_OAUTH_REDIRECT_URI`, `DISCORD_CALLBACK_URL` e `FRONTEND_URL` quando `DASHBOARD_AUTH_REQUIRED="true"`. O OAuth2 do Discord nao deve apontar para `localhost`.

`DASHBOARD_AUTHORIZED_USER_IDS` aceita IDs de usuarios Discord separados por virgula. A aba Dev e o modo de ver todos os modulos ficam restritos ao dono do sistema `1426287249020158018`; os demais usuarios veem somente os modulos liberados para o bot selecionado. `DASHBOARD_GUILD_IDS` aceita IDs de servidores Discord separados por virgula e garante que esses servidores aparecam no painel para o Dev.

Quando `DASHBOARD_AUTH_REQUIRED="true"`, o backend usa Discord OAuth2, salva a autenticacao em JWT httpOnly e exige uma verificacao por aba antes de abrir o painel. Ao fechar a aba ou sair, a verificacao precisa ser feita novamente.

Com `DASHBOARD_VERIFICATION_MODE="roles"`, o cargo liberado na area de Moderacao controla o acesso ao site por bot e servidor. O dono do servidor nao precisa do cargo; administradores e demais membros precisam possui-lo.

Redis tambem fica opcional no ambiente local. Para usar Redis como store de sessao, rode o Redis e defina:

```env
REDIS_SESSION_ENABLED="true"
```

## Lives

O painel inclui o gerenciamento de alertas da Twitch dentro da area `Lives`.

Configure no `.env`:

```env
TWITCH_CLIENT_ID=""
TWITCH_CLIENT_SECRET=""
TWITCH_MONITOR_INTERVAL_MS="20000"
```

Fluxo:

- O dono/admin do servidor cadastra o link do canal Twitch no dashboard.
- A API normaliza o canal, valida pela Twitch API e salva por `guildId`.
- O bot busca notificacoes ativas na API, consulta a Twitch a cada intervalo e envia uma embed quando detectar uma live nova.
- `lastStreamId` evita alertas duplicados da mesma live.
