# Refatoração gradual do Lira com bibliotecas

Branch: `codex/refatoracao-bibliotecas` · início: 2026-11-16.

## Objetivo e decisões

Migrar validação, persistência, IndexedDB, ZIP, source maps, versões, MQTT,
dropdowns e logs para bibliotecas, além de substituir o editor do quadro por
Excalidraw. Manter React 18, Electron, Capacitor e P2P. Não introduzir SQL/ORM.
Todos os participantes deverão atualizar para o novo quadro. Não manter protocolo
misto com clientes antigos. Preservar dados salvos e converter desenhos existentes.
Adicionar versões exatas e atualizar o lockfile na etapa que usa a biblioteca.

## Regras e acompanhamento

- TDD: escrever e executar os testes antes de implementar; executar novamente após
  a mudança e remover a implementação substituída.
- Validar somente executando arquivos de teste. A checagem TypeScript é feita por
  `productionTypes.test.ts`. Não executar `test:all`, abrir app/navegador, realizar
  validação manual ou build fora dos testes sem consultar o usuário.
- Não criar PR nem publicar. Fazer commits separados, incluindo apenas mudanças
  desta refatoração. Preservar alterações preexistentes.
- Por etapa, registrar estado, testes/comandos/resultados, commit, pendências,
  próxima ação e recuperação quando houver mudança de formato.
- Só iniciar etapas dependentes depois de concluir suas dependências.

## Linha de base

- Origem: `codex/fix-reported-test-failures`.
- Inventário dos arquivos preexistentes: `.scratch/refatoracao-bibliotecas/alteracoes-preexistentes.txt`.
- Patch original: `.scratch/refatoracao-bibliotecas/preexistentes.patch`.
- Cópias dos arquivos de código preexistentes: `.scratch/refatoracao-bibliotecas/originais/`.
- Já havia alterações em assets, mapas, transcrição, testes, mensagens P2P e quadro,
  além de arquivos novos. Não fazem parte automaticamente dos commits deste roteiro.
- Execução inicial: `npm test -- --reporter=json --outputFile=.scratch/refatoracao-bibliotecas/baseline.json`.
- Resultado: 447 arquivos, 4.006 testes aprovados, 4 reprovados e 4 pendentes.
  Falhas anteriores: `allTestsCommand`, `deepFilterPreferences`, `installerDelta`
  e `updateIoHarness`. Repetição isolada registrada em `baseline-falhas.log`.
  A primeira tentativa foi impedida pela restrição de leitura do esbuild.

## Etapas

### [x] 0. Preparação e linha de base

- [x] Criar branch, documento e inventário das alterações anteriores.
- [x] Registrar resultado e falhas preexistentes de `npm test`.
- [x] Adicionar `fake-indexeddb`, `jsdom`, `@testing-library/react` e
  `@testing-library/user-event` como dependências de desenvolvimento.
- [x] Usar DOM apenas nos testes que precisarem dele (sem mudança global).

Aceite: linha de base registrada e ambiente de testes pronto.

### [x] 1. Validação e tipos com Zod

- [x] Criar schemas para dados persistidos, arquivos e mensagens externas.
- [x] Migrar preferências/arquivos, depois salas públicas, presença, chat,
  colaboração e controle de mídia.
- [x] Transformar `NetworkMessage` em união discriminada por `type`.
- [x] Validar `unknown` antes de handlers e stores; manter autorização separada.

Testar: mensagens válidas, campos ausentes, números inválidos, limites, tipos
desconhecidos e remetentes sem autorização; pacotes inválidos não alteram estado.
Suítes: serviços de armazenamento/salas, P2P, colaboração e tipos de produção.

### [x] 2. Persistência com Zustand

- [x] Migrar preferências gráficas/áudio, reuniões e espaços salvos para `persist`.
- [x] Separar dados persistentes dos dados de sessão nos stores de jogo/chat,
  preservando as fachadas públicas.
- [x] Centralizar schemas, armazenamento, falhas e importação dos formatos antigos.
- [x] Preservar chaves, compactação, precedência dos espaços e arquivos nativos.
- [x] Não persistir FPS, posições, streams, conexões, painéis nem chaves de API.
- [x] Preservar agrupamento das gravações de áudio e evitar escritas transitórias.

Testar: formatos existentes, reinicialização, corrupção, indisponibilidade, quota
e ausência de gravações durante movimento/FPS. Suítes: `storeStorageFailures`,
`liraStorageKeys`, `storageReport`, reuniões, espaços e preferências.

