# Conexão direta e servidores TURN

Todos os peers (salas, amigos, chamadas, DJ e transmissão de tela) usam a ordem
automática **P2P → Cloudflare → Metered**. A preferência é aplicada por conexão:

1. Durante os primeiros 1,5 segundos, apenas candidatos diretos e STUN do Google
   e Twilio são usados. Uma conexão direta estabelecida permanece em uso.
2. Sem conexão, o cliente busca credenciais temporárias no backend e reinicia ICE
   na mesma conexão, habilitando Cloudflare. Caminhos diretos continuam permitidos.
3. Se Cloudflare não conectar em mais 3,5 segundos, ICE é reiniciado com Metered.
   Se a emissão de credenciais Cloudflare falhar, o cliente passa para Metered.

Os prazos contam após a negociação anterior terminar. O pedido de credenciais tem
limite de quatro segundos. Uma conexão estabelecida cancela as próximas tentativas.
O suporte a reinício ICE do PeerJS 1.5 fica isolado em
`src/p2p/rtcTransportPriority.ts`: ofertas de reinício são respondidas pelo peer
existente, sem criar outra chamada.

Clientes atualizados anunciam esse suporte pela sinalização. Ao conversar com
versões antigas, o aplicativo preserva a negociação anterior e os relays Metered
que essas versões já conhecem; a prioridade completa exige atualizar os dois lados.

## Cloudflare: credenciais somente no backend

O aplicativo TURN `lirasvg` emite credenciais válidas por 24 horas. O servidor
`lira-signaling` expõe `GET /turn/credentials`, chama a API oficial da Cloudflare e
retorna apenas `{ iceServers, expiresAt }`. As respostas usam `Cache-Control: no-store`,
e a emissão é limitada a dez pedidos por minuto por endereço IP.

Configure **no serviço Render do backend**, como variáveis secretas:

```dotenv
CLOUDFLARE_TURN_KEY_ID=ID_DO_TOKEN_TURN
CLOUDFLARE_TURN_API_TOKEN=TOKEN_DA_API_CLOUDFLARE
```

Use os valores do aplicativo `lirasvg` e publique a versão do backend que contém
`turnCredentials.js`. O endpoint retorna HTTP 503 enquanto essas variáveis não
estiverem configuradas. Os mesmos nomes podem ser guardados como Secrets no
repositório GitHub `C1ean-dev/lira-signaling`; Secrets do GitHub não são enviados
automaticamente ao ambiente de execução do Render.

No cliente, somente o endereço público do serviço é configurável:

```dotenv
VITE_TURN_CREDENTIALS_URL=https://lira-signaling.onrender.com/turn/credentials
```

Esse endereço é o padrão quando a variável está vazia. Para outro backend,
configure `.env.local` e o Secret `VITE_TURN_CREDENTIALS_URL` do repositório Lira.
Os workflows Windows e Android recebem esse endereço durante o build. O token
administrativo da Cloudflare nunca entra em variáveis `VITE_`, no pacote ou em
arquivos versionados. O cliente mantém credenciais temporárias somente em memória,
compartilha pedidos simultâneos e renova o cache um minuto antes do vencimento.

Documentação: https://developers.cloudflare.com/realtime/turn/generate-credentials/

## Metered: último fallback

As credenciais de cliente Metered existentes continuam em `.env.local` e nos
Secrets do GitHub Actions usados para gerar os instaladores:

```dotenv
VITE_TURN_URLS=turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp
VITE_TURN_USERNAME=usuario-do-relay
VITE_TURN_CREDENTIAL=credencial-do-relay
```

Copie as rotas UDP, TCP e TLS fornecidas pelo painel da sua conta. Configurações
incompletas ou inválidas são ignoradas. Variáveis `VITE_` ficam acessíveis no
cliente: use apenas credenciais TURN destinadas a clientes, nunca chaves de API.
Alterar essas credenciais estáticas exige gerar novos instaladores.

Sem Cloudflare disponível e sem Metered configurado, apenas conexões diretas
podem ser estabelecidas. O relay anônimo antigo `openrelay.metered.ca` continua
desabilitado.
