# Logs e relatórios de erro

O Lira grava em disco o que acontece em cada execução. Quando algo dá errado, o arquivo a consultar é o de **relatórios de erro**: ele traz, para cada erro, o que falhou, em que ponto do código, o estado do app naquele instante e o que aconteceu antes.

## Onde ficam

| Execução | Pasta |
| --- | --- |
| Desenvolvimento (`npm run electron:dev`) | `logs/` na raiz do projeto |
| App instalado | `%APPDATA%\lira\logs` (instâncias extras: `%APPDATA%\lira-inst-2\logs`, …) |

## Enviar os logs

Quem usa o app não precisa achar essa pasta. O botão **Gerar arquivo de logs**, no rodapé das configurações de áudio e na tela de erro, cria um único arquivo `Lira-logs-<data>-<hora>.zip` na pasta Downloads e mostra o arquivo no gerenciador de arquivos. É esse arquivo que a pessoa envia.

O zip traz os relatórios de erro e os logs dos três últimos dias com atividade, mais três arquivos gerados na hora:

| Arquivo | Conteúdo |
| --- | --- |
| `LEIA-ME.txt` | Para quem envia: o que há dentro e o que não há. |
| `resumo.txt` | Os erros agrupados e o relatório completo dos dez principais. |
| `info.json` | Versão do app, sistema, dias cobertos e a lista dos arquivos. |

Os relatórios sempre entram. Os demais logs entram por ordem de utilidade até 64 MB (antes de compactar); o que ficar de fora é listado no `LEIA-ME.txt`.

O arquivo não traz o texto das mensagens do chat, nem áudio, vídeo ou imagens da tela. Traz nomes de jogadores e de canais, códigos de sala, identificadores de conexão, rótulos dos botões clicados e caminhos de pastas do computador.

## Os arquivos

Um conjunto por dia. Cada arquivo roda ao chegar a 5 MB e mantém três versões antigas (`.1`, `.2`, `.3`).

| Arquivo | Conteúdo |
| --- | --- |
| `lira-reports-<dia>.jsonl` | Um relatório estruturado por erro, um JSON por linha. **Comece por este.** |
| `lira-<dia>.log` | Linha do tempo em texto: tudo que passou pelo `console` do processo principal e das janelas. |
| `lira-errors-<dia>.log` | Só as linhas de erro da linha do tempo, com a pilha. |
| `call-debug-<dia>.log` | Eventos de diagnóstico em JSON (sala, chamadas, mídia, compartilhamento de tela, janela). |

Toda linha carrega a **sessão** que a escreveu: `electron-<pid>` para o processo principal e oito caracteres para cada janela (uma recarga começa uma sessão nova). É o que separa as janelas numa execução com várias instâncias e o que liga os quatro arquivos entre si.

```
2026-10-04T16:51:27.703Z ERROR renderer 9008ec95 [P2P Failover] Error claiming host: Error: ID "lira-…-host" is taken
    Error: ID "lira-…-host" is taken
        at …
    -> report r-mfx1k2ab-0a1b fp=1a2b3c4d
```

A última linha aponta o relatório daquele erro. `-> repeat fp=…` marca uma repetição que foi apenas contada.

## Ler os relatórios

```bash
npm run logs:errors
```

Mostra os erros do dia mais recente, agrupados: quantas vezes cada um aconteceu, quando, em quais sessões e em que ponto do nosso código.

```bash
node scripts/error-reports.js --fp 1a2b3c4d
```

Mostra o relatório completo mais recente daquele erro. Outras opções: `--day 2026-10-04` ou `--day all`, `--session 9008ec95`, `--dir <pasta>`, `--limit 10`, `--help`. O script precisa de Node 22.18 ou mais novo.

Para ler o zip que um usuário enviou, sem descompactar:

```bash
node scripts/error-reports.js --dir C:\Users\voce\Downloads\Lira-logs-2026-10-05-1432.zip
```

Na tela de erro do app, **Copiar Erro** copia esse mesmo relatório.

## O que há num relatório

| Campo | Significado |
| --- | --- |
| `fingerprint` | Identifica o erro. É o mesmo em todas as ocorrências (ids, números e linhas não contam), então serve para agrupar e para procurar nos arquivos de texto (`fp=`). |
| `kind` | Como o erro foi apanhado: `uncaught`, `unhandled-rejection`, `react` (tela de erro), `console` (um `console.error`), `handled` (`reportError`), `ipc`, `process-gone`, `unresponsive`. |
| `severity` | `fatal` quando a tela ou o processo morreu; `error` nos demais. |
| `source`, `session` | Processo (`main` ou `renderer`) e sessão. |
| `scope`, `message` | A etiqueta `[Escopo]` e o texto da linha de log. |
| `error` | Nome, mensagem, código e pilha em quadros (`fn`, `file`, `line`, `col`). `app: true` marca o nosso código; `cause` traz a causa encadeada. `min` aparece nos quadros traduzidos do app instalado (ver abaixo). |
| `loggedAt` | Onde o erro foi registrado, quando não é onde foi lançado. |
| `componentStack` | Árvore de componentes React, em erros de renderização. |
| `data` | O que o código que reportou sabia da operação (canal de IPC, chave do armazenamento, tipo da mensagem). |
| `context` | Estado do app no instante do erro, por área: `app`, `window`, `room`, `media`, `chat`, `p2p`, `friends` (janela) ou `app`, `process`, `windows`, `main` (processo principal). |
| `breadcrumbs` | A trilha: os últimos acontecimentos antes do erro, do mais antigo para o mais novo. |
| `stats` | A última leitura de cada medição periódica (estatísticas de envio, métricas de áudio). |
| `count` | Quantas ocorrências o relatório representa. |
| `late` | O relatório foi escrito depois do fato (repetições contadas): `context` e `breadcrumbs` são do momento da escrita. |

