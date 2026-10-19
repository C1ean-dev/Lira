# Spotify no navegador e DJ

O Lira abre o site oficial do Spotify em uma janela dedicada do Google Chrome. Se o Chrome não estiver instalado, usa o Microsoft Edge. O navegador instalado no computador cuida da reprodução, como em uma visita normal ao Spotify. O Lira usa Electron padrão; não existe dependência da Castlabs nem etapa de assinatura EVS.

## Fluxo para o usuário

1. Entre em uma sala privada e clique em Entrar pelo navegador no painel DJ. O Chrome/Edge abre uma janela normal, com barra de endereço, usando o perfil dedicado do Spotify. Durante esse login, o navegador não tem depuração remota ativada nem é encaixado no Lira. Você pode usar Continuar com Google na página oficial.
2. O painel DJ mostra que o navegador foi aberto e orienta fazer login. Depois de entrar, feche essa janela. Ao voltar ao Lira, o painel informa que o navegador foi fechado e pede Concluir login. Esse botão mostra o progresso da preparação e o resultado no próprio painel, antes da transmissão. O player integrado reabre usando o mesmo perfil e a sessão salva pelo navegador. O Lira aguarda o processo de login encerrar antes de ativar os controles; não copia cookies nem lê o formulário de autenticação. Fechar o navegador, por si só, não confirma o login.
3. Quando o painel mostrar Login concluído, escolha suas músicas, dê play e clique em Transmitir DJ. O botão de transmissão permanece desabilitado até concluir o login. No seletor do navegador, selecione a própria aba do Spotify e marque Compartilhar áudio da aba. Enquanto o DJ estiver ativo, o navegador suprime a reprodução local; o som é ouvido pelo painel DJ, inclusive por quem iniciou a transmissão. O DJ não aparece como participante na chamada, no mapa ou na lista de pessoas.
4. Use o volume do painel para ajustar apenas sua própria escuta, sem alterar a voz ou o volume dos demais integrantes. Todos na sala veem a música, o tempo e os controles de reprodução, pausa, anterior, próxima e posição da música, sincronizados com o Spotify de quem transmite, sem precisar fazer login. Apenas quem iniciou vê Parar DJ para encerrar a transmissão. O áudio continua ao minimizar o painel ou trocar o layout da chamada.
5. Minimizar a janela dedicada esconde o Spotify na bandeja do sistema e mantém a reprodução e o DJ ativos. Clique no ícone “Spotify — Lira DJ” ou em “Abrir Spotify” no seu menu para reabrir. Use o X da janela ou “Fechar Spotify” nesse menu para parar o DJ, encerrar a reprodução e remover a janela e seu ícone. Essa ação fecha somente o navegador dedicado do player e mantém o login salvo. Parar o DJ mantém o Spotify aberto. Ao sair do Lira, a janela é devolvida ao navegador.

O login fica salvo no perfil local dedicado do navegador. O Lira não implementa autenticação própria do Spotify, não recebe a senha do usuário e não exige outra conta.

Entrar pelo navegador encerra somente o navegador dedicado que estava sob controle do Lira antes de abrir a janela normal. Um login já aberto em janela normal é preservado. É necessário parar o DJ antes de refazer o login. Os atalhos do player também abrem o navegador normal quando necessário e orientam concluir o login antes de transmitir. Uma música ou playlist selecionada é preservada até a conclusão. Os arquivos locais login-pending e login-confirmed registram apenas essa etapa, sem credenciais. A conclusão e o passo Concluir login são recuperados ao reabrir o painel ou reiniciar o aplicativo. Depois da conclusão, Trocar conta permite refazer o fluxo.

O estado é consultado ao abrir o painel, ao voltar ao Lira e a cada três segundos enquanto o painel estiver visível. Consultas lentas não se sobrepõem no mesmo painel, e respostas antigas não substituem o resultado de uma ação mais recente. Erros de abertura ou conclusão aparecem imediatamente no painel. A confirmação também é sincronizada entre o modal e o painel lateral. Parar DJ continua disponível durante uma transmissão.

Essa separação segue a [política de navegadores seguros do Google](https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers). A política proíbe direcionar autenticação para um navegador incorporado sob controle do aplicativo. A implementação anterior ativava depuração remota e encaixava a janela antes do login, condições incompatíveis com esse fluxo. O motivo exato de uma recusa individual do Google só pode ser confirmado com o login manual do usuário.

Antes de encaixar a janela do navegador, o Lira confirma que a página do Spotify tem conteúdo. Uma página inicial vazia recebe uma tentativa de recarregar o endereço solicitado. Se o carregamento continuar falhando, a abertura informa o erro e não inicia a captura DJ. Uma página do player que ainda exibe o botão de login também pede refazer o login. Páginas de autenticação do Google e do Spotify não são encaixadas; a abertura orienta usar Entrar pelo navegador e não consulta o conteúdo do formulário.

