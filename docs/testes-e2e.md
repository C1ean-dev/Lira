# Testes E2E do Lira

## Percurso com dois usuários

Com as dependências do projeto instaladas, execute `npm run test:e2e`. A suíte
usa o Electron instalado pelo projeto e prepara o processo principal e o preload
do Lira ao iniciar. Não é necessário abrir manualmente o aplicativo nem usar
microfone, câmera e tela reais.

A suíte também faz parte de `npm run test:all` / `npm run teste:all`.

Por padrão, a execução não abre janelas. Para acompanhar as duas sessões na tela,
execute `npm run test:e2e:visible`. Esse atalho ativa a flag de ambiente
`LIRA_E2E_HEADED=1`; os cenários e o isolamento permanecem iguais. As janelas
fecham automaticamente ao terminar. Use Alt+Tab para alternar entre os usuários.

O teste inicia dois processos do Electron, Ana e Bruno, usando os mesmos
identificadores de instância do `electron:dual` e perfis independentes.
As ações passam pelos controles da interface: não há preenchimento direto dos
stores para criar espaços, adicionar amigos, entrar em salas ou iniciar mídia.
As observações adicionais são somente de leitura: estado recebido, estatísticas
WebRTC, quadros reproduzidos e níveis de áudio.

| Fluxo | Verificação |
| --- | --- |
| Inicialização | Dois processos Electron, cada um com seu perfil e preload do Lira. |
| Criar espaço | A criação de Ana aparece na lista pública de Bruno. |
| Privacidade | Tornar privado retira da lista; tornar público republica. |
| Convite por link | Cola o convite em Código da sala e confirma que os dois participantes anunciam a versão da compilação. |
| Chat e canais | Mensagens nos dois sentidos, criação de canal e entrega no canal novo. |
| Anexos | Envio e download; os bytes recebidos precisam coincidir com o arquivo original. |
| Amigos | Enviar solicitação, aceitar no outro perfil e trocar mensagem privada. |
| Quadro | Escrever, receber no outro perfil e preservar ao fechar e reabrir. |
| Editor e mapa | Arrastar para criar sala, sincronizar e entrar pelo mapa 2D. |
| Microfone | Receber áudio real e confirmar silêncio/retomada após mute/desmute. |
| Câmera | Receber RTP, reproduzir quadros e sincronizar ligar/desligar. |
| Ensurdecer | Silenciar a saída local de reprodução e restaurá-la. |
| Live | Vídeo e áudio recebidos, voz separada, mute independente, estatísticas do ALM (em tela cheia no modo visível) e encerramento. |
| Recuperação da live | Simula o diagnóstico de um decodificador H.264 com falha e confirma que o Electron reproduz o vídeo com VP8 em uma nova conexão real. |
| Supressor | Trocar DSP, RNNoise e DeepFilterNet reais; áudio decodificado e identificação explícita de fallback. |
| Configurar sala | Nome e boas-vindas chegam ao outro participante; chat da zona funciona. |
| Transcrições | O painel oferece início pelo mapa, sem abrir a grade da chamada. |
| Outro espaço | Bruno cria o próprio espaço e convida Ana pelo chat entre espaços. |
| Persistência | Recarregar, reabrir espaço salvo e recuperar sala e quadro. |
| Lista pública | Entrar pelo botão da sala publicada. |
| Sair | Desconectar, remover presença e encerrar chamadas. |

Os serviços de sinalização e publicação rodam em loopback. O cliente real de
publicação conversa com um relay de teste que implementa o contrato JSON; os
espaços não são anunciados nos servidores públicos. Cada processo tem um perfil,
diretório de trabalho e biblioteca próprios. O Lira grava os dados nativos nessas
pastas temporárias pelo mesmo caminho usado no desktop.
O teste guarda o texto copiado numa área de transferência isolada, para funcionar
sem foco na janela e preservar a área de transferência do sistema.

O microfone usa um WAV de tons gerado pelo teste. A câmera é um dispositivo
sintético do Electron. A live seleciona uma fonte de tela no aplicativo e recebe
uma imagem animada; o áudio simulado passa pela ponte de áudio do desktop.
O perfil de teste inicia com codificação por software para funcionar sem GPU.
ICE, DTLS, SCTP, Opus, RTP, processamento de áudio e reprodução são reais.
Nenhum desses resultados depende de capturar dispositivos pessoais.

## Relatórios e diagnóstico

Os resultados ficam em `.scratch/e2e-system/`:

- `report.json`: versão do Electron, processos, perfis e resultado das etapas; a execução para na primeira falha.
- `trace-0.zip` e `trace-1.zip`: ações, DOM e fontes dos dois perfis.
- `failure-0.png`, `failure-1.png` e `diagnostics-*.json`: contexto da falha.
- `microphone.wav`: entrada sintética reproduzível.

`report.json` registra o resultado de cada motor em `engines`. Um fallback para
RNNoise não é contabilizado como processamento ativo do DeepFilterNet. O teste
exige que a interface informe a troca e que a chamada continue recebendo áudio.

Para inspecionar: `npx playwright show-trace .scratch/e2e-system/trace-0.zip`.
Defina `LIRA_E2E_OUTPUT` para outro diretório de relatórios.

## Verificações complementares

O percurso não substitui os testes especializados:

| Comando | Cobertura adicional |
| --- | --- |
| `npm run test:core` | Casos de erro de P2P e mídia, moderação, permissões, reconexão, dispositivos e processamento. |
| `npm run test:core:browser` | Recuperação de chamadas e mídia real entre dois participantes. |
| `npm run test:navigation:browser` | Navegação e ações em diferentes larguras de tela. |
| `npm run test:whiteboard:browser` | Editor, desenho, persistência e assets locais do quadro. |
| `npm run test:transcription:map` | Iniciar no mapa e preservar ao fechar a chamada; reconhecimento simulado nessa suíte. |
| `npm run test:invites:electron` | Inicialização do desktop e convites pelo protocolo do sistema operacional. |
| `npm run test:sprites:electron` | Biblioteca, imagens e miniaturas no Electron. |
| `npm run test:noise:dynamics` | Ganho e limitação do DSP com sinais fracos e fortes no Electron. |
| `npm run test:transcription:electron` | Instalação do modelo e reinício offline; requer download inicial. |

O E2E local não comprova qualidade acústica/inteligibilidade, hardware físico,
conectividade de internet entre redes diferentes, disponibilidade dos servidores
públicos, captura nativa de áudio de processos do Windows ou autenticação real
no Spotify/OpenRouter. Essas verificações precisam dos ambientes e credenciais
correspondentes. Resumos com IA, pets com IA e serviços autenticados não devem
ser contabilizados como validados por este percurso.

As execuções permanecem locais, conforme a política do projeto; nenhum workflow
de publicação ou execução automática na nuvem é adicionado por esta suíte.

## Regressões encontradas durante a criação

O chat comum enviava campos opcionais com `undefined`. O BinaryPack do PeerJS
transforma esses valores em `null`, e a validação rejeitava mensagens válidas no
destinatário. A preparação dos pacotes agora omite campos ausentes antes do envio,
sem alterar `null` explícito ou dados binários. A correção vale também para a rede
de amigos e tem um teste com o codec real em `binaryTransport.test.ts`.

Também havia uma corrida quando dados chegavam antes do evento de abertura do
canal. A apresentação inicial podia ser marcada como enviada antes de o canal
aceitar escrita, deixando o outro lado sem participante ou mapa. A posse da
conexão é registrada imediatamente; a apresentação aguarda o estado aberto.
`dataConnectionOwnership.test.ts` reproduz essa ordem de eventos.
