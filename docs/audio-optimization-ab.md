# Otimizações de áudio: medições antes/depois

Referência de código: `01c4ce0e2ccf81c0d15b6ace1994c1b2e8a6c126`.
As variantes foram compiladas de snapshots imutáveis de fonte no mesmo Electron,
com os arquivos MS-SNSD verificados por hash, volume idêntico e sem microfone físico.
As chamadas usaram áudio mais vídeo desativado, Opus a 48 kHz, aquecimento com áudio
de seis segundos e ordem alternada. Nenhum teste pesado executou em paralelo às
gravações. Os cálculos e testes unitários só executaram depois de encerradas as capturas.

O pareamento usa arquivo, direção, repetição e versão. Médias de latência usam
somente pares em que ambas as versões tiveram atraso mensurável. STOI mantém os
casos de perda de voz, inclusive zeros. Cada comparação contém dois locutores;
não deve ser generalizada para todos os dispositivos, redes e tipos de voz.

## Triagem dos motores sem transporte WebRTC

Oito arquivos do perfil `validation`, passando pelos grafos reais:

| Variante | Latência média ms | STOI limpo | STOI com ruído | Perda de voz % |
| --- | ---: | ---: | ---: | ---: |
| DeepFilterNet atual | 137,75 | 0,930 | 0,668 | 17,65 |
| DeepFilterNet sem gate extra | 155,83 | 0,978 | 0,840 | 13,91 |
| RNNoise atual | 81,81 | 0,996 | 0,924 | 0,134 |
| RNNoise interactive | 82,90 | 0,996 | 0,923 | 0,194 |

Essa triagem tinha ordem fixa e uma captura por arquivo: serviu para selecionar
hipóteses, não para concluir ganhos de latência. O gate aberto diminuiu a atenuação
do ruído no trecho final de aproximadamente 86 para 31 dB; preservou mais fala,
mas não produz o mesmo silêncio artificial do gate.

## DeepFilterNet: gate e inferência fora da rotina de áudio

A medição de inferência original usou relógio `Date.now`, com resolução inteira
de milissegundos: p95 aproximadamente 2 ms e p99 entre 2 e 3 ms, com um pico de
23 ms em uma captura. São tempos de parede, incluindo escalonamento, não apenas
CPU da rede neural. O trabalho síncrono compete com os blocos de áudio de 128
amostras (2,67 ms a 48 kHz).

O protótipo Worker com fila de 20 ms apresentou underrun e foi rejeitado. Com
40 ms, a matriz fatorial completa passou: quatro cenários pareados de dois
locutores, duas repetições e quatro condições, totalizando 32 chamadas/64 direções.

| Condição | Total remoto pareado ms | STOI limpo recebido | STOI com ruído recebido | STOI com ruído local |
| --- | ---: | ---: | ---: | ---: |
| Referência síncrona com gate | 249,16 | 0,732 | 0,403 | 0,642 |
| Somente gate aberto | 256,13 | 0,531 | 0,458 | 0,824 |
| Somente Worker | 200,05 | 0,936 | 0,690 | 0,643 |
| Worker + gate aberto | 199,65 | 0,966 | 0,794 | 0,828 |

As latências da tabela usam os 14 pares mensuráveis em todas as condições. As
qualidades usam as 16 capturas por condição. O gate sozinho melhora a fala local,
mas não resolve a degradação temporal no receptor. A combinação reduziu o custo
local pareado de 122,81 para 102,86 ms, e o total em 49,52 ms (19,9%). As duas
latências indisponíveis da referência ficaram mensuráveis na combinação.

O primeiro protótipo usava memória compartilhada e exigia isolamento de origem.
A alternativa por mensagens com fila de 40 ms passou no teste curto, mas apresentou
underrun na validação prolongada e também foi rejeitada. Esses resultados positivos
do protótipo não são os números finais da implementação de produção.
A implementação final usa `MessageChannel` direto entre Worker e AudioWorklet,
sem memória compartilhada, sem encaminhar PCM pela thread da interface e sem
modificar a política de segurança das páginas. A fila e o estoque de buffers são
limitados; falta de áudio, excesso de fila e falha do Worker acionam o tratamento
de falhas existente. O Worker é encerrado no descarte ou cancelamento do grafo.
Se a criação do Worker não for suportada, permanece o backend síncrono.

O gate manual e o indicador de atividade permanecem funcionais: desativar o gate
extra automático não torna o indicador de fala permanentemente ativo.

### Resultado final do código de produção, fila limitada de 80 ms

Antes/depois alternado em 16 chamadas, 32 direções, quatro cenários, dois
locutores e duas repetições. Sem memória compartilhada e sem cabeçalhos de
isolamento. Todas as capturas candidatas confirmaram Worker ativo, sem fallback.

