# Revisão das otimizações e relatório de áudio

Os experimentos posteriores e o antes/depois final da implementação estão em
[audio-optimization-ab.md](audio-optimization-ab.md). A revisão abaixo preserva
o histórico; o código final usa Worker por mensagens e não mantém o gate extra
automático no DeepFilterNet. RNNoise e a política de buffer conservam seus valores.

`npm run test:all` termina com uma rodada real de WebRTC entre dois participantes
locais. Mede os três supressores e uma referência `bypass` com os mesmos arquivos
MS-SNSD, sem supressão. Usa os quatro pares do perfil `validation`: voz limpa,
voz baixa com ruído e ruídos transitórios, nos dois sentidos da chamada.
Cada caso é repetido duas vezes, com posições rotacionadas e ordem invertida
entre as repetições. São 32 chamadas e 64 capturas direcionais. Cada chamada
aquece durante seis segundos com o áudio real antes da gravação pontuada.

A saída final separa o custo local do motor do atraso remoto total. O primeiro
é a diferença entre a captura da saída local e a captura da entrada do motor,
no mesmo relógio, antes do Opus/RTP. A referência deve acrescentar exatamente
zero nesta etapa; uma asserção valida isso. O total remoto inclui o jitter
buffer e não deve ser interpretado como custo isolado do supressor.

O relatório apresenta média aritmética de latência, diferença pareada para a
referência, quantidade de latências válidas, STOI médio limpo e com ruído e suas
diferenças para o bypass. O STOI é sempre calculado contra a voz limpa original;
o bypass permite separar o efeito do supressor da degradação do caminho WebRTC.
As comparações pareiam arquivo de entrada, sentido e repetição. Há p95,
desvio-padrão e amplitude máxima entre repetições do mesmo caso. A saída informa
explicitamente quando a amplitude remota supera 30 ms e impede interpretar
esses deltas como evidência de ganho. Esse limite é um aviso de diagnóstico,
não um teste estatístico de significância.

Uma voz apagada mantém STOI zero e latência indisponível: nunca entra como
latência zero na média. A referência de latência de cada motor usa somente os
mesmos pares em que ambos têm atraso mensurável. Os arquivos completos ficam em
`node_modules/.cache/audio-analytics-v2/`, incluindo PCM, relatório JSON e log.
O comando exige Python com as dependências de `scripts/noise-benchmark/requirements.txt`,
Electron e os arquivos MS-SNSD verificados por hash, baixados na primeira execução.
A etapa acrescenta aproximadamente quinze minutos à suíte, dependendo da máquina.
Para rodar apenas ela:
`node scripts/audio-analytics.mjs`.

## Avaliação

- `latencyHint: 'interactive'` é uma solicitação apropriada para chamadas, mas
  não garante um tamanho de buffer WASAPI ou redução fixa. O valor real depende
  do navegador e do dispositivo: https://www.w3.org/TR/webaudio/#dom-audiocontextoptions-latencyhint.
- Remover os Biquads do DeepFilterNet evita pré-equalização e altera a resposta
  espectral. Não demonstra, isoladamente, que esses nós causavam 50 ms de atraso.
  Comparar essa alteração separadamente do `latencyHint` em capturas repetidas.
- Os dois ajustes do grafo são exclusivos do backend DeepFilterNet. O benchmark
  isolado do motor não usa `DynamicBufferManager`; portanto, não permite atribuir
  a queda alegada de 14 ms do RNNoise às mudanças do PR.
- Menor margem de jitter e penalidade por perda podem reduzir filas, com maior
  risco de cortes em redes instáveis. A recuperação de áudio agora aguarda quatro
  amostras limpas entre reduções de 10 ms, aproximadamente seis segundos com o
  monitor de 1500 ms. Um novo pico reinicia a espera; vídeo conserva sua política.
- A descrição anterior dizia preservar 100% da integridade, mas seus próprios
  números reduzem STOI limpo de 0,977 para 0,970. A documentação de diagnóstico
  também registra casos de fala perdida. Passar nas verificações de medição
  confirma a validade da captura, não qualidade acústica perfeita.

## Próximas melhorias com melhor relação entre custo e benefício

1. Repetir medições A/B em ordem alternada, sem outros testes pesados em paralelo;
   comparar por arquivo e direção e publicar dispersão, p95 e cortes além da média.
   Duas gravações de locutores não sustentam generalização para todas as vozes.
2. Medir duração p95/p99 da inferência do DeepFilterNet e filas entre contextos.
   Ele processa 480 amostras por chamada síncrona dentro de um AudioWorklet que
   recebe blocos de 128 (2,67 ms a 48 kHz). A proteção atual só reage a frames
   acima de 10 ms repetidamente; estouros menores já podem afetar o relógio do
   áudio. Avaliar inferência em Worker com fila limitada e medir o atraso adicional.
3. Separar ablações de modelo, gate automático e limite de atenuação do modelo
   (atualmente 35 dB). Usar voz baixa e ruídos transitórios para decidir a política;
   evitar apenas aumentar ganho ou baixar buffers para disfarçar perda de fala.
4. Validar a política adaptativa sob jitter e perda controlados, observando
   `concealedSamples`, descartes, STOI e latência. Reduzir o alvo não garante que
   o NetEq do Chromium aplique imediatamente o mesmo atraso.