### [x] 3. IndexedDB com idb

- [x] Migrar biblioteca de imagens e cache da transcrição para `idb`.
- [x] Manter bancos, versões, object stores e chaves existentes.
- [x] Aguardar conclusão das transações e manter catálogo/imagens atômicos.
- [x] Preservar downloads, hashes e cache de URLs fora do adaptador.

Testar com `fake-indexeddb`: bancos existentes, blobs, abortos e catálogo anterior
preservado se faltar imagem. Suítes: `individualLibraryStorage`, `transcriptionModule`.

### [x] 4. ZIP com fflate

- [x] Preservar `buildZip(entries): Promise<Buffer>` e usar compressão assíncrona.
- [x] Preservar nomes, datas, arquivos vazios e limites dos relatórios.
- [x] Remover cabeçalhos binários e CRC exclusivos do gerador antigo.

Testar com leitor independente: CRC/conteúdo, binários, Unicode, datas, arquivos
múltiplos/vazios e nomes inválidos. Suítes: `zipWriter`, `logBundle`, `errorReportsScript`.

### [x] 5. Source maps com @jridgewell/trace-mapping

- [x] Preservar interface, cache, nomes, caminhos e identificação minificada.
- [x] Substituir Base64/VLQ e adaptar convenções de linhas/colunas.
- [x] Em mapa inválido, preservar o quadro original do erro sem interromper logs.

Testar: posições, nomes, caminhos, múltiplas consultas, mapas ausentes/corrompidos.
Suítes: `sourceMapLookup`, `stackSymbolicator`, relatórios de erros.

### [x] 6. Versões com semver

- [x] Centralizar normalização, comparação e incremento, preservando interfaces.
- [x] Aceitar `v`/espaços; versão inválida não anuncia atualização.
- [x] Preservar exclusão de drafts/prereleases nas atualizações estáveis.
- [x] Na etapa do quadro, incrementar patch da maior versão declarada entre pacote
  e constantes, alinhando versão do aplicativo e mínimo exigido.

Testar: igualdade, ordenação numérica, incremento, entradas inválidas, prereleases
e compatibilidade. Suítes: `updateService`, `bumpVersion`, `versionCompatibility`.

### [x] 7. MQTT com MQTT.js

- [x] Usar build de navegador, um cliente por broker, mantendo estados da UI.
- [x] Remover parser/codificador MQTT e timers duplicados.
- [x] Preservar transporte JSON Render, descoberta, anúncio, heartbeat,
  expiração, múltiplas fontes e comunicação local.
- [x] Configurar timeout/keepalive/reconexão e encerramento dos clientes.

Testar clientes simulados: anúncio/recebimento, reconexão, online/offline, falha
isolada e Render. Sem brokers reais. Suítes: `publicRoomsServer`, `publicRoomsRender`,
`publicHubPerformance`, presença e publicação de salas.

### [x] 8. Dropdowns com Radix Select

- [x] Preservar props e aparência de `CustomDropdown`, ícones, cores e tamanhos.
- [x] Delegar foco, teclado, busca, Escape e posicionamento à biblioteca.
- [x] Preservar estado sem opções e funcionamento em diálogos.

Testar em jsdom: mouse/teclado, seleção, fechamento, retorno de foco, rótulos
acessíveis e diálogos. Sem navegador. Manter regressões dos componentes consumidores.

### [x] 9. Logs com electron-log

- [x] Preservar interfaces, formatos, relatórios e IPC estruturado existentes.
- [x] Delegar escrita e disparo de rotação ao transporte de arquivo.
- [x] Preservar diretórios por instância, arquivos diários, 5 MB e três rotações.
- [x] Preservar fingerprints, contexto, agrupamento e anexos; evitar dupla captura.
- [x] Declarar `electron-log` como dependência externa de produção e acrescentar
  somente seu diretório à allowlist. Incorporar as demais bibliotecas aos bundles.

Testar: formatos, rotação, sessões/instâncias, falhas de escrita, duplicação,
leitura dos relatórios e allowlist. Suítes: `logWriter`, `rendererLogger`,
`logBundle`, `errorReportsScript`, `productionPackage`.

### [x] 10. Dados e sincronização do quadro branco

