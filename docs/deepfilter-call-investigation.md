# Investigação do DeepFilterNet na chamada e latência por etapa

Resultados de 28/10/2026, Windows / Electron 33.4.11 / Chromium 130.0.6723.191.
Branch: `codex/deepfilter-call-diagnostics`. Alterações restritas aos testes,
instrumentação e relatórios; os controles não mudam as preferências do produto.

## O que explica a grande queda do STOI

A medição inicial de 0,228 misturou a inteligibilidade com uma fase de forte
variação temporal. Comparando a saída local do DeepFilter com o áudio recebido
em janelas de 250 ms, encontramos atrasos que mudavam centenas de milissegundos
durante os mesmos cinco segundos de fala. Por exemplo, em `voice113-clean`,
as janelas bem correlacionadas passaram de aproximadamente 799 para 267 ms.
Um único deslocamento não alinha esse arquivo inteiro.

Os contadores do WebRTC confirmam aceleração do áudio para esvaziar o buffer.
No controle `defer-resume`, o receptor removeu aproximadamente 581 e 867 ms de
amostras durante as capturas, sem inserção por desaceleração. Isso é correção
temporal do receptor e não uma medição de quantas palavras se perderam.

Mantendo a chamada aberta por 15 segundos antes de reproduzir as mesmas falas
limpas, o STOI recebido do DeepFilter subiu para 0,922 no primeiro controle e
0,929 na rodada comparativa. O atraso mediano na rodada comparativa foi 228 ms,
com faixa de 205–235 ms e quatro atrasos mensuráveis em quatro capturas.
O antigo valor de 734 ms não descreve o regime estabilizado desta instalação.

Há também uma contribuição do gate para a perda de fala baixa com ruído:

| Sensibilidade DeepFilter, chamada estabilizada | STOI local médio | STOI recebido médio |
| --- | ---: | ---: |
| Automática, dois cenários de fala baixa | 0,665 | 0,614 |
| Manual 0%, gate sempre aberto, mesmos cenários | 0,804 | 0,793 |

O controle mostra que o gate agrava o problema. A diferença restante envolve
a supressão e os outros trechos da cadeia; abrir o gate não demonstrou que toda
a qualidade perdida é recuperada. Este teste não altera o gate padrão.

## Controles executados

| Controle | Resultado |
| --- | --- |
| Retirar o vídeo fictício | Não eliminou a piora; STOI limpo médio 0,322 |
| Suspender o relógio do motor até o modelo estar pronto | Não eliminou; STOI limpo médio 0,225 |
| Transmitir uma gravação já filtrada, sem executar o modelo | STOI limpo recebido 0,813, com transporte mediano de cerca de 0,7 ms |
| Aquecer o motor por 15 s antes de abrir a conexão | Melhorou para STOI limpo 0,790; ainda houve variação inicial do receptor |
| Deixar a chamada estabilizar por 15 s | STOI limpo 0,922 no controle, 0,929 na comparação |
| Abrir o gate na fala baixa com ruído | STOI recebido médio 0,614 → 0,793 |

As sondas encaminham os mesmos objetos de quadro Opus, sem editar o conteúdo.
Os quadros são pareados por timestamp RTP e conteúdo; os bytes também são
comparados quando disponíveis. Na rodada comparativa, todos os pares encontrados
tinham conteúdo idêntico. Atraso das sondas é saída codificada → callback da
chegada antes do jitter buffer. Inclui filas nativas e agendamento de callbacks,
além do transporte, e não usa RTT/2.

A investigação localiza o transiente na temporização inicial da cadeia e na
recuperação do buffer. A contribuição exata de compilação/aquecimento do WASM,
relógios dos AudioContexts e filas iniciais ainda não foi isolada. Os 15 segundos
são um controle de laboratório, não uma correção de inicialização do produto.

## Nova medição por etapa

Oito chamadas, 16 recepções: dois arquivos de fala limpa e dois de fala baixa
com teclado/ar-condicionado, com os três motores e um controle sem motor.
Sensibilidade automática e volume 100%. Ambos os participantes falam e recebem.
Cada chamada estabiliza por 15 s; o gravador mantém 3 s de cauda. Não houve
fallback dos motores neurais. Cada coluna abaixo resume quatro recepções.