As medições capturam o caminho virtual até o elemento remoto, antes da saída
física. Não medem microfone/alto-falante reais nem atraso da internet.
O Electron recebe `--mute-audio`; os elementos de áudio continuam ativos com
volume 1, e as verificações de PCM e RTP asseguram que o teste não foi silenciado
internamente para produzir resultados artificiais.

## Rodada inicial de 29/10/2026 — comparação remota inadequada

A investigação posterior identificou que o bypass negociava apenas áudio,
enquanto os motores negociavam áudio e vídeo preto. Além disso, havia apenas
uma gravação por caso, ordem fixa e ausência de aquecimento com áudio. A tabela
abaixo é preservada como registro diagnóstico e **não é uma comparação válida
do desempenho relativo dos motores**.

Captura local em Electron 33, 16 chamadas e oito sentidos/cenários por motor:

| Motor | Latência média (ms) | STOI limpo | STOI com ruído | Latências válidas |
| --- | ---: | ---: | ---: | ---: |
| Sem supressor | 212,40 | 0,971 | 0,889 | 8/8 |
| DSP clássico | 150,68 | 0,919 | 0,870 | 8/8 |
| RNNoise | 192,30 | 0,907 | 0,851 | 8/8 |
| DeepFilterNet | 930,22 | 0,414 | 0,245 | 7/8 |

O DeepFilterNet teve uma latência indisponível e degradação importante de fala;
o sucesso do teste confirma a captura válida, não a aprovação da qualidade.
Esses números são observações desta rodada, não estimativas universais nem prova
de ganho causado pelas otimizações. Outras suítes executaram durante parte da
rodada; repetir sem carga concorrente e em ordem alternada antes de conclusões
causais. Os alvos adaptativos e os buffers internos do navegador também diferem
entre chamadas: um delta negativo contra bypass não é um custo negativo do filtro.

Recalculando somente o custo local dessas mesmas capturas: bypass 0 ms,
DSP clássico 50,66 ms, RNNoise 72,81 ms e DeepFilterNet 136,38 ms. A aparente
inversão estava na comparação dos totais de chamadas independentes.

O protocolo corrigido cria a mesma trilha de vídeo desativada no bypass usando
o mesmo helper de `MediaManager`. As asserções verificam as faixas em todos os
participantes. A captura reutiliza um nó apenas quando a trilha é exatamente o
mesmo objeto; IDs de trilha não bastam, pois o WebRTC pode preservar o ID remoto.
O codec continua sendo Opus e o áudio remoto continua ativo, com saída física
silenciada por `--mute-audio`.

TypeScript, 34 testes Python de métricas/relatórios e os testes específicos de
áudio/integração passaram. As demais etapas de migração, navegador, dinâmica de
voz, sprites e transcrição também passaram. A rodada unitária ampla registrou
3359 testes aprovados, quatro ignorados e três falhas em três arquivos de
instalador; a repetição específica do instalador também falhou. Seus arquivos de
produção e testes são idênticos aos de `main`. Por isso esta revisão não afirma
que `test:all` completo passou: ele mantém a interrupção na primeira etapa que falha.
Uma rodada final excluindo apenas os arquivos de instalador passou: 3261 testes
aprovados, quatro ignorados, zero falhas em 341 arquivos.

## Validação do protocolo corrigido

Rodada completa sem outras capturas/testes pesados concorrentes: 32 chamadas,
64 direções, duas repetições de cada caso, seis segundos de aquecimento com áudio,
ordem alternada e áudio mais vídeo desativado em todos os modos.

| Motor | Custo local médio ms | Total remoto médio ms | Maior diferença entre repetições do mesmo caso ms | STOI remoto limpo | STOI remoto com ruído |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sem supressor | 0,00 | 99,31 | 15,10 | 0,988 | 0,876 |
| DSP clássico | 38,86 | 135,85 | 13,52 | 0,928 | 0,866 |
| RNNoise | 63,81 | 180,50 | 14,19 | 0,982 | 0,909 |
| DeepFilterNet | 117,38 | 248,11 | 75,65 | 0,651 | 0,463 |

Todas as 16 referências tiveram custo local exatamente zero. Os motores não
apresentaram latência local negativa. DeepFilterNet teve duas latências remotas
indisponíveis em 16; elas não entram como zero na média, e seu STOI permanece
incluído. A comparação remota do DeepFilterNet é explicitamente sinalizada como
instável. O custo local teve diferenças máximas entre repetições de 10 ms no
DSP, 15,33 ms no RNNoise e 22,67 ms no DeepFilterNet.

O STOI local ajuda a localizar a degradação: RNNoise teve 0,996 limpo e 0,925 com
ruído; DeepFilterNet teve 0,968 limpo e 0,642 com ruído antes do WebRTC. O declínio
adicional até o receptor não deve ser atribuído inteiramente ao modelo neural.

O controle curto, alterando apenas a topologia e a captura compartilhada antes
de adicionar aquecimento/repetições, também passou: bypass remoto 159,91 ms,
RNNoise 167,11 ms e custo local do bypass zero. Não estima isoladamente a
contribuição de cada mudança do protocolo. O comando completo posteriormente
passou nas verificações de captura; 36 testes Python e o teste da ordem de
execução passaram, assim como TypeScript e as verificações de sintaxe.
