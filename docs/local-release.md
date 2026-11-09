# Publicar uma atualização pelo computador

Na raiz do projeto, dê dois cliques em **Publicar-Atualizacao.cmd**. A janela fica
aberta ao terminar, inclusive quando ocorre uma falha. O mesmo fluxo está disponível
no terminal com `npm run release`.

O script busca o código mais recente de `origin/main` e as tags, escolhe a próxima
versão disponível (incluindo rascunhos) e instala as dependências com `npm ci`.
Depois gera o instalador Windows e o APK Android assinado, verifica a assinatura
do APK, envia ambos a um rascunho no GitHub Releases e publica a release como
mais recente. Uma falha interrompe a sequência. A suíte de testes é independente
da publicação e pode ser executada com `npm run test:all`.

O build acontece em um worktree temporário. Seu código não commitado, sua branch,
seus arquivos de configuração e seus `node_modules` não são alterados. As versões
de `package.json` e `package-lock.json` são ajustadas apenas nessa cópia temporária;
a tag da release aponta para o commit de origem no GitHub, como no fluxo anterior.
Publique seus commits em `main` antes de dar dois cliques. Mudanças apenas locais
não entram na atualização. A mudança que introduz este script também deve chegar
à `main` antes da primeira publicação padrão.

## Preparação inicial

Instale uma vez neste computador:

- Node.js 22.12 ou superior, com npm, e Git.
- GitHub CLI (`gh`), autenticado com `gh auth login`, com permissão para criar
  releases e enviar arquivos no repositório apontado por `origin`.
- Visual Studio Build Tools, com **Desktop development with C++** e Windows SDK,
  para compilar o capturador de áudio do Windows.
- JDK 21 ou superior.
- Android SDK com `platform-tools`, `platforms;android-35` e `build-tools;35.0.0`.
  Esses componentes podem ser instalados no SDK Manager do Android Studio.
  Aceite as licenças do SDK antes de publicar.

Copie `.env.release.example` para `.env.release.local` e ajuste os caminhos de Java
e Android SDK. Esse arquivo está no `.gitignore`. Variáveis já definidas no ambiente
do Windows têm prioridade. A publicação também lê `.env`, `.env.local`,
`.env.production` e `.env.production.local`, nessa ordem, antes da configuração
específica da release.

Use `LIRA_JAVA_HOME` para escolher o JDK da publicação quando o `JAVA_HOME` do
Windows apontar para outra versão. Essa escolha vale também para o Gradle.

Para atualizar instalações Android existentes, use **a mesma chave e alias das
versões anteriores**, com suas respectivas senhas. Sem `LIRA_KEYSTORE_PATH`, o
script usa `android/app/lira-release.jks` do seu diretório original. Ele não gera
outra chave e não envia APK debug ou APK sem assinatura.

Configure os mesmos valores `VITE_TURN_*` usados anteriormente nos secrets do
GitHub. Os dois builds recebem as mesmas credenciais e URL do serviço TURN.
Secrets do GitHub não podem ser recuperados pelo script; use os valores locais
ou o gerenciador onde você os guardou. Não coloque esses valores em arquivos
versionados. A autenticação de publicação usa o próprio `gh`.

A instalação das dependências e a publicação precisam de internet. Reserve espaço
em disco para as dependências e os dois builds.

No Windows, o NSIS substitui os arquivos do programa e mantém os perfis no AppData.
Esse instalador deixa de criar `lira.backup` e de restaurar a versão anterior se
a nova instalação falhar. Se houver uma atualização antiga pendente, conclua a
recuperação com o instalador que iniciou aquela atualização antes de prosseguir.

## Logs, falhas e tentativas seguintes

Cada tentativa guarda `release.log`, `release.json` e os instaladores produzidos
em `.scratch/local-releases/<data>-<processo>/`. O JSON registra commit, versão,
estado e caminhos dos arquivos, sem copiar a configuração de credenciais.

Se um build falhar, corrija o erro, envie a correção para `main` e execute
novamente. A release pública anterior permanece disponível durante os builds e
uploads. Se o upload falhar, poderá existir um **rascunho** com anexos incompletos;
o script não o publica. Confira no GitHub antes de recuperar esse rascunho. Uma
nova execução reserva outra versão se a anterior já estiver em tags ou releases.
Se a conexão cair na etapa final, confira o estado da release no GitHub antes de
tentar novamente, pois a publicação pode ter sido concluída no servidor.

Uma trava no diretório Git comum impede duas publicações simultâneas neste clone,
inclusive a partir de outros worktrees. Se o computador desligar ou o processo for
encerrado à força, confirme que nenhuma publicação continua rodando e remova
somente `lira-release.lock` no caminho informado. O arquivo contém o PID e a pasta
de logs. Se a limpeza automática falhar, o log informa o worktree temporário
preservado; remova apenas aquele worktree quando não estiver mais em uso.

Para publicar um commit específico já enviado ao GitHub, use:

```powershell
npm run release -- --ref HEAD
```

O commit precisa existir no GitHub. Esse comando inclui somente o que já está
commitado na referência escolhida, nunca as alterações soltas do diretório.

## GitHub Actions

Build, testes e publicação deixam de usar GitHub Actions. Os workflows de Windows,
Android e triagem de issues foram removidos para não consumir minutos. O script
de triagem `scripts/ai-issue-triage.mjs` continua no repositório, mas não é disparado
automaticamente na abertura de issues. GitHub Releases continua hospedando os
instaladores e atendendo a verificação de atualizações do aplicativo.