## Identificação e isolamento do áudio

A janela abre com um diretório de perfil próprio por instância do Lira. A identificação procura o processo Chrome/Edge que usa exatamente esse perfil, incluindo caminhos com espaços e aspas. O título da janela e o nome da música não são usados para escolher a fonte.

O encaixe e o redimensionamento consultam a área útil da janela diretamente no Windows, usando o contexto de escala da janela do Lira. Isso evita que o PowerShell, que inicia sem reconhecimento de DPI, aplique a escala do Windows novamente e deixe a página maior que a área visível. Mudanças de tamanho e deslocamentos entre monitores atualizam o encaixe. Enquanto uma atualização está em andamento, pedidos de redimensionamento são agrupados e o tamanho final é aplicado sem acumular operações antigas.

“Fechar Spotify” verifica que o processo corresponde ao player dedicado, libera a captura, informa ao Lira que o DJ terminou e solicita o encerramento pelo endereço local validado desse navegador. A janela e o ícone são removidos após o encerramento. Uma janela normal de login é preservada e uma falha mantém a bandeja disponível para tentar novamente.

A consulta ao Windows tem limite de 15 segundos, para incluir a inicialização do PowerShell e a busca dos processos. Uma consulta interrompida por tempo limite recebe uma segunda tentativa; outros erros são informados sem expor o comando interno. O log registra o código, a interrupção, o sinal e até 1.000 caracteres do erro retornado pelo processo.

A captura do Spotify usa `getDisplayMedia` com `suppressLocalAudioPlayback: true`, sem instalar drivers, extensões ou dispositivos virtuais. O seletor do navegador exige a escolha do usuário. Um Capture Handle temporário confirma que a fonte é a própria aba dedicada; outras abas, telas, fontes sem áudio e captura sem supressão local são recusadas. O áudio PCM estéreo em 48 kHz segue para a trilha do DJ. O compartilhamento de tela mantém seu capturador nativo.

O DJ pede dois canais e solicita cancelamento de eco, redução de ruído e ganho automático desativados ao criar a captura, para preservar a música. As opções de qualidade são preferências do navegador; a supressão local continua sendo conferida antes da transmissão. O Lira não chama `applyConstraints` novamente na trilha de áudio compartilhada: o Chromium recusa essa operação para fontes `DISPLAY_AUDIO_CAPTURE`, com o erro `Cannot satisfy constraints`. A trilha recebe `contentHint="music"` e os destinos de áudio mantêm os dois canais explicitamente. Os testes usam sinais diferentes à esquerda e à direita para verificar a separação antes da rede e simulam a recusa de reconfiguração para evitar regressão.

As ofertas e respostas das chamadas do DJ negociam Opus estéreo, frequência de reprodução de 48 kHz e limite de 256 kbit/s, com recuperação de perdas e sem DTX. A configuração é exclusiva do DJ e preserva os outros codecs. As chamadas de microfone mantêm sua configuração. Depois de uma alteração de qualidade, é necessário parar e iniciar novamente o DJ para renovar a captura e a negociação.

A reprodução PCM do DJ no Lira usa um AudioWorklet, no processamento de áudio separado da interface. Uma reserva de 240 ms é formada antes de tocar e após faltar áudio, para absorver atrasos curtos de entrega sem alternar som e silêncio a cada pacote. Lotes normais preservam todas as amostras e os canais. O buffer tem limite de um segundo; somente um acúmulo acima desse limite descarta áudio antigo para recuperar o tempo real. O compartilhamento de tela mantém seu caminho de baixa latência.

A captura na aba também usa AudioWorklet: cada quadro estéreo é convertido uma vez na thread de áudio e entregue em blocos de 2048 quadros. O processamento não depende dos callbacks de áudio da interface do Spotify. A aba guarda até dezesseis blocos (cerca de 683 ms). As consultas buscam os blocos disponíveis a cada 20 ms, descontando o tempo da resposta e sem sobrepor pedidos. Os testes simulam entrega atrasada na página, entrega em lotes a cada 213 ms, recuperação após interrupções, limite de acúmulo, cancelamento durante o carregamento e liberação dos AudioWorklets. Pausas superiores à reserva ainda podem interromper a reprodução; os testes simulados não substituem uma verificação auditiva autorizada.

Quando falta áudio ou é necessário descartar um acúmulo antigo, a reprodução faz uma transição de 128 quadros (aproximadamente 2,7 ms) para evitar mudanças instantâneas na amplitude. Essa transição atua apenas nas interrupções e na recuperação; durante a reprodução contínua, as amostras são preservadas.

Parar o DJ libera as trilhas e restaura a reprodução normal no navegador. Encerrar o compartilhamento pelo navegador, fechar a janela ou perder a conexão de captura encerra o DJ. A aba também libera a captura se deixar de receber consultas do Lira por cinco segundos.

