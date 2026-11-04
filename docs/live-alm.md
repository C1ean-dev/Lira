# Distribuição da Live por árvore P2P

O apresentador coordena uma árvore ALM independente por Live, com até três filhos
por participante. Ele comprime a captura uma vez com WebCodecs. Cada retransmissor
remonta os blocos, encaminha os mesmos bytes comprimidos aos filhos e decodifica
somente para reprodução local. O canvas de reprodução gera uma trilha bruta;
essa trilha nunca alimenta o transporte nem outro encoder.

Para 12 participantes compatíveis, são 11 arestas: o apresentador envia até três
cópias e os demais retransmitem. A redução de upload do apresentador depende da
adesão à árvore; clientes incompatíveis e clientes em recuperação recebem o
vídeo RTP direto enquanto necessário. A voz permanece nas conexões existentes.
O áudio da Live é codificado uma vez em Opus e percorre a mesma árvore do vídeo.
Clientes sem suporte ao áudio sincronizado mantêm áudio e vídeo no RTP.

## Transporte e recuperação

- `AlmLive` usa sinalização confiável `LIVE_ALM` v2 pela sala. O host valida a origem
  antes de encaminhar; cada destinatário valida participantes da mesma zona,
  apresentador, sessão e aresta antes de aceitar sinalização ICE/SDP.
- Cada aresta usa `RTCDataChannel` nativo com `ordered: false` e
  `maxRetransmits: 0`. É SCTP/DTLS sobre ICE, com controle de congestionamento,
  e não UDP puro. STUN, Cloudflare e Metered configurados ficam disponíveis para
  ICE; estas conexões nativas não usam os prazos de escalonamento do PeerJS.
- A raiz prefere H.264 High, depois Baseline, depois VP8, consultando o suporte
  WebCodecs antes de criar o encoder. Hardware é uma preferência, não garantia.
  H.264 usa Annex B; os IDRs incluem os parâmetros necessários ao decoder.
  O encoder consulta os modos temporais L1T3, L1T2 e L1T1 em ordem de preferência.
- Quadros são fragmentados em mensagens de até 12.048 bytes. A remontagem tem
  limite de 4 MiB por quadro, 8 MiB no total e prazo de 180 ms. Quadros completos
  são reordenados em uma janela limitada antes da decodificação. Um temporizador
  vence no prazo de 180 ms, mesmo sem chegar outro pacote. Perdas pedem
  um IDR, com pedidos limitados a um por 500 ms; a raiz também gera IDR a cada
  segundo. Não há retransmissão dos blocos perdidos.
- Filas de envio são limitadas a 2 MiB por aresta. Uma aresta congestionada
  descarta o quadro inteiro sem bloquear os demais filhos.
- Pacotes Opus usam uma sequência separada. Se faltar um, a fila espera no máximo
  40 ms e continua no seguinte, sem redundância ou retransmissão.
- Falta de vídeo por 10 s, áudio indisponível na inicialização ou erro no decoder
  restaura RTP para aquele espectador.
  A renovação da intenção de assistir permite uma nova tentativa posterior.
- O vídeo RTP duplicado e o áudio original da Live só são substituídos após a
  confirmação de reprodução ALM. A voz auxiliar permanece independente.
  Clientes sem WebCodecs/captura de canvas usam RTP.

## Sincronização de áudio e vídeo

As origens de timestamp das trilhas capturadas podem diferir. `AlmCaptureClock`
normaliza os timestamps para o relógio monotônico do apresentador, preservando
os intervalos das amostras. O receptor agenda áudio e vídeo pelo mesmo relógio,
com uma margem mínima de 120 ms para absorver diferenças de chegada. Se a saída
sonora exigir mais tempo (por exemplo, Bluetooth), a margem cresce para as duas
mídias juntas; o vídeo não continua adiantado em relação ao áudio.

O áudio é reproduzido diretamente no AudioContext sincronizado, com a conversão
entre tempo de saída do dispositivo e tempo de apresentação. Não passa por uma
segunda cadeia de MediaStream → AudioContext → elemento de áudio. `RemoteAudio`
continua controlando volume, mute e saída; múltiplas visualizações compartilham
a reprodução em vez de somar cópias do som. O canvas publicado contém somente
vídeo, evitando que o navegador acrescente outra fila de áudio independente.