| Métrica | Referência original | Implementação final |
| --- | ---: | ---: |
| Custo local médio pareado ms | 119,33 | 141,57 |
| Total remoto médio pareado ms | 278,64 | 238,61 |
| STOI limpo recebido | 0,737 | 0,957 |
| STOI com ruído recebido | 0,365 | 0,801 |
| STOI com ruído local | 0,642 | 0,830 |
| Perda de voz pelo critério do benchmark % | 30,31 | 12,77 |
| Latências mensuráveis | 14/16 | 16/16 |

O ganho de 40,03 ms no total remoto (14,4%) compensa o custo local adicional de
22,24 ms. A margem maior é um compromisso explícito de estabilidade: não foi
apresentada como redução do tempo de inferência. As latências usam os mesmos 14
pares válidos, enquanto o STOI inclui todas as 16 capturas e a fala perdida.
O buffering médio informado pelo receptor caiu de 291,37 para 33,12 ms; os
contadores e atrasos de forma de onda têm bases diferentes e não devem ser somados.

A execução a partir de arquivos locais do Electron também passou, com Worker
ativo obrigatório: quatro arquivos `smoke`, STOI limpo 0,994 e com ruído 0,911.
Essa rodada é uma verificação de compatibilidade adicional, não a referência
usada para calcular os ganhos acima.

## RNNoise interactive: não mantido

A/B com quatro cenários, dois locutores e duas repetições, em dois lotes:

| Métrica | Antes | Interactive |
| --- | ---: | ---: |
| Custo local médio ms | 65,77 | 61,69 |
| Total remoto médio ms | 183,10 | 155,82 |
| STOI limpo recebido | 0,976 | 0,982 |
| STOI com ruído recebido | 0,915 | 0,905 |

O navegador reduziu a latência-base informada de 21,33 para 10,67 ms. O ganho de
27,29 ms no total veio acompanhado de queda média de 0,00965 no STOI com ruído,
acima da tolerância de regressão média de 0,005 já usada pelo projeto. Não foi
mantida a troca de `latencyHint` do RNNoise. Um lote adicional interrompido ao abrir
a reprodução foi descartado integralmente; apenas sua repetição completa entrou
nos números. O encerramento do Electron passou a ter limite e a limpeza temporária
tolera o bloqueio transitório do arquivo Cookies sem ocultar erros de captura.

## Feedback de amostras reconstruídas no buffer: não mantido

O teste de comportamento reproduziu o alvo caindo de 62 para 52 ms durante
reconstrução de voz; a candidata manteve 62 ms e só recuperou após quatro leituras
saudáveis. Na validação real, ambos os lados receberam as mesmas pausas controladas
de 90 ms a cada 25 frames recebidos, com o alvo inicial de recuperação em 60 ms.
Essas pausas são instrumentação de teste, não uma simulação completa de internet.

| Métrica | Antes | Feedback adicional |
| --- | ---: | ---: |
| Total remoto médio ms | 372,42 | 376,14 |
| STOI limpo recebido | 0,961 | 0,953 |
| STOI com ruído recebido | 0,931 | 0,913 |
| Perda de voz % | 0,783 | 0,336 |
| Buffer de recepção informado ms | 239,36 | 239,41 |

Houve melhora no indicador de perda de voz, mas sem redução do buffering e com
STOI pior. Não houve benefício conjunto suficiente para incorporar a política.
O `DynamicBufferManager` de produção permanece como estava na referência.

## Reprodução dos experimentos

`node scripts/noise-benchmark/prepare-optimization-experiments.mjs` gera os
snapshots a partir do commit fixado. `LIRA_AUDIO_SNAPSHOTS` aponta para o JSON com
as fontes alternativas ao executar `scripts/conversation-latency.electron.test.mjs`.
Os bundles e o arquivo de snapshots têm hashes registrados no manifesto.
`python -B scripts/noise-benchmark/compare_conditions.py <pasta>` calcula os deltas
pareados. Os arquivos de áudio e relatórios completos ficam no cache de testes,
fora dos recursos distribuídos do aplicativo.

O snapshot `production.json` compara o commit original com as fontes correntes.
Para a validação final, foram usados `LIRA_CONVERSATION_REPETITIONS=2`,
`LIRA_CONVERSATION_WARMUP_MS=6000`, `LIRA_AUDIO_EXPERIMENT_ISOLATION=0` e
`LIRA_EXPECT_WORKER_CONDITION=candidate`. `LIRA_AUDIO_FILE_ORIGIN=1` e
`LIRA_EXPECT_WORKER=1` no teste isolado verificam o backend em arquivos locais.

Validação: 3269 testes unitários aprovados, quatro ignorados, zero falhas em 343
arquivos fora do instalador; 37 testes Python de métricas aprovados e TypeScript
sem erros. Os testes de instalador não foram alterados nem declarados aprovados.
Também passaram a regressão de chamadas entre dois navegadores e o teste de
rolagem do chat. O teste local de Electron exigiu Worker ativo em cada captura.
