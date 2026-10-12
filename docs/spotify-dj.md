# Spotify no navegador e DJ

O Lira abre o site oficial do Spotify em uma janela dedicada do Google Chrome. Se o Chrome não estiver instalado, usa o Microsoft Edge. O navegador instalado no computador cuida da reprodução, como em uma visita normal ao Spotify. O Lira usa Electron padrão; não existe dependência da Castlabs nem etapa de assinatura EVS.

## Fluxo para o usuário

1. Entre em uma sala privada e clique em Transmitir DJ no painel Spotify DJ do Lira. Esse botão abre a janela dedicada do Spotify e solicita o compartilhamento da aba no navegador.
2. Faça login diretamente no Spotify com a própria conta.
3. No seletor do navegador, selecione a própria aba do Spotify e marque Compartilhar áudio da aba. Escolha suas músicas ou playlists e dê play na página oficial. Enquanto o DJ estiver ativo, o navegador suprime a reprodução local; o som é ouvido pelo participante DJ da chamada, inclusive por quem iniciou a transmissão.
4. Use o volume do painel para ajustar a transmissão e Parar DJ para encerrá-la.
5. Fechar a janela dedicada também encerra o DJ. Parar o DJ mantém o Spotify aberto.

O login fica salvo no perfil local dedicado do navegador. O Lira não implementa autenticação própria do Spotify, não recebe a senha do usuário e não exige outra conta.

## Identificação e isolamento do áudio

A janela abre com um diretório de perfil próprio por instância do Lira. A identificação procura o processo Chrome/Edge que usa exatamente esse perfil, incluindo caminhos com espaços e aspas. O título da janela e o nome da música não são usados para escolher a fonte.

A captura do Spotify usa `getDisplayMedia` com `suppressLocalAudioPlayback: true`, sem instalar drivers, extensões ou dispositivos virtuais. O seletor do navegador exige a escolha do usuário. Um Capture Handle temporário confirma que a fonte é a própria aba dedicada; outras abas, telas, fontes sem áudio e captura sem supressão local são recusadas. O áudio PCM estéreo em 48 kHz segue para a trilha do DJ. O compartilhamento de tela mantém seu capturador nativo.

O DJ pede dois canais e solicita cancelamento de eco, redução de ruído e ganho automático desativados ao criar a captura, para preservar a música. As opções de qualidade são preferências do navegador; a supressão local continua sendo conferida antes da transmissão. O Lira não chama `applyConstraints` novamente na trilha de áudio compartilhada: o Chromium recusa essa operação para fontes `DISPLAY_AUDIO_CAPTURE`, com o erro `Cannot satisfy constraints`. A trilha recebe `contentHint="music"` e os destinos de áudio mantêm os dois canais explicitamente. Os testes usam sinais diferentes à esquerda e à direita para verificar a separação antes da rede e simulam a recusa de reconfiguração para evitar regressão.

As ofertas e respostas das chamadas do DJ negociam Opus estéreo, frequência de reprodução de 48 kHz e limite de 256 kbit/s, com recuperação de perdas e sem DTX. A configuração é exclusiva do DJ e preserva os outros codecs. As chamadas de microfone mantêm sua configuração. Depois de uma alteração de qualidade, é necessário parar e iniciar novamente o DJ para renovar a captura e a negociação.

A reprodução PCM do DJ no Lira usa um AudioWorklet, no processamento de áudio separado da interface. Uma reserva de 240 ms é formada antes de tocar e após faltar áudio, para absorver atrasos curtos de entrega sem alternar som e silêncio a cada pacote. Lotes normais preservam todas as amostras e os canais. O buffer tem limite de um segundo; somente um acúmulo acima desse limite descarta áudio antigo para recuperar o tempo real. O compartilhamento de tela mantém seu caminho de baixa latência.

A captura na aba também usa AudioWorklet: cada quadro estéreo é convertido uma vez na thread de áudio e entregue em blocos de 2048 quadros. O processamento não depende dos callbacks de áudio da interface do Spotify. A aba guarda até dezesseis blocos (cerca de 683 ms). As consultas buscam os blocos disponíveis a cada 20 ms, descontando o tempo da resposta e sem sobrepor pedidos. Os testes simulam entrega atrasada na página, entrega em lotes a cada 213 ms, recuperação após interrupções, limite de acúmulo, cancelamento durante o carregamento e liberação dos AudioWorklets. Pausas superiores à reserva ainda podem interromper a reprodução; os testes simulados não substituem uma verificação auditiva autorizada.

