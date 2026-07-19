# Discloud - dominio nextech.com

Configuracao extra do app:

```ini
NAME=NexTech Site
TYPE=site
ID=nextech
MAIN=index.js
RAM=1024
VERSION=latest
BUILD=npm install && npm run build
START=npm start
```

Registros DNS para o dominio raiz `nextech.com`:

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | nextech.com | 99.83.186.151 |
| A | nextech.com | 75.2.96.173 |

No Cloudflare, mantenha esses registros como apenas DNS, com a nuvem cinza.
O SSL e a verificacao do dominio sao feitos pela Discloud depois da propagacao.
