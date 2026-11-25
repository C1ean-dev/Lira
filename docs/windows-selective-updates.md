# Atualização seletiva e incremental no Windows

As releases Windows x64 publicam o instalador completo (`Lira.Setup.<versão>.exe`) e os
artefatos incrementais (`lira-win-x64-incremental.json.gz` e `lira-win-x64-payload.pack`).

## Download e aplicação incremental (padrão)

Quando a instalação já possui `resources/update-manifest.json` e `resources/updater/*.ps1`:

1. O Lira baixa apenas `lira-win-x64-incremental.json.gz` (~70–110 KB) do CDN de Releases do
   GitHub e compara cada arquivo externo (com blocos de 256 KB para binários grandes como
   `Lira.exe`, evitando baixar ~100 MB apenas pelo carimbo de versão do `rcedit`) e cada
   bloco individual de `resources/app.asar` (lido via `original-fs` sem interceptação ASAR
   do Electron) por SHA-256 contra a instalação local.
2. Apenas os blocos realmente alterados (tipicamente 1–6 MB de código JS/CSS/Electron,
   reaproveitando Electron, GStreamer, DeepFilterNet WASM, fontes, sons e sprites locais)
   são baixados do `lira-win-x64-payload.pack` via requisições HTTP `Range` (206) agrupadas.
3. O novo `app.asar` é reconstruído bit a bit localmente e validado por SHA-256 por bloco e
   no arquivo final antes de preparar o staging em `lira.update-stage`.
4. `update-apply-incremental.ps1` executa `update-recovery.ps1 -Action SparseDeltaUpdate`
   usando o mesmo formato transacional `FormatVersion 6` (backup apenas dos arquivos
   substituídos/removidos + dados mutáveis do perfil + publicação atômica + rollback
   automático), sem extrair o pacote 7z nem re-hashear os runtimes intactos.
5. Se o manifesto incremental não estiver disponível (404), o servidor não suportar `Range`,
   o delta ultrapassar 75% do instalador completo ou houver qualquer falha de integridade,
   o cliente faz fallback automático para o instalador completo `Lira.Setup.<versão>.exe`.

## Rotina automática ao ligar o PC

- Controlada pela opção **Atualizar automaticamente ao ligar o PC** (`autoUpdateAtLogin`,
  ativada por padrão nas Configurações de Sistema e no menu da bandeja).
- O registro `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\com.lira.app` dispara
  `Lira.exe --startup-update` ao logar no Windows (removido na desinstalação completa).
- Com **Iniciar o Lira com o Windows** (`openAtLogin`) desligado, a rotina roda sem abrir
  janela (nem GPU/renderer), faz retentativas limitadas caso a rede ainda esteja subindo,
  aplica a atualização incremental em segundo plano e encerra — deixando o Lira já
  atualizado para quando o usuário abri-lo. Se o usuário abrir o Lira durante o processo,
  a rotina promove o lançamento automático (`--post-update`) e nunca encerra uma sessão ativa.
- Com `openAtLogin` ativado, atualizações incrementais leves (até 35 MB) são aplicadas
  antes de abrir a janela para entrar no Lira já atualizado; quedas de rede ou updates
  estruturais grandes abrem o Lira imediatamente e delegam o download ao app.
- O instalador NSIS também aceita `/NOLAUNCH` para não abrir o aplicativo após uma
  atualização silenciosa de fallback no boot.

## Instalador completo (fallback e primeira instalação)

Quando o instalador NSIS completo é usado, o pacote é extraído temporariamente.
Em instalações com `resources/update-manifest.json`, o instalador mantém os arquivos
idênticos no lugar, publica somente as adições/substituições e remove somente arquivos
pertencentes ao manifesto anterior. Arquivos desconhecidos são preservados; colisões
com uma nova entrada de conteúdo diferente são recusadas antes da aplicação. `app.asar`
continua sendo uma unidade no instalador NSIS: qualquer mudança nele substitui o arquivo inteiro.

## Empacotamento

O hook existente `afterPack` registra a localização do aplicativo. O novo
`artifactBuildStarted` do alvo NSIS gera o manifesto depois das etapas de assinatura
e fuses, antes da criação do arquivo 7z. Isso também funciona em builds sem assinatura,
nos quais o electron-builder não chama `afterSign`.

O manifesto tem `FormatVersion: 1`, a versão e uma lista de caminhos relativos Windows,
tamanhos e SHA-256. Ele não contém seu próprio hash. O desinstalador, produzido pelo
NSIS, e seu ícone são metadados adicionais da transação. O adaptador gera um script
NSIS local a partir do template instalado, verificando os pontos de integração; não
modifica `node_modules`. O pacote permanece Windows x64 e 7z, conforme a configuração.