Ao iniciar outra transmissão, o Lira traz a janela existente para frente. O painel apresenta apenas a transmissão DJ e os controles de volume, sem opções de Jam ou recomendações de faixas. O usuário controla a música na página oficial do Spotify.

## Controles no painel lateral

Todos os integrantes da sala veem controles de reprodução desenhados no Lira e atualizados com o estado da página do Spotify. Os botões anterior, reproduzir/pausar e próxima, além da barra de progresso, enviam as ações à janela dedicada. Aleatório e repetir não aparecem no painel. Os mesmos controles mantêm os nomes acessíveis fornecidos pela página. Os comandos dos demais integrantes são encaminhados a quem transmite, que os aplica no Spotify. O volume permanece individual.

O painel mostra o nome da música e o artista fornecidos pela página. A fila foi removida do painel e da leitura da página. Os controles acionam diretamente o botão identificado na página, mesmo quando a troca de faixa muda sua posição. A barra de progresso continua usando a posição atual da linha do tempo.

O navegador abre com comunicação local de depuração em uma porta aleatória, somente no perfil dedicado. O Lira lê a porta desse perfil e confere o identificador da instância antes de conectar; apenas a página oficial `https://open.spotify.com` pode fornecer o estado. São consultados os elementos de reprodução e os metadados da música, sem ler senha ou cookies. Não são feitas capturas de imagem nem alterações do tamanho da página para atualizar o painel.

É necessário fechar uma janela dedicada aberta antes da inclusão da comunicação local e abri-la novamente pelo Lira para habilitar os controles. Durante login, antes de selecionar uma música ou quando a página alterar sua estrutura, o painel informa que os controles estão indisponíveis; a captura de áudio continua independente. O estado é atualizado periodicamente enquanto o painel estiver aberto e o Lira estiver visível. Falhas temporárias preservam o último estado válido e os controles ausentes ficam desabilitados, mantendo o painel estável.

A captura requer Chrome ou Edge com suporte a supressão de áudio local e Capture Handle, instalados em uma localização padrão. O DJ do Spotify pode funcionar junto com o compartilhamento de tela e seu áudio: cada captura usa canais de dados, erros e encerramento separados. Parar uma captura mantém a outra ativa. O Lira não instala navegadores.

O volume de 0% a 200% e o mudo no Lira ajustam apenas a escuta local do participante DJ, inclusive para quem iniciou a transmissão. A trilha enviada à sala usa ganho de 100% e cada ouvinte controla seu próprio volume. O volume na página do Spotify continua fazendo parte da fonte capturada.

## Validação

Os testes usam lançadores, processos, seletor de captura e Web Audio simulados. Cobrem a supressão exigida, a identificação da aba, conversão PCM, encerramento e reprodução do DJ para o anfitrião. O teste da identificação no Windows substitui funções de sistema por dados de teste, sem consultar navegadores reais. Os testes não comprovam reprodução real do Spotify ou qualidade do áudio na chamada. A captura silenciosa ainda requer validação manual autorizada. Testes manuais pelo agente e abertura do app/navegador dependem de consulta prévia ao usuário.

O teste de redimensionamento usa janelas nativas temporárias ocultas, sem abrir o Lira ou um navegador. Reproduz a diferença de contexto DPI do PowerShell e confere o tamanho físico após o encaixe e após reduzir a janela. Os testes da bandeja cobrem encerramento, liberação da captura, preservação de outro processo ou da janela de login, falha com possibilidade de repetir e cancelamento de consultas/aberturas pendentes.

Referências da captura: [supressão local no Chrome](https://developer.chrome.com/blog/screen-sharing-improvements-in-chrome-109) e [identificação da aba com Capture Handle](https://developer.chrome.com/docs/web-platform/capture-handle).

Referências da qualidade: [indicação de conteúdo musical](https://www.w3.org/TR/mst-content-hint/) e [parâmetros de estéreo e bitrate do Opus](https://www.rfc-editor.org/rfc/rfc7587.html).

Referências da limitação de reconfiguração: [tipos de fonte aceitos pelo Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc) e [erro de applyConstraints no Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/mediastream/apply_constraints_processor.cc).

Referência da continuidade: [AudioWorklet e buffers de áudio no Chrome](https://developer.chrome.com/blog/audio-worklet-design-pattern/).

Referências: [perfis separados do Chromium](https://www.chromium.org/developers/creating-and-using-profiles/), [player web oficial do Spotify](https://support.spotify.com/br-pt/article/web-player-help/), [depuração em um perfil separado](https://developer.chrome.com/blog/remote-debugging-port) e [protocolo do Chrome DevTools](https://chromedevtools.github.io/devtools-protocol/).
