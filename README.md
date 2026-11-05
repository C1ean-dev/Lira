# Lira — Espaço Virtual de Colaboração e Chamadas P2P

[![React](https://img.shields.io/badge/React-18.3-20232A?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33.2-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Capacitor](https://img.shields.io/badge/Capacitor-7.6-119EFF?style=flat-square&logo=capacitor)](https://capacitorjs.com/)
[![Vite](https://img.shields.io/badge/Vite-6.1-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-387_Suites_|_3.550+_Tests-6E9F18?style=flat-square&logo=vitest)](https://vitest.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Mesh-333333?style=flat-square)](https://webrtc.org/)
[![WASM](https://img.shields.io/badge/WebAssembly-DeepFilterNet_&_RNNoise-blueviolet?style=flat-square)](https://github.com/Rikorose/DeepFilterNet)
[![AI Triage](https://img.shields.io/badge/AI_Triage-Gemini_&_OpenRouter-orange?style=flat-square)](https://github.com/C1ean-dev/Lira)
[![License](https://img.shields.io/badge/License-MIT-gray?style=flat-square)](LICENSE)

Ambiente virtual para coworking, reuniões e interação em tempo real, integrando interface gráfica em pixel art 2D a chamadas de voz e vídeo descentralizadas via WebRTC. O sistema conta com processamento avançado de áudio em tempo real (DeepFilterNet, RNNoise e DSP clássico), isolamento acústico por zonas, compartilhamento de tela em alta definição, editor interativo de espaços com drag-and-drop livre, chat com gaveta redimensionável, sistema de presença e notificações nativas.

---

## Conexões sem sinalização externa

O modo automático pode criar o espaço mesmo quando os servidores externos não
respondem. Dentro do espaço, use **Convites individuais** para trocar um convite e uma resposta,
ou ative **Rede local / IPv6** no desktop e compartilhe o convite com o endereço do
anfitrião. STUN e TURN ajudam quando disponíveis; a ausência de TURN não impede
a tentativa direta. Veja [como conectar e os limites de rede](docs/autonomous-connections.md).

### Convite direto por IPv6

Com IPv6 global nos dois computadores, o anfitrião abre **Convites individuais** dentro
do espaço, clica em **Ativar rede local / IPv6** e usa **Copiar convite IPv6**.
O outro jogador cola o convite em **Conectar → Código da sala**. A sinalização acontece no
computador do anfitrião, dispensando
servidores externos de sinalização e a troca manual de uma resposta.

O servidor embutido atende IPv4 e IPv6 e volta para IPv4 se IPv6 não estiver
disponível. Os convites incluem o endereço e a porta corretos; endereços IPv6
restritos à rede local são identificados separadamente. O IPv6 global e a porta
do anfitrião precisam estar alcançáveis: firewalls ou regras da operadora ainda
podem bloquear a conexão. O Lira não altera essas permissões automaticamente.
Se não funcionar, permanecem disponíveis o convite com resposta e os serviços
STUN/TURN configurados. Quando a rota IPv6 direta funciona, TURN não é necessário.

## Testes locais

Os testes são executados localmente para economizar a cota do GitHub Actions. O projeto possui **387 suítes de teste e mais de 3.550 testes automatizados** cobrindo P2P Mesh, processamento digital de áudio (DSP), motores neurais WASM, renderização de salas, componentes de UI, IA em cascata e integração Electron.
O CI/CD mantém os builds e a publicação de Windows e Android, sem executar testes.
Preparação inicial (Node 22.12+, Python 3 e Pillow):

```bash
npm ci
python -m pip install Pillow
npx playwright install chromium
```

Antes de publicar, execute todas as suítes com:

```bash
npm run teste:all
```

`npm run test:all` é um alias equivalente. O comando executa, em sequência,
os testes unitários, a migração da biblioteca (Python), chamadas e compartilhamento
de tela (Chromium), sprites (Electron) e transcrição (Electron). A execução para
na primeira falha. Os testes de Chromium e Electron abrem sessões automatizadas;
o teste de transcrição baixa o runtime e o modelo Whisper em um perfil temporário
e exige acesso à internet. Não é necessário gerar um build antes dos testes.

No comando completo, a saída mostra apenas alertas, erros e testes acima de
5000 ms (marcados com `[LENTO]`). Testes rápidos aprovados e resumos são ocultados.
Mensagens de console de testes unitários aprovados também são ocultadas, incluindo
erros simulados e falhas esperadas. Testes reprovados mantêm seus diagnósticos.

Para executar apenas a suíte unitária, use `npm test`.

## Recursos e Funcionalidades

### 1. Sistema de Áudio e Processamento Digital de Sinais (DSP)

- **Três Motores de Processamento Selecionáveis**:
  - **DSP Clássico**: Filtro passa-altas (80 Hz contra impactos na mesa), filtro high-shelf (6.500 Hz) e Noise Gate rápido com corte imediato de silêncio e compressor de pico.
  - **DeepFilterNet**: DeepFilterNet3/libDF em WebAssembly SIMD, com modelo incluído no pacote e processamento local a 48 kHz. Usa o mesmo AudioWorklet no desktop (Electron), Android (Capacitor/WebView) e web. Oferece a melhor qualidade, com maior custo de processamento e fallback para RNNoise; escolhas manuais são preservadas.
  - **RNNoise Neural**: Rápido e eficiente; é o padrão para quem ainda não escolheu um motor. A preferência manual por DeepFilterNet ou DSP clássico permanece salva, inclusive após fallback e reinício. Executa localmente via WebAssembly e AudioWorklet.
- **Fallback automático**: DeepFilterNet → RNNoise → DSP clássico em falha de carregamento, incompatibilidade de WASM/SIMD, erro de inferência ou sobrecarga persistente. O motor em uso aparece nos menus; a preferência continua salva e pode ser tentada novamente sem sair da chamada. Preferências e calibrações antigas de DSP suave migram para DeepFilterNet.
- **Modelo e licença**: utiliza `@lofcz/deepfilternet-web` 0.1.0, [port WASM de libDF](https://github.com/lofcz/DeepFilterNet/tree/main/packages/web) baseado em [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet), sob MIT ou Apache-2.0. O Vite inclui o WASM e os pesos nos assets da distribuição; não há download de modelo de CDN em produção.
- **Noise Gate Automático (nos três motores)**:
  - Aprende o ruído de fundo da sala em tempo real e abre o gate 6 dB acima dele (fecha em 3 dB), então um ventilador ou ar-condicionado ligado no meio da chamada passa a ser filtrado em poucos segundos.
  - A fala não é confundida com ruído: sons acima do nível de fechamento são ignorados, a menos que durem vários segundos sem nenhuma pausa (aí é a sala, não uma voz), e o aprendizado fica congelado enquanto o detector de voz do RNNoise ouve fala. Numa sala silenciosa o limiar nunca fica abaixo do mínimo de cada motor, para não cortar voz baixa.
  - O marcador "Corte atual" do medidor acompanha o limiar aprendido (lógica compartilhada em `src/media/autoGate.ts`).
- **Calibração Automática de Microfone**:
  - Medição acústica do ruído de fundo (*noise floor* em dBFS) a partir de amostras brutas com cálculo pela mediana da metade inferior, evitando distorções causadas por fala ou ruídos esporádicos.
  - Recomendação automática do motor mais adequado e do limiar numérico do Noise Gate.
- **Visualizador de Formas de Onda (Waveform)**:
  - Renderização vetorial SVG de alta resolução (64 a 75 barras simétricas) com gradiente contínuo e oscilação orgânica, reagindo em tempo real ao espectro vocal e aos picos de pressão sonora.
- **Comparação A/B/C Sincronizada**:
  - Exibição paralela das três faixas tratadas (DSP Clássico, DeepFilterNet e RNNoise) no mesmo espaço da interface.
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

### 7. Diagnóstico, Reporte de Problemas & Triagem Inteligente com IA

- **Modal Integrado "Reportar Problema"**:
  - Acessível diretamente pelo rodapé das configurações de áudio e tela de erro do aplicativo.
  - Coleta automática de telemetria técnica não sensível (versão do aplicativo, SO, versões de Electron/Chrome/Node e linha do tempo de execução).
  - Empacotamento inteligente de logs (`resumo.txt`, `lira-errors.log`, `call-debug.log`, `lira.log`), gerando Gist confidencial automaticamente.
  - Suporte a múltiplos anexos do usuário por drag-and-drop (capturas de tela, imagens e arquivos de log adicionais).
  - Envio anônimo transparente via backend Render (`lira-signaling`), permitindo que qualquer usuário abra issues sem necessidade de conta no GitHub ou CLI `gh`, com fallback seguro via navegador.
- **Triagem e Planejamento Arquitetural por IA em Cascata**:
  - Workflow no GitHub Actions disparado na abertura de issues que analisa o relato, logs de diagnóstico e contexto técnico.
  - Estratégia de contingência em 3 camadas (3 tentativas por camada com backoff):
    1. **Google Gemini (`gemini-3.8-flash`)**: Processamento primário gratuito via Google AI Studio.
    2. **DeepSeek V4.1 Flash (`deepseek/deepseek-v4.1-flash-1017`)**: Fallback automático no OpenRouter com roteamento dinâmico pelo provedor de menor preço (`sort: "price"`).
    3. **NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b:free`)**: Fallback de contingência final gratuito no OpenRouter.
  - Diagnóstico automatizado da causa raiz, evidências extraídas dos logs, plano de arquivos a modificar, estratégia de testes TDD e aplicação automática das labels canônicas (`ready-for-agent`, `needs-info`, `ready-for-human`, `wontfix`).

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
  - Os fluxos de áudio, vídeo e compartilhamento de tela preferem conexões diretas entre os participantes. Quando configurado e necessário para atravessar redes restritivas, um servidor TURN retransmite o tráfego WebRTC criptografado.
  - As conexões de mídia (`MediaConnection`) são estabelecidas sob demanda apenas entre participantes posicionados dentro do mesmo polígono de zona privada ou mesa.
  - Quando um participante sai da zona, todas as conexões de mídia com os membros daquela área são imediatamente fechadas (`call.close()`), liberando recursos de rede e processamento local.

### 2. Resolução Determinística de Conflitos de Chamada (Call Glare)

- **O Problema de Glare**: Em uma rede descentralizada, quando dois participantes entram simultaneamente na mesma zona acústica, ambos disparam uma oferta de conexão um para o outro (A disca B e B disca A). Sem tratamento, isso gera conexões duplicadas, consumo redundante de largura de banda e interrupções na reprodução de vídeo (`AbortError`).
- **Resolução Determinística**: O módulo `mediaCalls.ts` implementa o algoritmo `resolveCallGlare`. Ao detectar uma chamada concorrente, os identificadores de peer de ambos os lados são comparados lexicograficamente (`myId < remoteId`). A ligação originada pelo nó com o menor identificador prevalece, enquanto a concorrente é descartada de forma simétrica em ambos os clientes sem necessidade de troca de mensagens de controle adicionais.

### 3. Estabelecimento de Transporte, ICE, STUN e Fallback TURN

As conexões usam prioridade automática **P2P → Cloudflare → Metered**, com reinício
ICE na mesma conexão quando uma etapa falha. O backend emite credenciais Cloudflare
temporárias; o token administrativo fica somente no servidor. Configure
`CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` no Render. O cliente usa
`VITE_TURN_CREDENTIALS_URL` (padrão: `https://lira-signaling.onrender.com/turn/credentials`).
Consulte [configuração e fallback TURN](docs/call-relays.md) para implantação.

- **Coleta de Candidatos ICE sob Demanda (`iceCandidatePoolSize: 0`)**:
  - A coleta acompanha a negociação de cada transporte via trickle ICE do PeerJS. A pré-coleta foi desabilitada após reproduzir conexões que ficavam com ICE conectado, mas sem concluir a abertura do canal de dados ou da mídia.
- **Topologia de Travessia NAT (STUN/TURN)**:
  - O sistema tenta conexões diretas via candidatos locais (`host`) e reflexivos públicos (`srflx`) utilizando servidores STUN do Google e Twilio.
  - Para redes que impedem conexão direta (como certos NATs e firewalls), é necessário configurar um servidor TURN autenticado. Isso vale tanto para entrar no espaço pelo canal de dados quanto para chamadas de áudio, vídeo e compartilhamento de tela. Não há relay anônimo habilitado por padrão.
  - A entrada aguarda até 30 segundos pela conexão com o anfitrião, a partir do registro no servidor de sinalização. Falhas de transporte não promovem o visitante a anfitrião; a retomada automática continua disponível quando o servidor informa que o anfitrião está indisponível.

Para habilitar o último fallback, Metered, configure as três variáveis abaixo no ambiente de build (ou em `.env.local` no desenvolvimento). Para os instaladores Windows e Android, cadastre secrets do GitHub Actions com esses mesmos nomes antes de gerar uma nova versão:

| Variável | Valor |
| --- | --- |
| `VITE_TURN_URLS` | URLs do seu servidor separadas por vírgula, por exemplo `turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp` |
| `VITE_TURN_USERNAME` | Usuário autorizado pelo servidor TURN |
| `VITE_TURN_CREDENTIAL` | Credencial desse usuário |

No Metered, use as credenciais TURN da sua conta e copie os endereços de **Get credential → Show ICE Servers Array**, mantendo as opções UDP, TCP e TLS fornecidas pelo painel. O hostname depende do plano e da região; não substitua pelo hostname de um exemplo. O STUN do Google e do Twilio continua disponível na configuração compartilhada do Lira. Essas credenciais TURN de cliente podem ser usadas diretamente pelo aplicativo; a chave administrativa do Metered não faz parte dessa configuração. Veja o [guia do Metered](https://www.metered.ca/docs/turn-server-service/quickstart/).

O arquivo [`.env.example`](.env.example) contém as quatro rotas TURN do Metered usadas neste projeto, com usuário e senha vazios. Para configurar outro ambiente local:

1. Crie `.env.local` a partir do modelo, caso ainda não exista. No PowerShell:

   ```powershell
   if (-not (Test-Path -LiteralPath .env.local)) {
     Copy-Item -LiteralPath .env.example -Destination .env.local
   }
   ```

2. Preencha `VITE_TURN_USERNAME` com o `username` da credencial TURN e `VITE_TURN_CREDENTIAL` com o valor de `credential` fornecido pelo Metered. Confira também os hostnames de `VITE_TURN_URLS` no painel.
3. Reinicie o processo de desenvolvimento para carregar as variáveis. O arquivo `.env.local` já é ignorado pelo Git.

Para gerar os instaladores pelo GitHub Actions, cadastre `VITE_TURN_URLS`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL` como secrets do repositório. Os workflows de Windows e Android recebem os três valores na etapa que gera o aplicativo. O modelo `.env.example` mantém as credenciais vazias para poder ser versionado.

Sem esses valores, o aplicativo tenta P2P e Cloudflare. Se ambos estiverem indisponíveis, não haverá relay adicional. As configurações Metered são incorporadas ao aplicativo durante o build: use credenciais próprias para clientes, com limites de uso e rotação, e não coloque os valores no repositório. Alterar os secrets Metered exige gerar e distribuir novos instaladores.

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
  - `DeepFilterProcessor.ts`, `deepFilterAssets.ts` e `deepFilterWorkletSrc.js`: DeepFilterNet3 com carregamento local do WASM e proteção contra falhas/sobrecarga.
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

| Camada / Domínio | Tecnologias Principais | Descrição e Finalidade |
| :--- | :--- | :--- |
| **Interface do Usuário (UI/UX)** | React 18.3, TypeScript 5.7, TailwindCSS 3.4, Lucide Icons | Componentes declarativos, modais acessíveis, gavetas redimensionáveis, temas responsivos e tipagem estrita |
| **Motor de Renderização 2D** | HTML5 Canvas 2D Engine | Pixel art fluido a 60 FPS com dynamic viewport culling, ordenação por profundidade Y, paredes direcionais e static layer cache |
| **Plataformas Desktop & Mobile** | Electron 33, Capacitor 7 (Android), Web | Suporte multiplataforma (Windows Desktop com tray/notificações, Android nativo e Web) |
| **Build, Bundler & Ferramentas** | Vite 6.1, `vite-plugin-electron`, Node.js 22.12+, Python 3 | Empacotamento de alta performance, Hot Module Replacement (HMR) e automação de compilação |
| **Comunicação em Tempo Real** | WebRTC, PeerJS 1.5, WebSockets (`ws`) | Topologia híbrida descentralizada (estrela para estado/chat e malha direta P2P para mídia por zonas acústicas) |
| **Servidores & Relays de Rede** | Cloudflare TURN, Metered TURN, Servidor Render (`lira-signaling`) | Descoberta pública de salas, sinalização distribuída, emissão dinâmica de credenciais TURN e rota de reporte anônimo |
| **Processamento de Áudio & DSP** | Web Audio API (AudioWorklet), WebAssembly SIMD, C++ WASAPI | DeepFilterNet3 neural offline, RNNoise neural, DSP clássico adaptativo, auto noise gate e captura de processos sem eco |
| **IA Local & Transcrição** | Whisper local (`@huggingface/transformers 3.8.1`) | Transcrição e reconhecimento de voz executado localmente via pipeline offline |
| **Triagem & Resolução por IA** | Google Gemini (`gemini-3.8-flash`), DeepSeek V4.1 Flash, NVIDIA Nemotron 3 Ultra | Cascata inteligente em 3 camadas no GitHub Actions para diagnóstico, planejamento de arquitetura e triagem de issues |
| **Gerenciamento de Estado** | Zustand 5.0 | Stores atômicos desacoplados (`useGameStore`, `useMediaStore`, `useMapStore`, `useChatStore`, etc.) |
| **Testes Automatizados & Qualidade** | Vitest 4.1, Playwright 1.64, Node Test Runner, Python unittest | **387 arquivos de teste**, mais de **3.550 testes automatizados**, testes E2E em Chromium, testes Electron e benchmarks acústicos (MS-SNSD) |

---

## Execução e Desenvolvimento

### Pré-requisitos
- Node.js versão 22.12 ou superior.
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

Abre duas janelas do Electron, com perfis separados. Os três modos de desenvolvimento usam a porta 5173; encerre o modo atual antes de iniciar outro.

### 4. Testes Automatizados
```bash
npx vitest run
```

Para executar em modo interativo contínuo:
```bash
npx vitest
```

### 5. Verificação de Tipos TypeScript
```bash
npx tsc --noEmit
```

### 6. Compilação de Produção

- **Instalador Windows para o GitHub Releases**:
```bash
npm run build
```

O comando compila o capturador nativo, verifica os tipos, gera os processos do Electron em `out/` e o instalador em `release/`. O fluxo de GitHub Actions executa esse mesmo comando e publica o instalador no GitHub Releases a cada envio para `main`, ou quando acionado manualmente. Executar o comando localmente gera os arquivos em `release/`.

### 7. Logs e Relatórios de Erro

O app grava em `logs/` (desenvolvimento) ou em `%APPDATA%\lira\logs` (instalado) a linha do tempo de cada execução e um relatório estruturado por erro, com a pilha, o estado do app e o que aconteceu antes. Para ver os erros do dia agrupados:
```bash
node scripts/error-reports.js
```

Quem usa o app envia os logs pelo botão **Gerar arquivo de logs** (configurações de áudio e tela de erro), que cria um `.zip` na pasta Downloads. Para ler o zip recebido:
```bash
node scripts/error-reports.js --dir caminho/do/Lira-logs.zip
```

Os arquivos, os campos de um relatório e como registrar a partir do código estão em [docs/logs.md](docs/logs.md).

---

## Créditos dos dados de áudio

O Lira utiliza o [Microsoft Scalable Noisy Speech Dataset (MS-SNSD)](https://github.com/microsoft/MS-SNSD) nos testes e avaliações dos supressores de ruído, comparando a redução do ruído de fundo com a preservação da voz. A metodologia, os resultados e as instruções de reprodução estão em [docs/noise-suppression.md](docs/noise-suppression.md).

Crédito ao trabalho de Chandan K. A. Reddy e colaboradores:

```bibtex
@article{reddy2019scalable,
  title={A Scalable Noisy Speech Dataset and Online Subjective Test Framework},
  author={Reddy, Chandan KA and Beyrami, Ebrahim and Pool, Jamie and Cutler, Ross and Srinivasan, Sriram and Gehrke, Johannes},
  journal={Proc. Interspeech 2019},
  pages={1816--1820},
  year={2019}
}
```

As amostras seguem as [licenças dos datasets de origem descritas pelo MS-SNSD](https://github.com/microsoft/MS-SNSD#dataset-licenses).

---

## Licença

Este projeto é distribuído sob os termos da licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais informações.