Quando falta áudio ou é necessário descartar um acúmulo antigo, a reprodução faz uma transição de 128 quadros (aproximadamente 2,7 ms) para evitar mudanças instantâneas na amplitude. Essa transição atua apenas nas interrupções e na recuperação; durante a reprodução contínua, as amostras são preservadas.

Parar o DJ libera as trilhas e restaura a reprodução normal no navegador. Encerrar o compartilhamento pelo navegador, fechar a janela ou perder a conexão de captura encerra o DJ. A aba também libera a captura se deixar de receber consultas do Lira por cinco segundos.

Ao iniciar outra transmissão, o Lira traz a janela existente para frente. O painel apresenta apenas a transmissão DJ e os controles de volume, sem opções de Jam ou recomendações de faixas. O usuário controla a música na página oficial do Spotify.

## Controles no painel lateral

Quem está transmitindo o DJ vê controles de reprodução desenhados no Lira e atualizados com o estado da página do Spotify. Os botões anterior, reproduzir/pausar, próxima, aleatório e repetir, além da barra de progresso, enviam os cliques à janela dedicada. Os mesmos controles mantêm os nomes acessíveis fornecidos pela página. Outros participantes da sala não controlam o navegador do DJ.

O painel mostra o nome da música e o artista fornecidos pela página. A fila foi removida do painel e da leitura da página. O aleatório aciona diretamente o botão identificado no Spotify, sem depender de coordenadas da área central. O indicador considera os atributos de estado e o rótulo da ação (por exemplo, “Desativar modo aleatório”).

O navegador abre com comunicação local de depuração em uma porta aleatória, somente no perfil dedicado. O Lira lê a porta desse perfil e confere o identificador da instância antes de conectar; apenas a página oficial `https://open.spotify.com` pode fornecer o estado. São consultados os elementos de reprodução e os metadados da música, sem ler senha ou cookies. Não são feitas capturas de imagem nem alterações do tamanho da página para atualizar o painel.

É necessário fechar uma janela dedicada aberta antes da inclusão da comunicação local e abri-la novamente pelo Lira para habilitar os controles. Durante login, antes de selecionar uma música ou quando a página alterar sua estrutura, o painel informa que os controles estão indisponíveis; a captura de áudio continua independente. O estado é atualizado periodicamente enquanto o painel estiver aberto e o Lira estiver visível. Falhas temporárias preservam o último estado válido e os controles ausentes ficam desabilitados, mantendo o painel estável.

A captura requer Chrome ou Edge com suporte a supressão de áudio local e Capture Handle, instalados em uma localização padrão. O fluxo continua exclusivo em relação ao compartilhamento de tela com áudio. O Lira não instala navegadores.

## Validação

Os testes usam lançadores, processos, seletor de captura e Web Audio simulados. Cobrem a supressão exigida, a identificação da aba, conversão PCM, encerramento e reprodução do DJ para o anfitrião. O teste da identificação no Windows substitui funções de sistema por dados de teste, sem consultar navegadores reais. Os testes não comprovam reprodução real do Spotify ou qualidade do áudio na chamada. A captura silenciosa ainda requer validação manual autorizada. Testes manuais pelo agente e abertura do app/navegador dependem de consulta prévia ao usuário.

Referências da captura: [supressão local no Chrome](https://developer.chrome.com/blog/screen-sharing-improvements-in-chrome-109) e [identificação da aba com Capture Handle](https://developer.chrome.com/docs/web-platform/capture-handle).

Referências da qualidade: [indicação de conteúdo musical](https://www.w3.org/TR/mst-content-hint/) e [parâmetros de estéreo e bitrate do Opus](https://www.rfc-editor.org/rfc/rfc7587.html).

Referências da limitação de reconfiguração: [tipos de fonte aceitos pelo Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc) e [erro de applyConstraints no Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/mediastream/apply_constraints_processor.cc).

Referência da continuidade: [AudioWorklet e buffers de áudio no Chrome](https://developer.chrome.com/blog/audio-worklet-design-pattern/).

Referências: [perfis separados do Chromium](https://www.chromium.org/developers/creating-and-using-profiles/), [player web oficial do Spotify](https://support.spotify.com/br-pt/article/web-player-help/), [depuração em um perfil separado](https://developer.chrome.com/blog/remote-debugging-port) e [protocolo do Chrome DevTools](https://chromedevtools.github.io/devtools-protocol/).
