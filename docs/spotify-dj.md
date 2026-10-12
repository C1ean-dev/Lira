# Spotify no navegador e DJ

O Lira abre o site oficial do Spotify em uma janela dedicada do Google Chrome. Se o Chrome não estiver instalado, usa o Microsoft Edge. O navegador instalado no computador cuida da reprodução, como em uma visita normal ao Spotify. O Lira usa Electron padrão; não existe dependência da Castlabs nem etapa de assinatura EVS.

## Fluxo para o usuário

1. Entre em uma sala privada e clique em Transmitir DJ no painel Spotify DJ do Lira. Esse botão abre a janela dedicada do Spotify e inicia a captura de áudio para a chamada.
2. Faça login diretamente no Spotify com a própria conta.
3. Escolha suas músicas ou playlists e dê play na página oficial. O capturador nativo fornece a trilha de áudio do navegador ao participante DJ da chamada.
4. Use o volume do painel para ajustar a transmissão e Parar DJ para encerrá-la.
5. Fechar a janela dedicada também encerra o DJ. Parar o DJ mantém o Spotify aberto.

O login fica salvo no perfil local dedicado do navegador. O Lira não implementa autenticação própria do Spotify, não recebe a senha do usuário e não exige outra conta.

## Identificação e isolamento do áudio

A janela abre com um diretório de perfil próprio por instância do Lira. A identificação procura o processo Chrome/Edge que usa exatamente esse perfil, incluindo caminhos com espaços e aspas. O título da janela e o nome da música não são usados para escolher a fonte.

A captura nativa usa o identificador da janela desse processo e inclui sua árvore de processos de áudio. O navegador de uso diário e o processo do Lira ficam fora dessa árvore. Não existe alternativa automática para áudio da tela ou do sistema. O perfil é dedicado ao Spotify; o áudio transmitido pertence a esse processo de navegador.

Ao iniciar outra transmissão, o Lira traz a janela existente para frente. O painel apresenta apenas a transmissão DJ e os controles de volume, sem opções de Jam ou recomendações de faixas. O usuário controla a música na página oficial do Spotify.

A captura é para Windows e depende do capturador nativo já usado pelo projeto. Como existe um único capturador nativo, DJ e compartilhamento de tela com áudio são mutuamente exclusivos. Chrome ou Edge devem estar instalados em uma localização padrão. O Lira não instala navegadores.

## Validação

Os testes usam lançadores e processos simulados. O teste da identificação no Windows executa o script de consulta com funções de sistema substituídas por dados de teste, sem abrir ou consultar navegadores reais. Os testes não comprovam reprodução real do Spotify ou qualidade do áudio na chamada. O usuário confirmou o funcionamento manual do fluxo. Testes manuais pelo agente e abertura do app/navegador dependem de consulta prévia ao usuário.

Referências: [perfis separados do Chromium](https://www.chromium.org/developers/creating-and-using-profiles/) e [player web oficial do Spotify](https://support.spotify.com/br-pt/article/web-player-help/).