| Etapa (ms) | DeepFilterNet | RNNoise | DSP clássico |
| --- | ---: | ---: | ---: |
| Entrada virtual / ponte MediaStream | 12,0 | 20,0 | 21,0 |
| Motor e seu grafo AudioContext | 127,7 | 64,0 | 30,6 |
| Codificação isolada | Não exposta | Não exposta | Não exposta |
| Mídia por pacote Opus, observada no RTP | 20,0 | 20,0 | 20,0 |
| Transporte entre callbacks das sondas | 0,6 | 0,6 | 0,6 |
| Permanência no jitter buffer | 70,1 | 49,7 | 30,0 |
| Grafo de volume/reprodução no receptor | 24,7 | 25,0 | 30,0 |
| Captura adicional por `captureStream()` | 0,0 | 0,0 | 0,0 |
| **Total do caminho de software capturado** | **228,0** | **166,4** | **121,2** |

São medianas por etapa; buffer é a mediana das médias por captura obtidas dos
contadores. **As linhas não formam uma soma exata:** correlação e contadores
usam bases temporais e amostras diferentes, e há trechos não isolados.

Definições e limites:

- Entrada: atraso observado na ponte do microfone virtual. Não mede microfone
  físico, driver de entrada ou captura acústica.
- Motor: diferença entre o stream local processado e a ponte virtual. Inclui
  filas/entradas/saídas do AudioContext do motor; não é apenas CPU da rede neural.
- Codificação: o navegador não expõe `totalEncodeTime` para áudio. Os 20 ms
  são a cadência de mídia dos pacotes, **não** uma medição do custo ou da latência
  completa do codificador. O rastreamento nativo foi tentado, mas não finalizou
  no caminho `contentTracing`; nenhum número de CPU foi inventado.
- Transporte: timestamps `performance.timeOrigin + performance.now()` das duas
  sondas no mesmo navegador. Medianas abaixo de 1 ms não representam internet.
- Buffer: diferença de `jitterBufferDelay` / diferença de
  `jitterBufferEmittedCount`, multiplicada por 1000. O contador já é acumulado
  por amostra; ele não deve ser dividido por duração da gravação.
- Reprodução: a tabela mede o grafo de volume antes da saída física. O navegador
  também informou **cerca de 41,9 ms de atraso estimado do dispositivo de áudio**
  via `media-playout`. Isso é relatório do navegador, não medição acústica,
  e não está somado ao total do caminho capturado.
- Captura: `captureStream()` de um elemento que recebe MediaStream reaproveitou
  o mesmo conteúdo, sem atraso adicional observável. **Zero não significa
  gravação física instantânea ou reprodução no ouvido com latência zero.**

STOI limpo recebido na rodada: DeepFilter 0,929; RNNoise 0,983; DSP 0,968.
Nos dois cenários com ruído e voz baixa: DeepFilter 0,614; RNNoise 0,924;
DSP 0,862. A entrada desses dois cenários tinha STOI 0,877.

## Artefatos e reprodução

As gravações originais e os controles ficam em `.scratch/noise-benchmark/`:

- `lira-conversation-2026-10-28/`: gravação inicial, preservada;
- `deepfilter-audio-only-diagnostic/`;
- `deepfilter-prerecorded-probed/`;
- `deepfilter-deferred-start-probed/`;
- `deepfilter-prewarm-model-probed/`;
- `deepfilter-settled-probed/`;
- `lira-stages-settled-2026-10-28/`: comparação por etapa;
- `deepfilter-open-gate-diagnostic/`.

Cada pasta contém `conversation-run.json`, `conversation-report.json`, os doze
canais float por chamada, WAVs alinhados e, nos controles novos,
`call-diagnostics.json` com tempos por janela, sondas e etapas.

```powershell
$env:LIRA_RUN_CONVERSATION_BENCHMARK='1'
$env:LIRA_CONVERSATION_PAIRS='0,1'
$env:LIRA_CONVERSATION_ENGINES='bypass,classic,rnnoise,deepfilter'
$env:LIRA_CONVERSATION_VARIANT='settled'
$env:LIRA_CONVERSATION_ENCODED_PROBE='1'
$env:LIRA_AUDIO_OUTPUT='.scratch/noise-benchmark/nova-medicao-por-etapas'
node --test scripts/conversation-latency.electron.test.mjs
```

Reanalisar gravações: manter os parâmetros de seleção e usar
`LIRA_AUDIO_REPLAY_ONLY=1` com a pasta existente. Diagnóstico de arquivos antigos:
`LIRA_DIAGNOSE_AUDIO_OUTPUT=<pasta>` e `node --test scripts/call-diagnostics.test.mjs`.

Fontes de definição: [WebRTC Statistics](https://www.w3.org/TR/webrtc-stats/),
[encoded transforms](https://www.w3.org/TR/webrtc-encoded-transform/),
[conteúdo de captureStream](https://w3c.github.io/mediacapture-fromelement/).
