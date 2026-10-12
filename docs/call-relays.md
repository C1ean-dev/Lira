# Servidores auxiliares das chamadas

As chamadas, o DJ e a rede de amigos usam a mesma configuração ICE. Por padrão,
ela inclui dois servidores STUN para descobrir caminhos diretos entre participantes.

O endereço antigo `openrelay.metered.ca`, com usuário e senha públicos
`openrelayproject`, foi removido porque as tentativas de resolução estavam falhando
repetidamente. O provedor atualmente documenta credenciais por conta:
https://www.metered.ca/tools/openrelay/

Sem um servidor TURN válido, participantes em redes que bloqueiam conexões diretas
podem não conseguir estabelecer chamadas. Para habilitar relay, configure os
valores fornecidos pelo seu servidor TURN em `.env.local` e reinicie o desenvolvimento:

```dotenv
VITE_TURN_URLS=turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp
VITE_TURN_USERNAME=usuario-do-relay
VITE_TURN_CREDENTIAL=credencial-do-relay
```

Os endereços acima são exemplos. A lista aceita endereços TURN/TURNS separados por
vírgula. Configuração incompleta ou com protocolo inválido mantém apenas STUN.
Para distribuição, os valores precisam estar disponíveis ao gerar o pacote.

Variáveis `VITE_` ficam acessíveis no cliente. Use credenciais destinadas a clientes
TURN, com limites de uso; não coloque chaves administrativas de API nessas variáveis
nem credenciais reais em arquivos versionados. Credenciais temporárias de produção
devem ser emitidas por um serviço confiável.