O NSIS compila o desinstalador dentro do próprio instalador e o grava no destino.
O electron-builder pode assinar o instalador externo e os arquivos empacotados,
mas não assina separadamente esse desinstalador gerado pelo script personalizado.
O pipeline atual não usa certificado. Uma futura exigência de assinatura separada
do desinstalador precisará de uma etapa própria de empacotamento/assinatura.

## Transação e recuperação

1. O instalador recupera uma transação pendente, se houver, antes de começar outra.
2. A entrada é verificada por hash. Caminhos absolutos, travessias, ADS, nomes Windows
   ambíguos/reservados, duplicatas e links nos caminhos gerenciados são rejeitados.
3. O backup novo é preparado em `lira.backup.new`. Só arquivos antigos substituídos
   ou removidos são copiados para `app/`; as adições são registradas para desfazimento.
   A proteção seletiva dos perfis principal e `lira-inst-*` permanece a mesma.
4. O snapshot e o journal usam o formato 6. O journal é publicado atomicamente antes
   de mudanças no aplicativo; o backup anterior só é removido depois que o novo foi
   copiado e verificado. As fases são Preparing, Prepared, Installing, Applying,
   Applied e Restoring. Preparing/Prepared/Installing ainda não alteram dados vivos.
5. Cada substituição usa um arquivo temporário ao lado do destino e publicação
   atômica. Arquivos idênticos não são regravados. O manifesto é publicado por último.
6. As alterações e todos os arquivos esperados são verificados antes de iniciar
   o aplicativo. Commit elimina apenas o journal pendente e mantém o último backup.
7. A restauração verifica o backup antes de usá-lo, desfaz apenas as operações
   registradas e restaura os dados mutáveis protegidos. Os arquivos do backup
   diferencial não são consumidos, permitindo repetir uma restauração interrompida.

Uma adição só é removida se os bytes corresponderem à versão recebida; substituições
externas são preservadas mesmo depois da aplicação ou entre tentativas de rollback.
O instalador interrompe o fluxo se não conseguir preparar o destino ou gravar o
desinstalador, antes de aplicar arquivos. Pastas novas só são
removidas quando vazias. Caminhos gerenciados que troquem de arquivo para diretório,
ou vice-versa, são recusados sem seguir links ou apagar dados desconhecidos.

O snapshot registra arquivos mantidos/alterados e bytes planejados de backup e
aplicação. O journal e o log de progresso registram os bytes realmente publicados.
Esses números excluem a extração temporária e distinguem o backup do aplicativo
da proteção dos dados do usuário. Comparação e verificação por hash ainda leem os
arquivos: menor escrita/backup não implica um ganho universal de tempo.

Quando uma preparação falha, o log `lira.update-errors.jsonl`, ao lado da pasta
instalada, registra a ação, a etapa original e a causa do erro. A devolução dos
arquivos não substitui esse diagnóstico pela última mensagem de progresso.

Após recuperar os arquivos, o instalador fecha a tela de progresso e apresenta
o resultado. Em modo silencioso, o aviso tem uma resposta padrão e não bloqueia
o processo. A tentativa termina com código de erro; a versão preservada só é
reaberta depois do aviso, sem aguardar sua inicialização. Se a restauração falhar,
o backup fica preservado e o aplicativo não é iniciado sobre arquivos incompletos.

## Transição e testes

Instalações sem manifesto usam uma atualização completa, preservando o fluxo de
backup/rollback existente. A versão instalada recebe o manifesto e habilita o modo
diferencial nas atualizações seguintes. Instalações novas usam o fluxo completo.
Os formatos de recuperação antigos continuam sendo aceitos; a desinstalação normal
remove os artefatos de recuperação e mantém os dados do usuário como antes.

Os testes exercitam os scripts PowerShell reais, hashes, arquivos bloqueados,
espaço insuficiente simulado, corrupção, caminhos acentuados, junctions, interrupções,
atualizações sucessivas e preservação da identidade/data de arquivos inalterados.
O teste de empacotamento compila um instalador e desinstalador com payload inerte,
usando ferramentas em cache; nunca executa os binários resultantes. Executar um
instalador real continua dependendo de autorização prévia.
O teste `installerRollbackExit.test.ts` executa também uma reprodução isolada da
finalização NSIS, usando um worker de recuperação simulado e um aplicativo de
teste inofensivo. Ele verifica os callbacks de encerramento, o aviso em modo
silencioso e a saída do instalador enquanto o aplicativo restaurado segue aberto.
