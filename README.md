# Lira — Espaço Virtual de Colaboração e Chamadas P2P

[![React](https://img.shields.io/badge/React-18.3-20232A?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33.2-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.1-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-67_Suites_|_424_Tests-6E9F18?style=flat-square&logo=vitest)](https://vitest.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Mesh-333333?style=flat-square)](https://webrtc.org/)
[![License](https://img.shields.io/badge/License-MIT-gray?style=flat-square)](LICENSE)

Ambiente virtual para coworking, reuniões e interação em tempo real, integrando interface gráfica em pixel art 2D a chamadas de voz e vídeo descentralizadas via WebRTC. O sistema conta com processamento avançado de áudio em tempo real (DSP clássico, DSP suave e rede neural RNNoise), isolamento acústico por zonas, compartilhamento de tela em alta definição, editor interativo de espaços com drag-and-drop livre, chat com gaveta redimensionável, sistema de presença e notificações nativas.

---

## Recursos e Funcionalidades

### 1. Sistema de Áudio e Processamento Digital de Sinais (DSP)

- **Três Motores de Processamento Selecionáveis**:
  - **DSP Clássico**: Filtro passa-altas (80 Hz contra impactos na mesa), filtro high-shelf (6.500 Hz) e Noise Gate rápido com corte imediato de silêncio e compressor de pico.
  - **DSP Suave**: Expansor dinâmico descendente com transição suave (histerese ampla e release de 250 ms) que atenua o ruído contínuo preservando respirações, sussurros e consoantes finais.
  - **RNNoise Neural**: Redução de ruído por inteligência artificial executada localmente via WebAssembly e AudioWorklet, isolando os harmônicos da voz humana e eliminando ruídos complexos de fundo.
- **Calibração Automática de Microfone**:
  - Medição acústica do ruído de fundo (*noise floor* em dBFS) a partir de amostras brutas com cálculo pela mediana da metade inferior, evitando distorções causadas por fala ou ruídos esporádicos.
  - Recomendação automática do motor mais adequado e do limiar numérico do Noise Gate.
- **Visualizador de Formas de Onda (Waveform)**:
  - Renderização vetorial SVG de alta resolução (64 a 75 barras simétricas) com gradiente contínuo e oscilação orgânica, reagindo em tempo real ao espectro vocal e aos picos de pressão sonora.
- **Comparação A/B/C Sincronizada**:
  - Exibição paralela das três faixas tratadas (DSP Clássico, DSP Suave e RNNoise) no mesmo espaço da interface.
  - Sincronização automática do indicador de tempo de reprodução entre as trilhas, permitindo alternar entre os motores instantaneamente na mesma sílaba.
- **Isolamento de Áudio de Compartilhamento de Tela & Ducking Inteligente**:
  - Módulo nativo em C++ (WASAPI Loopback) para captura direta de áudio de janelas e processos de software.
  - Isolamento acústico automático das vozes dos participantes da conferência, impedindo realimentação (eco de retorno).
  - Atenuação automática (*ducking*) do áudio da tela durante a fala do transmissor.

### 2. Espaços Virtuais, Zonas Acústicas e Câmera

- **Isolamento por Zonas**: Conexão automática de áudio e vídeo restrita aos participantes posicionados dentro do perímetro da mesma sala ou mesa demarcada.
- **Sistema de Controle de Acesso e Trancamento**:
  - Fechamento de portas com controle de acesso para ocupantes autorizados.
  - Sinalização de batida na porta (*door knocking*) com notificação sonora e visual para os ocupantes.
- **Modos de Exibição de Chamada**:
  - **Mini-Call Flutuante**: Prévias de vídeo integradas ao mapa para colaboração contínua.
  - **Modo Grade (Lira Grid)**: Tela cheia com palco principal e barra lateral de participantes.
  - **Modo Foco (Spotlight)**: Destaque para palestrantes ou compartilhamento de tela.
- **Visualização Flexível do Mapa**:
  - **Modo Imersivo**: Renderizador Canvas 2D em 60 FPS com pixel art nítido, sombreamento e profundidade em Y.
  - **Modo Simplificado (Visão Vetorial)**: Visão esquemática estilo planta-baixa / minimapa para navegação rápida e baixo consumo de recursos.
  - **Zoom e Auto-ajuste**: Zoom contínuo na roda do mouse e botão de auto-ajuste (*Fit to Screen*) cobrindo 95%+ da tela.

### 3. Editor de Espaço Interativo & Estúdio de Criação

- **Movimentação por Arraste Direto (Drag-and-Drop)**:
  - Arraste livre de mobílias diretamente pelo mapa com preservação do ponto de apoio sob o cursor.
  - Alinhamento automático ao grid de 32x32 pixels ou posicionamento contínuo pixel a pixel segurando <kbd>Shift</kbd>.
  - Prevenção de teletransporte acidental: clicar no mapa vazio apenas desmarca a seleção.
  - Restrição de limites: cálculo automático que impede objetos de ultrapassarem as bordas da sala.
- **Seleção e Desmarcação Eficiente**:
  - Clique duplo ou novo clique no mesmo item (no mapa ou na paleta) desmarca a mobília.
  - Botão de fechar `(X)` no resumo inferior da paleta e suporte universal à tecla <kbd>Esc</kbd>.
- **Menu Contextual de Mobílias**:
  - **Rotação Rápida**: Tecla de atalho <kbd>R</kbd> para girar entre as 4 direções (Frente, Costas, Esquerda, Direita).
  - **Paleta Cromática**: Aplicação instantânea de 13 tons de tingimento preservando as texturas.
  - **Ajuste Fino**: Deslocamento ortogonal via setas direcionais do teclado (<kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>).
  - **Edição no Estúdio**: Atalho direto para editar a peça no Estúdio de Criação.
- **Pintura e Demarcação Contínua**:
  - Pintura de pisos e paredes por arrasto contínuo do mouse.
  - Preenchimento total de salas com <kbd>Shift</kbd> + Clique.
  - Suporte completo a **Paredes Direcionais** com profundidade e oclusão de avatares.
  - Desenho e redimensionamento de zonas acústicas privadas por caixa delimitadora elástica.
- **Estúdio de Criação de Sprites**:
  - Importação de imagens (PNG, JPG) com recorte inteligente, remoção de fundo e transparência.
  - Composição em camadas, espelhamento e máscaras de colisão personalizadas.

### 4. Comunicação, Chat Drawer e Mensagens Diretas

- **Gaveta de Chat Redimensionável**:
  - Arraste interativo da borda direita com alça de toque e destaque visual (*glow* suave ao interagir).
  - Divisor interno ajustável entre lista de canais/conversas e o fluxo de mensagens.
  - Botão de maximizar/restaurar em tela cheia no cabeçalho.
  - Persistência automática das dimensões no `localStorage`.
- **Transferência Direta de Arquivos P2P**:
  - Compartilhamento de arquivos diretamente pela conexão WebRTC sem limites de servidores intermediários.
  - Fragmentação em blocos (*chunking*) com barra de progresso em tempo real e verificação de integridade.
- **Mensagens Diretas e Chat da Sala**:
  - Conversas individuais privadas e chat geral da sala com formatação de texto e timestamp.

### 5. Presença, Status, Notificações Nativas e Companheiros

- **Detecção de Ausência (AFK)**:
  - Transição automática para o modo ausente após inatividade do mouse e teclado.
  - Restauração instantânea do status ativo ao interagir novamente.
  - Opção de ausência manual permanente (não sobrescrita pelo detector automático).
- **Notificações Nativas do Windows & Bandeja**:
  - Notificações do sistema operacional para menções, mensagens diretas e batidas na porta quando a janela está em segundo plano.
  - Integração com a bandeja do sistema (*System Tray*) para manter o app ativo sem ocupar a barra de tarefas.
- **Efeitos Sonoros Sintetizados**:
  - Notificações acústicas sintetizadas em tempo real via Web Audio API (sem dependência de arquivos externos de áudio).
- **Telemetria de Qualidade da Rede**:
  - Monitoramento em tempo real de latência (RTT em ms), variação de atraso (*jitter*) e perda de pacotes.
- **Mascotes Interativos (Pets)**:
  - Companheiros animados que seguem o avatar pelo mapa com algoritmo de trilha suave e desvio de obstáculos.

### 6. Compartilhamento de Tela em Alta Resolução

- **Seleção de Monitores e Janelas**: Captura de telas completas ou aplicativos específicos (editores de código, navegadores, softwares de design).
- **Perfis de Taxa de Quadros e Resolução**:
  - 720p a 30 FPS (5.000 kbps) e 60 FPS (6.000 kbps).
  - 1080p a 30 FPS (7.000 kbps) e 60 FPS (8.000 kbps), otimizado para legibilidade de texto e código.
- **Visualizador Imersivo**: Interface com controles auto-ocultáveis e suporte a atalhos de teclado.

---

## Funcionamento da Conexão P2P (WebRTC)

O sistema adota uma arquitetura híbrida descentralizada, combinando topologia em estrela para controle de estado da sala e topologia em malha (*mesh*) dinâmica para tráfego de mídia em tempo real:

```
[Cliente A] <====== Data Channel ======> [Host da Sala / Superpeer] <====== Data Channel ======> [Cliente B]
    ||                                                                                                  ||
    || (Entram na mesma Zona Privada)                                                                  ||
    ╚════════════════════════════════ Media Stream Direto (P2P Mesh) ═══════════════════════════════════╝
```

### 1. Topologia Híbrida: Estado vs. Mídia

- **Canal de Dados e Estado (Topologia em Estrela / Superpeer)**:
  - Ao entrar em uma sala, o primeiro participante registra o identificador de host (`lira-[CÓDIGO]-host`).
  - Os demais clientes conectam-se ao Host por meio de canais de dados seguros (`RTCDataChannel` via PeerJS) com entrega ordenada (`ordered: true`).
  - O Host centraliza a retransmissão de coordenadas de movimento dos avatares, mensagens de chat, alterações no mapa em tempo real e sincronização de permissões administrativas.
- **Mídia por Zonas Acústicas (Topologia em Malha Direta)**:
  - Os fluxos de áudio, vídeo e compartilhamento de tela não passam pelo Host nem por servidores intermediários, garantindo tráfego direto ponto a ponto com latência mínima e privacidade ponta a ponta.
  - As conexões de mídia (`MediaConnection`) são estabelecidas sob demanda apenas entre participantes posicionados dentro do mesmo polígono de zona privada ou mesa.
  - Quando um participante sai da zona, todas as conexões de mídia com os membros daquela área são imediatamente fechadas (`call.close()`), liberando recursos de rede e processamento local.

### 2. Resolução Determinística de Conflitos de Chamada (Call Glare)

- **O Problema de Glare**: Em uma rede descentralizada, quando dois participantes entram simultaneamente na mesma zona acústica, ambos disparam uma oferta de conexão um para o outro (A disca B e B disca A). Sem tratamento, isso gera conexões duplicadas, consumo redundante de largura de banda e interrupções na reprodução de vídeo (`AbortError`).
- **Resolução Determinística**: O módulo `mediaCalls.ts` implementa o algoritmo `resolveCallGlare`. Ao detectar uma chamada concorrente, os identificadores de peer de ambos os lados são comparados lexicograficamente (`myId < remoteId`). A ligação originada pelo nó com o menor identificador prevalece, enquanto a concorrente é descartada de forma simétrica em ambos os clientes sem necessidade de troca de mensagens de controle adicionais.

### 3. Estabelecimento de Transporte, ICE, STUN e Fallback TURN

- **Pool de Candidatos Antecipado (`iceCandidatePoolSize: 4`)**:
  - Candidatos ICE são coletados previamente antes do início da chamada. Isso elimina o atraso de 500 ms a 2.000 ms nas primeiras conexões WebRTC, evitando atraso ou corte.
- **Topologia de Travessia NAT (STUN/TURN)**:
  - O sistema tenta conexões diretas via candidatos locais (`host`) e reflexivos públicos (`srflx`) utilizando servidores STUN do Google e Twilio.
  - Para ambientes com restrições severas de rede (NAT simétrico, firewalls corporativos ou redes móveis restritivas), o sistema conta com servidores TURN (OpenRelay Metered nas portas 80 e 443) como camada de contingência (*relay*). A rota de relay só é selecionada caso o roteamento direto seja inviável.
- **Otimização de Portas UDP (`max-bundle` e `rtcp-mux`)**:
  - Todas as faixas de áudio, vídeo e mensagens de controle RTCP são multiplexadas em uma única porta UDP compartilhada por sessão, minimizando o número de portas abertas na tabela NAT do roteador.

### 4. Gerenciamento Adaptativo de Buffer de Jitter (Dynamic Buffer)

- O `DynamicBufferManager` monitora continuamente os parâmetros de qualidade da conexão (RTT, variação de atraso/jitter e taxa de perda de pacotes).
- **Tratamento Diferenciado por Tipo de Mídia**:
  - **Áudio Vocal**: Prioriza fluidez conversacional. Em conexões estáveis, o *playout delay* opera em 1 ms; em redes com alta oscilação de pacotes, é limitado a no máximo 500 ms, evitando atrasos que levam participantes a falarem simultaneamente.
  - **Vídeo e Compartilhamento de Tela**: O buffer se adapta entre 100 ms e 500 ms para absorver oscilações de quadros e manter a taxa contínua de 60 FPS sem congelamentos visíveis.

### 5. Eleição de Host e Recuperação de Falhas (Failover)

- **Detecção de Queda de Conexão**: O sistema executa um ciclo de heartbeat a cada 2 segundos. Se um peer não responder por mais de 10 segundos (`peerLastSeen`), sua conexão é encerrada e seus recursos são liberados.
- **Autohospedagem e Superpeer**: Caso o Host original sofra desconexão inesperada, os clientes restantes detectam a ausência de sinalização e podem assumir automaticamente o papel de coordenação da sala ou transferir a liderança para o participante de melhor rota e menor ping, preservando a continuidade da sessão para os demais membros.

---

## Arquitetura do Sistema

O projeto é estruturado segundo princípios de modularidade e separação de responsabilidades:

- **Motor de Renderização (`src/engine/rendering/`)**:
  - `floorRenderer.ts`: Renderização de pisos nativos e texturas personalizadas.
  - `wallRenderer.ts`: Paredes estruturais e direcionais com iluminação temática.
  - `zoneRenderer.ts`: Delimitação de zonas acústicas privadas.
  - `furnitureRenderer.ts`: Renderização e profundidade de mobílias e sprites compostos.
  - `worldRenderer.ts`: Coordenação de viewport, culling de tiles, destaque de seleção e ordenação por profundidade Y.
  - `staticLayerCache.ts`: Cache de camadas estáticas para renderização de alta performance a 60 FPS.
- **Áudio e Processamento de Sinais (`src/media/`)**:
  - `NoiseSuppressor.ts`: Implementação do motor DSP Clássico e cadeia de filtros Web Audio.
  - `SoftDspProcessor.ts`: Implementação do motor DSP Suave com expansor descendente.
  - `RnnoiseProcessor.ts`: Gerenciamento do ciclo de vida do worklet neural em WebAssembly.
  - `MicCalibrator.ts`: Medição acústica, cálculo de mediana de ruído e geração de amostras offline.
  - `audioBufferUtils.ts`: Codificação WAV PCM 16-bit, renderização offline e extração de waveforms.
  - `CallAudioIsolator.ts`: Isolamento de áudio de processos e prevenção de realimentação em chamadas.
  - `hardwareCodec.ts`: Suporte e negociação de aceleração por hardware (H.264/VP9/AV1).
- **Rede e Conectividade P2P (`src/p2p/`)**:
  - `PeerManager.ts`: Inicialização, heartbeat e coordenação de nós PeerJS.
  - `mediaCalls.ts`: Sinalização e negociação de canais WebRTC de áudio, vídeo e tela.
  - `messageHandlers.ts`: Protocolo binário/JSON de sincronização de estado, posições e eventos.
- **Serviços e Estado (`src/services/` e `src/store/`)**:
  - `idleManager.ts`: Rastreamento de inatividade e controle de ausência (AFK).
  - `trayManager.ts`: Integração com a bandeja do sistema no Electron.
  - `notificationService.ts`: Notificações nativas do Windows e síntese de áudio.
  - `useMapStore.ts`, `useChatStore.ts`, `useGameStore.ts`, `useCustomAssetsStore.ts`: Estado reativo centralizado via Zustand.
- **Camada Nativa Desktop (`native/` e `electron/`)**:
  - `native/process-audio-capture/`: Módulo em C++ para captura WASAPI Loopback em nível de processo no Windows.
  - `electron/main.ts`: Janela principal, inicialização de binários nativos e manipulação de fontes de captura de tela.

---

## Tecnologias Utilizadas

| Camada | Tecnologia |
| :--- | :--- |
| **Interface do Usuário** | React 18, TypeScript, TailwindCSS, Lucide Icons |
| **Plataforma Desktop** | Electron 33 |
| **Build & Bundler** | Vite 6 |
| **Comunicação em Tempo Real** | WebRTC, PeerJS |
| **Gerenciamento de Estado** | Zustand |
| **Processamento de Áudio** | Web Audio API, WebAssembly (@jitsi/rnnoise-wasm), WASAPI C++ |
| **Testes Automatizados** | Vitest (67 arquivos de teste, 424 testes unitários) |

---

## Execução e Desenvolvimento

### Pré-requisitos
- Node.js versão 18 ou superior.
- Git instalado.
- Visual Studio C++ Build Tools (necessário apenas para compilar o módulo nativo de captura de áudio em ambiente Windows).

### 1. Obtenção do Código
```bash
git clone https://github.com/C1ean-dev/Lira.git
cd Lira
```

### 2. Instalação das Dependências
```bash
npm install
```

### 3. Modo Desenvolvimento

- **Interface Web (Navegador)**:
```bash
npm run dev
```

- **Aplicação Desktop (Electron)**:
```bash
npm run electron:dev
```

- **Sessão Dupla para Testes P2P (Dois clientes simultâneos)**:
```bash
npm run electron:dual
```

### 4. Testes Automatizados
```bash
npm test
```

Para executar em modo interativo contínuo:
```bash
npm run test:watch
```

### 5. Verificação de Tipos TypeScript
```bash
npm run build
```

### 6. Compilação de Produção

- **Bundle Web e Electron**:
```bash
npm run build
```

- **Instalador Desktop (.exe)**:
```bash
npm run electron:build
```

### 7. Logs e Relatórios de Erro

O app grava em `logs/` (desenvolvimento) ou em `%APPDATA%\lira\logs` (instalado) a linha do tempo de cada execução e um relatório estruturado por erro, com a pilha, o estado do app e o que aconteceu antes. Para ver os erros do dia agrupados:
```bash
npm run logs:errors
```

Quem usa o app envia os logs pelo botão **Gerar arquivo de logs** (configurações de áudio e tela de erro), que cria um `.zip` na pasta Downloads. Para ler o zip recebido:
```bash
node scripts/error-reports.js --dir caminho/do/Lira-logs.zip
```

Os arquivos, os campos de um relatório e como registrar a partir do código estão em [docs/logs.md](docs/logs.md).

---

## Licença

Este projeto é distribuído sob os termos da licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais informações.
