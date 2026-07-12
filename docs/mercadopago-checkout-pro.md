# Mercado Pago Checkout Pro

## Ambiente

Configure as credenciais somente por variaveis de ambiente. O painel de planos nao armazena `access_token` nem `webhook_secret`.

Variaveis principais:

- `MERCADOPAGO_ENABLED=true`
- `MERCADOPAGO_ENV=test` ou `production`
- `MERCADOPAGO_TEST_ACCESS_TOKEN`
- `MERCADOPAGO_TEST_PUBLIC_KEY`
- `MERCADOPAGO_TEST_WEBHOOK_SECRET`
- `MERCADOPAGO_PROD_ACCESS_TOKEN`
- `MERCADOPAGO_PROD_PUBLIC_KEY`
- `MERCADOPAGO_PROD_WEBHOOK_SECRET`
- `MERCADOPAGO_WEBHOOK_URL=https://seu-dominio.example.com/api/payments/mercadopago/webhook`
- `MERCADOPAGO_SUCCESS_URL=https://seu-dominio.example.com/pagamento/sucesso`
- `MERCADOPAGO_PENDING_URL=https://seu-dominio.example.com/pagamento/pendente`
- `MERCADOPAGO_FAILURE_URL=https://seu-dominio.example.com/pagamento/falha`
- `PAYMENTS_ALLOW_LIVE_CHARGES=false` em homologacao; use `true` somente para producao real.

`MERCADOPAGO_ENV` seleciona explicitamente o par de credenciais. O backend nao decide ambiente pelo prefixo do token.

## Homologacao

1. Configure `MERCADOPAGO_ENABLED=true` e `MERCADOPAGO_ENV=test`.
2. Preencha as credenciais test e o segredo de webhook test.
3. Cadastre o webhook no Mercado Pago apontando para `/api/payments/mercadopago/webhook`.
4. Crie um checkout por `POST /api/payments/mercadopago/checkout` com `planId`.
5. Confirme que a URL retornada e de sandbox e que o pedido fica em `checkout_pending`.
6. Finalize um pagamento de teste e acompanhe `GET /api/payments/orders/:orderId/status`.
7. O acesso ao cadastro de bot deve ser liberado apenas depois de `approved`.

## Producao

1. Configure `MERCADOPAGO_ENV=production`.
2. Preencha somente credenciais reais nas variaveis `MERCADOPAGO_PROD_*`.
3. Configure `PAYMENTS_ALLOW_LIVE_CHARGES=true`.
4. Mantenha o webhook publico em HTTPS.
5. Faca uma compra real de baixo valor e valide pedido, assinatura, webhook e ativacao.

## Operacao

- Rotas do usuario:
  - `POST /api/payments/mercadopago/checkout`
  - `GET /api/payments/orders/:orderId/status`
  - `POST /api/payments/orders/:orderId/retry`
  - `GET /api/payments/me`
- Rotas admin:
  - `GET /api/admin/payments`
  - `GET /api/admin/payments/:orderId`
  - `POST /api/admin/payments/:orderId/reconcile`
- Webhooks aceitos:
  - `/api/payments/mercadopago/webhook`
  - `/api/payments/mercado-pago/webhook`
  - `/api/webhooks/mercadopago`

## Rollback

Para pausar novas cobrancas sem apagar historico:

1. Defina `MERCADOPAGO_ENABLED=false`.
2. Reinicie o backend.
3. Mantenha os webhooks ativos por alguns minutos para processar eventos pendentes.

Para bloquear cobrancas reais especificamente, mantenha `PAYMENTS_ALLOW_LIVE_CHARGES=false`.
