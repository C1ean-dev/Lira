# Conexões autônomas

O Lira tenta a sinalização do Render, o PeerJS público e o servidor embutido no
desktop. Se nenhum responder, o anfitrião ainda pode entrar no espaço em modo
direto. A sala pode ser usada localmente enquanto aguarda participantes.

## Compartilhar um convite completo

### Entrar por link

Na barra do espaço, **Copiar link do convite** copia um endereço HTTPS:
`https://lira-signaling.onrender.com/join#invite=…`. Compartilhe o endereço completo
no WhatsApp, em sites ou em outros mensageiros. O navegador abre a página do
convite; clique em **Abrir no Lira** e confirme a abertura do aplicativo quando
solicitado. Quem ainda não instalou pode usar **Baixar Lira**, instalar o programa
e voltar à mesma página para abrir o convite. O link continua disponível nessa
página; se a instalação demorar e só houver uma oferta direta, peça um novo convite.

O convite fica no fragmento após `#`, sem enviar SDP ou endereços de conexão ao
servidor HTTP. A rota `/join` é independente da sinalização e não requer banco
de dados. O chat do próprio Lira e o campo **Código da sala** também aceitam esse
endereço HTTPS. Os links `lira://join?invite=…` anteriores continuam funcionando
no aplicativo e como destino do botão **Abrir no Lira**.

Se o aplicativo estiver aberto em outro espaço, ele sai desse espaço antes de
entrar no convidado. Se já estiver no espaço de destino, permanece nele. Sem
nickname, o convite fica preenchido na tela **Conectar**; informe seu nome e clique
em **Entrar na sala**.

O link gerado pelo anfitrião leva o convite completo, com as mesmas rotas e prazo
da oferta direta. Se somente a rota direta estiver disponível, a troca de resposta
manual continua necessária. Convites acima do limite de tamanho de links do
aplicativo devem ser compartilhados com **Copiar convite completo**, que continua
disponível. Visitantes podem copiar um link com o ID do espaço, dependente da
sinalização online.

O instalador Windows registra `lira://`, e o aplicativo instalado renova esse
registro ao abrir. Builds de desenvolvimento não substituem o registro do Lira
instalado. O destinatário precisa instalar uma versão com suporte a `lira://`
para o botão da página abrir o aplicativo. Se tiver uma versão anterior, atualize
o Lira ou use **Copiar convite para colar no Lira** na página. O endpoint `/join`
precisa estar publicado no servidor Render junto com a versão correspondente do cliente.

### Convite em texto

O anfitrião pode clicar em **Convite completo** na barra superior para copiar um
convite `LIRA-ALL:`. O visitante cola o texto em **Conectar → Código da sala** e
clica em **Entrar na sala**. O Lira tenta, na ordem, o servidor de sinalização do
espaço e os endereços IPv6 globais disponíveis no desktop do anfitrião. Quando o
convite inclui uma oferta direta e as outras rotas falham, o Lira prepara a
resposta automaticamente. O visitante usa **Copiar resposta** e envia o texto ao
anfitrião, que cola a resposta em **Convites individuais →
Resposta do jogador** e clica em **Aplicar resposta**.

A oferta direta vale por dez minutos e aceita um visitante. Copie um convite
por pessoa se precisar dessa alternativa. As rotas pelo servidor e por IPv6
continuam disponíveis enquanto seus endereços e o espaço estiverem acessíveis.

## Convidar pela internet sem sinalização externa

1. Crie o espaço e abra **Convites individuais** na barra superior.
2. Clique em **Gerar convite direto** e envie o texto completo ao outro jogador.
3. Na tela **Conectar**, o visitante cola o convite em **Código da sala**. Quando
   o Lira preparar a resposta, o visitante clica em **Copiar resposta**.
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

No desktop do anfitrião, abra **Convites individuais** dentro do espaço, clique em
**Ativar rede local / IPv6** e copie um **convite da rede local**. Ative enquanto
estiver sozinho no espaço. Se houver convites diretos pendentes, use **Expirar
convites diretos** antes de ativar. Isso também expira a oferta direta dos
convites completos já copiados. A ativação retira o espaço do Hub. O outro jogador
cola o convite em **Conectar → Código da sala** e clica em **Entrar na sala**.

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

Dentro do espaço, abra **Convites individuais**, ative **Rede local / IPv6** e
clique em **Copiar convite IPv6**. O visitante cola o texto completo em
**Conectar → Código da sala**. O convite contém o endereço IPv6 global,
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