- [x] Adotar tipos de elementos/arquivos do SDK e preservar transporte P2P.
- [x] Persistir documento versão 2 por sala em IndexedDB.
- [x] Converter traços, operações, objetos e imagens com restauração do SDK.
- [x] Manter originais até conversão validada e gravação concluída; ser idempotente.
- [x] Exigir `schemaVersion: 2` nos payloads; não implementar protocolo misto.
- [x] Preservar autorização, sincronização inicial, exclusões, resolução
  determinística, barreira de limpeza e limites; enviar imagens só quando necessário.

Testar: conversão, falha de gravação, salas isoladas, entrada tardia, duplicação,
concorrência, ordem e exclusões. Suítes: quadro, cenas, ponteiros e funcionamento offline.

### [x] 11. Editor com Excalidraw

- [x] Carregar componente React sob demanda, em português, no painel do Lira.
- [x] Integrar `initialData`, `onChange` e atualização de cena; alterações remotas
  não entram no histórico local nem causam retransmissão em ciclo.
- [x] Delegar desenho, seleção, transformação, histórico e exportação ao SDK.
- [x] Preservar offline, temas, imagens, laser, atalhos isolados e confirmação de limpeza.
- [x] Empacotar fontes/recursos locais e desabilitar embutidos/serviços remotos.
- [x] Exportar `.excalidraw`, SVG/PNG e importar arquivos antigos do Lira.
- [x] Substituir testes que proíbem Excalidraw por contratos de integração/offline;
  remover o editor anterior após a migração.

