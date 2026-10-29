# Revisão das otimizações e relatório de áudio

`npm run test:all` termina com uma rodada real de WebRTC entre dois participantes
locais. Mede os três supressores e uma referência `bypass` com os mesmos arquivos
MS-SNSD, sem supressão. Usa os quatro pares do perfil `validation`: voz limpa,
voz baixa com ruído e ruídos transitórios, nos dois sentidos da chamada.

A saída final apresenta média aritmética de latência, diferença pareada para a
referência, quantidade de latências válidas, STOI médio limpo e com ruído e suas
diferenças para o bypass. O STOI é sempre calculado contra a voz limpa original;
o bypass permite separar o efeito do supressor da degradação do caminho WebRTC.
As comparações pareiam o arquivo de entrada e o sentido da chamada.

Uma voz apagada mantém STOI zero e latência indisponível: nunca entra como
latência zero na média. A referência de latência de cada motor usa somente os
mesmos pares em que ambos têm atraso mensurável. Os arquivos completos ficam em
`node_modules/.cache/audio-analytics/`, incluindo PCM, relatório JSON e log.
O comando exige Python com as dependências de `scripts/noise-benchmark/requirements.txt`,
Electron e os arquivos MS-SNSD verificados por hash, baixados na primeira execução.
A etapa acrescenta alguns minutos à suíte. Para rodar apenas ela:
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

## Rodada de validação em 29/10/2026

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

TypeScript, 34 testes Python de métricas/relatórios e os testes específicos de
áudio/integração passaram. As demais etapas de migração, navegador, dinâmica de
voz, sprites e transcrição também passaram. A rodada unitária ampla registrou
3359 testes aprovados, quatro ignorados e três falhas em três arquivos de
instalador; a repetição específica do instalador também falhou. Seus arquivos de
produção e testes são idênticos aos de `main`. Por isso esta revisão não afirma
que `test:all` completo passou: ele mantém a interrupção na primeira etapa que falha.
Uma rodada final excluindo apenas os arquivos de instalador passou: 3261 testes
aprovados, quatro ignorados, zero falhas em 341 arquivos.
