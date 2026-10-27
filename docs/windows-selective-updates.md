# Atualização seletiva no Windows

O instalador continua sendo baixado por inteiro e o pacote é extraído temporariamente.
Em instalações com `resources/update-manifest.json`, o instalador mantém os arquivos
idênticos no lugar, publica somente as adições/substituições e remove somente arquivos
pertencentes ao manifesto anterior. Arquivos desconhecidos são preservados; colisões
com uma nova entrada de conteúdo diferente são recusadas antes da aplicação. `app.asar`
continua sendo uma unidade: qualquer mudança nele substitui o arquivo inteiro.

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

Uma adição não concluída só é removida se os bytes corresponderem à versão recebida;
arquivos externos criados nesse intervalo são preservados. Pastas novas só são
removidas quando vazias. Caminhos gerenciados que troquem de arquivo para diretório,
ou vice-versa, são recusados sem seguir links ou apagar dados desconhecidos.

O snapshot registra arquivos mantidos/alterados e bytes planejados de backup e
aplicação. O journal e o log de progresso registram os bytes realmente publicados.
Esses números excluem a extração temporária e distinguem o backup do aplicativo
da proteção dos dados do usuário. Comparação e verificação por hash ainda leem os
arquivos: menor escrita/backup não implica um ganho universal de tempo.

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