Um erro que se repete gera um relatório na primeira vez e é contado nos 30 segundos seguintes; a contagem sai no relatório seguinte do mesmo erro. Há também um limite de 30 relatórios por minuto por processo. A linha do tempo continua recebendo todas as linhas.

## A pilha no app instalado

O app instalado roda de pacotes minificados, então um quadro da pilha nasce como `dist/assets/bootstrap-C4j-cbG3.js:1185:1769945`. O build grava um source map ao lado de cada pacote (`vite.config.ts`), e o processo principal usa esses mapas para traduzir os quadros antes de gravar o relatório (`electron/stackSymbolicator.ts`). O quadro sai assim:

```json
{ "fn": "Xe.promoteToHost", "file": "src/p2p/PeerManager.ts", "line": 956, "col": 18, "app": true, "min": "dist/assets/bootstrap-C4j-cbG3.js:1185:1769945" }
```

`file`, `line` e `col` são do código-fonte daquela versão do app (a versão está em `context.app.version`). `fn` continua sendo o nome que o pacote usa, e `min` guarda a posição original no pacote. Código de dependências dentro do pacote sai com `app: false`.

Os mapas não trazem o código-fonte dentro deles e os pacotes não apontam para eles, então nada os carrega durante o uso normal. Somam cerca de 1,5 MB. As linhas de `lira-errors-<dia>.log` continuam com a pilha como o motor a escreveu; a pilha traduzida está no relatório.

## A trilha

Entram na trilha, sem que o código precise fazer nada:

- as linhas de `console.log/info/warn/error`;
- os eventos de `diagLog(cat, event, data)`;
- cliques em botões, links, abas, itens de menu e campos (o rótulo do controle; o que foi digitado nunca é lido);
- a janela indo para segundo plano ou voltando, e a rede caindo ou voltando;
- transições da sala (entrou, saiu, virou anfitrião, estado da conexão, jogadores) e mudanças na configuração de áudio e vídeo;
- no processo principal: janela criada, carregada, minimizada, travada; sessão de cada janela; handler de IPC que segurou o processo; erros vindos das janelas.

Um evento que se repete é contado (`n`) em vez de listado de novo. Medições periódicas (`…stats`, `…metrics`) ficam fora da trilha e vão para `stats`.

## Registrar a partir do código

```ts
import { createLogger, reportError } from '../utils/logger'
import { diagLog } from '../utils/diagnosticLogger'
import { registerReportContext } from '../utils/reportContext'

const log = createLogger('Updater')
log.info('checking')                    // linha do tempo e trilha
log.error('download failed:', error)    // também gera um relatório

// Num catch: diz o que estava sendo feito e o que se sabia da operação.
reportError(error, { scope: 'Storage', message: 'could not save the spaces', data: { key, chars } })

// Numa transição importante (não por quadro, não por pacote).
diagLog('room', 'join-open', { roomCode })

// Uma parte do app que guarda estado descreve esse estado para os relatórios.
registerReportContext('room', () => ({ inRoom: !!roomId, players }))
```

Para falhas de leitura ou gravação no `localStorage`, use `reportStorageFailure('read' | 'write', chave, erro)`; numa gravação o relatório diz quanto do armazenamento está ocupado e por quais chaves.

No processo principal, `console.error` já gera relatório. Para acrescentar dados: `logErrorWith(console, { kind, data }, '[Escopo] mensagem', error)`.

Um `catch` vazio só deve existir onde a falha é esperada e não importa. Onde ela significa perda de dados ou uma função que deixou de funcionar, reporte.

## O que é registrado sozinho

- Exceções não tratadas e promises rejeitadas, na janela e no processo principal.
- Erros de renderização do React (tela de erro).
- Todo `console.error`.
- Mensagem de rede que quebra o próprio handler (`[P2P Message]`, com o tipo e o remetente).
- Dados salvos que não puderam ser lidos ou gravados (`[Storage]`).
- Handler de IPC que falha (`[IPC]`, com o canal).
- Processo de renderização, de GPU ou utilitário que caiu, com o código de saída do Windows decodificado. Encerramento limpo e Ctrl+C de uma execução de desenvolvimento não contam como erro.
- Janela que parou de responder.

Cada sessão do processo principal começa com duas linhas `[Session]`: versão do app, Electron, sistema, instância, pasta de logs e placas de vídeo com os recursos de GPU que não estão habilitados.

## Limites

- No app instalado, o nome da função em cada quadro (`fn`) é o do pacote minificado. Arquivo e linha são os do código-fonte.
- Os arquivos ficam só na máquina. Nada é enviado.
- Os relatórios trazem códigos de sala, ids de conexão e rótulos de botões. Leve isso em conta antes de mandar um arquivo para alguém.
