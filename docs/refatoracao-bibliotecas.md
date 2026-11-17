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
Referência: https://plus.excalidraw.com/docs/sdk/excalidraw/api/props

### [ ] 12. Revisão e encerramento

- [ ] Remover código morto, adaptadores temporários e dependências redundantes.
- [ ] Atualizar documentação de colaboração, armazenamento e logs.
- [ ] Executar `npm test`, incluindo tipos, contratos e empacotamento.
- [ ] Registrar resultados, commits e limites de validação.
- [ ] Consultar usuário antes de build, app, navegador ou validação visual.

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
| 0 | Concluída | 4.006 aprovados; 4 falhas anteriores e 4 pendentes | Commit de preparação | Iniciar contratos Zod |
| 1 | Concluída | TDD vermelho registrado; contratos/tipos aprovados; 50 testes das 6 suítes ajustadas aprovados | Commit de validação | Migrar persistência |
| 2 | Concluída | TDD vermelho; 38 testes / 9 arquivos aprovados, incluindo tipos | Commit de persistência | Migrar IndexedDB |
| 3 | Concluída | TDD vermelho; 13 testes / 4 arquivos aprovados | Commit de IndexedDB | Migrar ZIP |
| 4 | Concluída | TDD vermelho para colisões; 35 testes / 4 arquivos aprovados | Commit ZIP | Migrar source maps |
| 5 | Concluída | 27 testes antes; 57 testes / 4 arquivos após, incluindo tipos | Commit source maps | Migrar versões |
| 6 | Concluída | TDD vermelho; 27 testes / 5 arquivos aprovados | Commit semver | Migrar MQTT |
| 7 | Concluída | TDD vermelho; 38 testes / 7 arquivos aprovados | Commit MQTT | Migrar dropdowns |
| 8 | Concluída | TDD vermelho; 32 testes / 4 arquivos aprovados em jsdom e Node | Commit Radix | Migrar logs |
| 9 | Concluída | TDD vermelho; 82 testes / 6 arquivos aprovados | Commit electron-log | Migrar quadro versão 2 |
| 10 | Concluída | TDD vermelho; conversão, armazenamento e P2P na suíte de 67 testes / 15 arquivos | Commit quadro v2 | Integrar editor |
| 11 | Concluída | TDD vermelho; SDK real/simulado, fontes locais e tipos na suíte de 67 testes / 15 arquivos | Commit Excalidraw | Revisar e executar regressão completa |
| 12 | Em andamento | Regressão completa pendente | — | Documentação e npm test |

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
