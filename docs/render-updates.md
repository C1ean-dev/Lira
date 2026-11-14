# Atualizações pelo Render

O Electron, o Android e a versão web consultam
`https://lira-signaling.onrender.com/updates/lira/latest`. A resposta usa os
campos das releases (`tag_name`, `name`, `body`, `html_url`, `assets`), com os
endereços dos instaladores apontando para `/updates/lira/assets/:assetId` no
mesmo servidor. O tamanho do instalador Windows continua sendo usado na
validação do download. A instalação e a recuperação permanecem no fluxo atual.

O Render busca a última release estável de `C1ean-dev/Lira` a cada 24 horas,
guarda os instaladores EXE/APK verificados e os fornece pelo cache local.
Pedidos dos aplicativos não fazem novas consultas ao GitHub. Isso funciona
com releases publicadas manualmente, sem reativar os workflows do GitHub.

Uma consulta diária que falhe preserva a última versão válida. O aplicativo
aceita esse cache mesmo quando sinalizado como antigo. Se ainda não houver
cache, ou o Render estiver indisponível, a verificação informa falha para
permitir uma nova tentativa, sem indicar que a versão está atualizada e sem
consultar o GitHub diretamente. A consulta tem limite de 65 segundos para
permitir a inicialização de um serviço Render que esteja ocioso.

Para manter o cache entre reinícios e publicações do servidor, configure
`LIRA_UPDATE_CACHE_DIR` dentro de um disco persistente do Render. Sem disco,
o cache e o horário da consulta podem ser perdidos em um reinício, exigindo
uma nova busca. O plano gratuito não oferece discos persistentes; veja a
[documentação do Render](https://render.com/docs/disks).

O endpoint é implementado no repositório
[lira-signaling](https://github.com/C1ean-dev/lira-signaling), no módulo
`liraUpdates.mjs`. Os endpoints anteriores de sinalização, convites e
atualização do `lira-clean` continuam independentes.