Ao detectar uma linha temporal atrasada, o receptor cancela os agendamentos das
duas mídias e as realinha juntas. Quadros antigos são descartados. O diagnóstico
`audioVideoSkewMs` mede os prazos internos de reprodução; não mede fisicamente
o atraso de um monitor, caixa de som ou dispositivo Bluetooth.

## Partial shedding

A árvore recebe contadores de bytes dos filhos a cada 2 s e calcula a vazão
entregue. Também observa filas, descartes e RTT do caminho ICE. Três amostras
consecutivas de pressão reduzem a capacidade anunciada do nó em um filho, com
intervalo mínimo de 10 s entre reduções. Cinco amostras saudáveis permitem
recuperar gradualmente uma vaga, respeitando o mesmo intervalo mínimo.

A vazão entregue é um limite inferior observado, não um teste de velocidade ou
uma medição garantida do upload máximo. Uma tela estática com pouco tráfego não
é classificada como falta de banda. A escolha de pais considera as medidas de
vazão/RTT entre candidatos com vaga, preservando os demais caminhos existentes.

Com `1 → [2,3,4]` e `2 → [5,6,7]`, a redução da capacidade de 2 para dois filhos
produz `2 → [5,6]` e `5 → [7]`. A escolha prefere um filho retido com vaga, exclui
descendentes do filho movido e respeita três filhos por nó. As demais arestas
mantêm seus identificadores e conexões.

Durante a mudança de pai, a aresta anterior permanece até a recepção e
decodificação de um IDR pelo novo caminho. Só então é fechada. Não são iniciadas
outras realocações enquanto houver uma troca pendente; trocas que excedem 12 s
retornam o espectador afetado ao RTP. Saídas reanexam os filhos sem reeleger toda
a árvore. Não há promoção de outro apresentador se a origem da captura sair.

## Qualidade e limites atuais

Além dos níveis da árvore, há SVC temporal quando o encoder o suporta. O mini
display (até 360 pixels de altura informada) solicita a camada temporal base;
tela cheia solicita todas as camadas. L1T3 permite, por exemplo, 15/30/60 FPS.
Não reduz a resolução espacial. Sem suporte a SVC, a representação permanece única.

Cada aresta transporta as camadas necessárias ao espectador e aos seus
descendentes. Um retransmissor com mini display pode receber todas as camadas
para atender um filho em tela cheia, decodificando localmente apenas a base.
Contadores por representação distinguem descarte intencional de camadas de perda
real de quadros. A alternância solicita IDR e mantém um único encoder de vídeo.
Mudanças de bitrate reconfiguram o encoder existente; trocar a captura ou mudar
suas dimensões/FPS cria uma nova sessão.

O relatório diagnóstico inclui `liveDistribution`, com topologia, codec, estado
das arestas, vazão entregue, RTT, SVC, sincronização e filas. Estatísticas RTP existentes não medem o vídeo dos
DataChannels. Eventos `alm-*` registram decisões e retornos ao RTP.

## Validação

Testes de árvore e pacotes:

```powershell
npx vitest run src/__tests__/p2p/almTree.test.ts src/__tests__/p2p/almPackets.test.ts src/__tests__/p2p/almCapacity.test.ts src/__tests__/media/almClock.test.ts
```

Teste local opt-in com WebRTC/WebCodecs reais e mídia sintética (sem microfone
ou captura da tela do usuário):

```powershell
$env:LIRA_RUN_BROWSER_TESTS = '1'
$env:LIRA_CHROMIUM_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test scripts/alm-live.browser.test.mjs
```

O teste verifica 11 espectadores com um encoder de vídeo, canais não ordenados sem
retransmissão, filtragem SVC temporal, bipes/flashes com atrasos distintos por
salto, shedding de 7 para 5 preservando 5 e 6, e saída de retransmissor.
É um teste de loopback em um navegador, não uma medição em 12 máquinas ou redes WAN.

Referências: [WebCodecs](https://www.w3.org/TR/webcodecs/),
[H.264 Annex B](https://www.w3.org/TR/webcodecs-avc-codec-registration/),
[DataChannels](https://www.w3.org/TR/webrtc/#rtcdatachannel).
