# Conexões autônomas

O Lira tenta a sinalização do Render, o PeerJS público e o servidor embutido no
desktop. Se nenhum responder, o anfitrião ainda pode entrar no espaço em modo
direto. Também é possível escolher esse modo ao criar um espaço, sem esperar os
servidores. A sala pode ser usada localmente enquanto aguarda participantes.

## Convidar pela internet sem sinalização externa

1. Crie o espaço e abra **Conexão direta** na barra superior.
2. Clique em **Gerar convite direto** e envie o texto completo ao outro jogador.
3. O visitante abre **Entrar por Código → Conectar por convite direto**, cola o
   convite e clica em **Gerar resposta e conectar**. Colar o convite direto no
   campo de código também abre esse fluxo.
4. O visitante envia a resposta ao anfitrião, que a cola em **Resposta do jogador**
   e clica em **Aplicar resposta**.

Mantenham os dois aplicativos abertos durante a troca. Cada convite aceita um
participante e expira em dez minutos. Para receber outro participante, gere outro
convite. Os textos preservam maiúsculas e minúsculas; não os edite.

A troca cria um canal WebRTC para transportar a negociação do PeerJS. Mapa, chat,
chamadas e compartilhamento continuam usando os protocolos existentes do Lira.
Conexões de dados entre versões compatíveis também transportam a negociação de
novas chamadas; uma queda do servidor de sinalização não exige fechar esses
canais. Clientes antigos continuam usando a sinalização normal.

## Na mesma rede

No desktop do anfitrião, selecione **Rede local / IPv6 — hospedar neste computador** ao
criar o espaço. Em **Conexão direta**, copie um **convite da rede local**. O outro
jogador cola esse texto no campo **Código da Sala** e entra normalmente.

O convite contém o IP do adaptador e a porta do servidor embutido. Quando existem
vários adaptadores, há um convite por endereço. Use o da rede compartilhada pelos
dois computadores. A conexão depende das permissões de firewall e do isolamento
entre dispositivos da rede. O aplicativo não altera essas permissões nesse fluxo.
O anfitrião LAN requer o aplicativo desktop; a troca manual de convite e resposta
também usa as APIs WebRTC disponíveis nas outras plataformas.

## Pela internet com IPv6

O servidor embutido tenta escutar em IPv6 e IPv4 simultaneamente. Se o sistema
não oferecer IPv6, utiliza IPv4. Convites só são disponibilizados depois que o
servidor começa a escutar, e endereços IPv6 não são anunciados no fallback IPv4.

Para usar, crie o espaço no modo **Rede local / IPv6**, abra **Conexão direta** e
clique em **Copiar convite IPv6**. O visitante cola o texto completo em
**Entrar por Código → Código da Sala**. O convite contém o endereço IPv6 global,
entre colchetes, e a porta do anfitrião. Não é necessário devolver uma resposta:
os aplicativos trocam a negociação pelo servidor embutido do anfitrião.

Os dois computadores precisam de conectividade IPv6, e o firewall do anfitrião
e do roteador deve permitir acesso à porta informada. O aplicativo não libera
portas automaticamente. Sem essas condições, use outro convite ou o fluxo de
convite e resposta; TURN continua disponível para as conexões WebRTC quando
configurado. TURN não libera a porta do servidor de sinalização do anfitrião.

Endereços privados IPv6 (`fc00::/7`) aparecem como **Convite IPv6 da rede local**,
pois dependem de uma rede privada compartilhada. Endereços link-local (`fe80::/10`)
não geram convites portáveis, pois exigem identificar a interface de rede no
computador de destino. Um IPv6 global pode mudar quando a conexão ou o endereço
temporário do sistema for renovado; nesse caso, copie um novo convite.

O anfitrião desse modo usa o desktop. Navegadores em páginas HTTPS podem bloquear
a conexão WebSocket sem TLS ao endereço do anfitrião; nesses casos, utilize o
fluxo manual de convite e resposta ou o aplicativo desktop.

## STUN, TURN e limites da conexão direta

O fluxo normal continua priorizando P2P, Cloudflare e Metered. No convite manual,
os candidatos locais e os candidatos dos serviços STUN/TURN configurados são
coletados juntos para evitar precisar trocar novos textos a cada alternativa.
As credenciais Cloudflare são opcionais e têm um prazo limitado de carregamento.
Sem TURN, a conexão direta ainda é tentada. Sem STUN, candidatos locais continuam
disponíveis, inclusive endereços IPv6 quando oferecidos pelo sistema.

Sem serviços externos, um ID curto não informa onde encontrar o anfitrião na
internet. É necessário o convite completo ou um endereço alcançável. NATs e
firewalls podem impedir todas as rotas diretas; nessas redes, um relay TURN ou
uma mudança de rede continua sendo necessário. Não há garantia de atravessar
qualquer bloqueio sem infraestrutura auxiliar.

O anfitrião deve permanecer conectado durante uma sessão direta. Se os canais
forem perdidos e não houver sinalização alcançável, gere uma nova troca de convite
e resposta. Convites e respostas contêm dados temporários de conexão: compartilhe
somente com quem deve participar.

## Testes

Os testes unitários cobrem o convite, expiração, cancelamento, validação de
identidade, roteamento autenticado pelo anfitrião, ausência de relays, entrada LAN/IPv6,
listener dual stack e fallback IPv4,
e uma simulação de dois gerenciadores sincronizando o mapa sem sockets de servidor.
Também verificam os tipos do transporte e da interface. A simulação não comprova
travessia de NAT nem funcionamento entre máquinas reais; esses cenários precisam
de validação adicional autorizada.