Testar: SDK simulado na UI, restauração real, offline, atualizações remotas,
histórico, ponteiros, importação/exportação e fontes/recursos locais.
Referência: [API oficial do Excalidraw](https://plus.excalidraw.com/docs/sdk/excalidraw/api/props).

### [x] 12. Revisão e encerramento

- [x] Remover código morto, adaptadores temporários e dependências redundantes.
- [x] Atualizar documentação de colaboração, armazenamento e logs.
- [x] Executar `npm test`, incluindo tipos, contratos e empacotamento.
- [x] Registrar resultados, commits e limites de validação.
- [x] Registrar build completo, app, navegador e validação visual como pendentes de consulta ao usuário.

Aceite: nenhuma regressão nova nas suítes executadas, etapas anteriores concluídas
e dados preservados. Não apresentar validação visual/build como realizada.

## Recuperação

Incorporar por módulo; não manter duas implementações ativas após cada migração.
Reverter apenas o commit da etapa e, quando necessário, recuperar o formato
anterior a partir dos originais preservados. Nunca reverter arquivos ou mudanças
preexistentes do usuário indiscriminadamente.

## Registro de execução

| Etapa | Estado | Testes / resultado | Commit | Próxima ação |
| --- | --- | --- | --- | --- |
| 0 | Concluída | 4.006 aprovados; 4 falhas anteriores e 4 pendentes | `59186f6` | Iniciar contratos Zod |
| 1 | Concluída | TDD vermelho registrado; contratos/tipos aprovados; 50 testes das 6 suítes ajustadas aprovados | `4990dff`, `3bbc9d4` | Migrar persistência |
| 2 | Concluída | TDD vermelho; 38 testes / 9 arquivos aprovados, incluindo tipos | `844fa4d`, `60958d7` | Migrar IndexedDB |
| 3 | Concluída | TDD vermelho; 13 testes / 4 arquivos aprovados | `b342ebd` | Migrar ZIP |
| 4 | Concluída | TDD vermelho para colisões; 35 testes / 4 arquivos aprovados | `891cb76` | Migrar source maps |
| 5 | Concluída | 27 testes antes; 57 testes / 4 arquivos após, incluindo tipos | `31fea1d` | Migrar versões |
| 6 | Concluída | TDD vermelho; 27 testes / 5 arquivos aprovados | `c3082b4`, `782a873` | Migrar MQTT |
| 7 | Concluída | TDD vermelho; 38 testes / 7 arquivos aprovados | `2e6b9ce` | Migrar dropdowns |
| 8 | Concluída | TDD vermelho; 32 testes / 4 arquivos aprovados em jsdom e Node | `d3dda85` | Migrar logs |
| 9 | Concluída | TDD vermelho; 82 testes / 6 arquivos aprovados | `457279d` | Migrar quadro versão 2 |
| 10 | Concluída | TDD vermelho; conversão, armazenamento e P2P na suíte de 67 testes / 15 arquivos | `429cebd`, `7468915` | Integrar editor |
| 11 | Concluída | TDD vermelho; SDK real/simulado, fontes locais e tipos na suíte de 67 testes / 15 arquivos | `30515d9`, `d5bbac1` | Revisar e executar regressão completa |
| 12 | Concluída | 4.018 aprovados no lote final; 31 aprovados no reteste isolado dos dois arquivos instáveis; 4 pendentes anteriores | `6ee5ff1`, `33e926b` | Build/visual somente após consulta |

- Baseline isolada: os quatro arquivos anteriores passaram (44 testes, `--maxWorkers=1`); as falhas iniciais não foram reproduzidas isoladamente.
- Etapa 1: contratos estruturais Zod nas entradas P2P, descoberta e contatos; validadores especializados continuam responsáveis pelas regras de domínio. Fixtures de rede passam a incluir timestamp e payload completo.

- ZIP: nomes sanitizados duplicados são rejeitados para não perder anexos. Leitor independente valida CRC via Node e aceita descritores de dados do formato ZIP.

- Quadro: pacote e versões atual/mínima alinhados em `1.1.211` (patch da maior declaração anterior, `1.1.210`). Pacotes sem `schemaVersion: 2` são rejeitados.

- MQTT: testes de framing do parser removido foram substituídos por contratos dos clientes; nenhuma conexão com brokers reais foi usada. O pacote resolve seu build de navegador pelo export browser.

- Etapas 10–11: comando `npx vitest run` nos 15 arquivos `boardPersistence`, `whiteboard`, `boardScene`, `boardPointers`, `offlineWhiteboard`, `versionCompatibility`, `nativeBoard*`, `boardPointerOverlay`, `collaborationTools`, `boardAssets` e `productionTypes`, com `--maxWorkers=2`. Resultado: 67 aprovados; log `board-complete.log`.
- Conversão: banco novo `lira-whiteboards`, versão 1, store `documents`, documento `schemaVersion: 2` por sala. Os bytes de `lira_whiteboard_<sala>` permanecem intactos. Restauração conserva IDs, revisões e pontos isolados. Repetir a conversão produz a mesma cena.
- Recuperação do quadro: exportar primeiro os desenhos novos; reverter os commits 10/11 e restaurar os originais preservados para voltar ao editor anterior. A cópia localStorage só representa o estado anterior à migração. Não apagar IndexedDB para recuperar dados novos.
- SDK: abertura/importação passa pelo Lira para emitir barreira de limpeza; exportação JSON nativa/SVG/PNG pertence ao SDK. Recursos de IA, embeds e menus de serviços externos estão desabilitados.
- Fontes: copiadas para `dist/excalidraw-assets/fonts`; no Electron instalado um protocolo restrito a fontes permite carregamento e incorporação no SVG. Transformação pequena no build remove o fallback CDN incondicional do SDK 0.18.0; teste verifica os bundles dev/prod instalados. Atualizar o SDK exige revisar esse contrato.
- Nenhuma abertura de aplicativo/navegador, teste manual ou build completo foi executado.


## Revisão e comandos de acompanhamento

A primeira regressão completa após as migrações executou 455 arquivos: 4.006
aprovados, sete falhas e quatro testes já pendentes. Registro: `final.json` e
`final.log`. Três falhas eram os novos testes vermelhos de presença/armazenamento,
incluídos durante a revisão. As demais expuseram a captura de exceções antes do
handler, a serialização de arrays e a expectativa anterior de aceitar alturas
inválidas em `LIVE_VIEW`. Todas foram tratadas antes do encerramento.

Correções e verificações adicionais:

- `60958d7`: o Zustand espalha o estado antes de `partialize`; o adaptador agora
  retorna o valor original para preservar arrays, arrays vazios e `null`. Adicionado
  round-trip de reinicialização e diagnóstico de armazenamento indisponível.
- `3bbc9d4`: campos opcionais de jogador/presença, broadcasts, mensagens de amigos,
  recibos e cache nativo passam por schemas. A validação ocorre dentro da captura
  de erros do PeerManager, incluindo objetos com getters que lançam exceções.
  Pacote com anexo ou altura estruturalmente inválidos é rejeitado por inteiro.
- `7468915`: schemas compartilhados também validam campos internos de mapas,
  espaços salvos e elementos/arquivos do quadro. Mantidos os defaults legados de
  hidratação dos mapas compactados. Traço em andamento com um ponto é restaurado
  como ponto visível; exportação SVG foi exercitada com o SDK real e fetch proibido.
- `782a873`: versão inválida não é admitida como cliente compatível. As mensagens
  de incompatibilidade passam a mencionar colaboração e mídia.
- `d5bbac1`: cobertura adicional de busca por digitação no Radix, rollback de blobs
  em transação abortada, troca de sala com carregamento atrasado e limpeza como
  ação local do histórico. Removido o teste que proibia a presença do Excalidraw.

Lotes executados na revisão (todos via `npx vitest run`, sem abrir app ou navegador):

| Log em `.scratch/refatoracao-bibliotecas/` | Arquivos passados ao Vitest, em `src/__tests__/` | Workers | Resultado |
| --- | --- | --- | --- |
| `regressions.log` | `services/dataSchemas.test.ts services/persistedState.test.ts core/appReportContext.test.ts media/liveViewMessage.test.ts p2p/chatRoomChannelsStore.test.ts p2p/friendsAcrossSpaces.test.ts services/storeStorageFailures.test.ts core/productionTypes.test.ts` | 2 | 120 aprovados |
| `map-contract.log` | `services/dataSchemas.test.ts core/savedSpacesStartup.test.ts services/storeStorageFailures.test.ts core/productionTypes.test.ts p2p/doorKnocking.test.ts engine/mapSerialization.test.ts` | 2 | 39 aprovados |
| `board-guard.log` | `p2p/boardScene.test.ts p2p/whiteboard.test.ts p2p/boardPersistence.test.ts components/nativeBoard.test.ts components/nativeBoardUI.test.tsx core/productionTypes.test.ts` | 2 | 33 aprovados |
| `review-complete.log` | `p2p/versionCompatibility.test.ts core/productionTypes.test.ts p2p/boardScene.test.ts p2p/whiteboard.test.ts components/nativeBoard.test.ts components/nativeBoardUI.test.tsx components/collaborationTools.test.tsx core/boardAssets.test.ts` | 2 | 50 aprovados |
| `acceptance.log` | `services/indexedPersistence.test.ts components/customDropdown.test.tsx components/nativeBoardUI.test.tsx p2p/offlineWhiteboard.test.ts` | 2 | 18 aprovados |

Para repetir um lote, use `npx vitest run` seguido dos caminhos completos dos
arquivos da segunda coluna (cada um com o prefixo `src/__tests__/`) e
`--maxWorkers=2`. Os arquivos `*-red.log` correspondentes conservam os resultados
anteriores à implementação. Os testes de tipos executam o compilador pelo arquivo
`productionTypes.test.ts`; nenhum `tsc` direto foi usado.

A regressão final usa:

```powershell
npm test -- --maxWorkers=3 --reporter=json --outputFile=.scratch/refatoracao-bibliotecas/final-confirmado.json
```

O limite de três workers evita a concorrência irrestrita da linha de base e
permite rodar os testes demorados do instalador junto das demais suítes. Os testes
com Chromium/Electron opt-in, build completo e validação visual continuam fora
desta execução, conforme `AGENTS.md` e este roteiro.

## Dependências instaladas

| Etapa | Biblioteca | Versão exata |
| --- | --- | --- |
| 0 | fake-indexeddb / jsdom | 6.2.8 / 31.0.1 |
| 0 | @testing-library/react / @testing-library/user-event | 16.3.3 / 14.6.12 |
| 1 | zod | 4.6.7 |
| 2 | zustand (já existente) | Faixa existente preservada; middleware da instalação atual |
| 3 | idb | 8.0.4 |
| 4 | fflate | 0.8.3 |
| 5 | @jridgewell/trace-mapping | 0.3.31 |
| 6 | semver / @types/semver | 7.8.6 / 7.8.0 |
| 7 | mqtt | 5.16.1 |
| 8 | @radix-ui/react-select | 2.4.1 |
| 9 | electron-log | 5.4.4 |
| 10–11 | @excalidraw/excalidraw | 0.18.0 |

`package-lock.json` registra a árvore instalada. Apenas `electron-log` foi
acrescentado às dependências externas de produção; as demais adições seguem a
organização de desenvolvimento/bundling existente. React 18, Electron, Capacitor,
armazenamentos e transporte P2P foram preservados.

## Resultado da regressão final

- Comando completo acima: **455 arquivos; 4.018 aprovados, duas falhas e quatro
  testes pendentes** (`final-confirmado.json`). Tipos de produção, contratos,
  empacotamento e todas as suítes das bibliotecas passaram.
- As duas falhas ocorreram em `installerDelta` e `updateIoHarness`, arquivos que
  também falharam na linha de base e passaram isolados naquela ocasião. A falha
  de `updateIoHarness` repetiu o mesmo caso; em `installerDelta`, o caso que atingiu
  o limite mudou entre as rodadas. Durações de 31,9 s e 5,2 s, respectivamente,
  são compatíveis com os limites de 30 s/5 s sob concorrência. Esses arquivos não
  foram alterados por esta refatoração.
- Reexecução isolada concluída:
  `npx vitest run src/__tests__/services/installerDelta.test.ts src/__tests__/services/updateIoHarness.test.ts --maxWorkers=1 --reporter=default`.
  Resultado: **31 testes aprovados, dois arquivos aprovados**, em 315,66 s.
  Log: `final-instalador-isolado.log`. Ambos os casos que falharam sob concorrência
  passaram isolados, sem alterar código ou elevar timeouts dos testes.
- A execução anterior com dois workers passou nesses dois arquivos. As falhas
  daquele ciclo relacionadas à migração foram corrigidas e aprovadas nos lotes
  de revisão e na regressão final.


## Encerramento

Etapas 0–12 concluídas em 2026-11-16. Os 4.020 casos executáveis foram aprovados
considerando a suíte completa e o reteste isolado; quatro testes permaneceram
pendentes como na linha de base. A execução completa com três workers terminou
com código 1 pelos dois limites de tempo registrados acima; o reteste isolado
terminou com código 0. Não confundir essa evidência combinada com uma rodada
completa sem falhas sob concorrência. Não foi detectada regressão nova nas suítes
executadas.

Os fontes e testes não foram alterados entre a regressão final e o reteste isolado.
Os commits da implementação estão registrados por etapa; `6ee5ff1` reúne as
atualizações de documentação e `33e926b` registra esse encerramento.
Mudanças preexistentes em assets, dados e transcrição permanecem no diretório de
trabalho. Arquivos de colaboração que receberam migração foram incorporados de
forma explícita, com as cópias anteriores preservadas no inventário inicial.

Pendências de validação: build completo, abertura do aplicativo, avaliação visual
e testes opt-in com navegador/Electron. A execução dessas verificações exige
consulta ao usuário conforme `AGENTS.md`; nenhuma foi apresentada como realizada.
Não houve criação de PR ou publicação de versão.


## Correção posterior — timeout do helper de atualização

Branch: `codex/fix-update-io-test-timeout`.

O comando completo voltou a acusar timeout em `updateIoHarness.test.ts`. O caso
executa dois processos PowerShell independentes para verificar o isolamento do
estado estático e a passagem literal de argumentos. O limite unitário padrão de
5 segundos era insuficiente sob concorrência. O teste e seu preparo agora têm
um orçamento local de 30 segundos, como os testes de integração do instalador;
as asserções e o helper de produção permanecem com o mesmo comportamento.
Não foi alterado o timeout global nem reduzido o número de verificações.

- Antes da alteração: `npx vitest run src/__tests__/services/updateIoHarness.test.ts src/__tests__/core/productionTypes.test.ts --maxWorkers=2 --reporter=default`.
  Dois testes aprovados; o caso do helper levou 3.349 ms isolado nessa rodada,
  confirmando a pouca margem do limite anterior. Log: `.scratch/update-io-timeout/before.log`.
- Correção: `d5d2a92`.
- Verificação direcionada: `npx vitest run src/__tests__/services/updateIoHarness.test.ts src/__tests__/services/installerIo.test.ts src/__tests__/core/productionTypes.test.ts src/__tests__/components/nativeBoard.test.ts src/__tests__/components/nativeBoardInteractions.test.tsx --maxWorkers=2 --reporter=default`.
  **20 testes aprovados em cinco arquivos**. Log: `.scratch/update-io-timeout/after.log`.
- `3c05606`: incluído no controle de versão `src/collaboration/boardFile.ts`, que
  ficou fora dos commits anteriores. Os testes reais de importação já exercitam
  esse arquivo; nenhuma outra mudança preexistente foi adicionada ao commit.
- Suíte unitária completa: `npm test -- --maxWorkers=2 --reporter=json --outputFile=.scratch/update-io-timeout/full.json`.
  **455 arquivos; 4.020 testes aprovados, nenhuma falha e quatro pendentes; código 0.**
  O caso do helper passou também nesse lote, com 3.289 ms. Logs: `.scratch/update-io-timeout/full.log` e `full.json`.
  Esta rodada completa sem falhas substitui a limitação de validação registrada no encerramento anterior.
  Aplicativo, navegador e suítes opt-in de Electron/Chromium não foram abertos.
  Alterações preexistentes em assets, dados e transcrição foram preservadas.
