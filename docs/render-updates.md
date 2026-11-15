# Atualizações pelo Render

O Electron, o Android e a versão web consultam
`https://lira-signaling.onrender.com/updates/lira/latest`. A resposta usa os
campos das releases (`tag_name`, `name`, `body`, `html_url`, `assets`), com os
endereços dos instaladores apontando para `/updates/lira/assets/:assetId` no
mesmo servidor. O tamanho do instalador Windows continua sendo usado na
validação do download. A instalação e a recuperação permanecem no fluxo atual.

Cada consulta do aplicativo faz o Render buscar a última release estável de
`C1ean-dev/Lira` no GitHub e comparar sua versão com a do cache. Se for igual
ou anterior, mantém os instaladores verificados. Se for mais nova, baixa e
verifica os EXE/APK antes de responder com a nova versão. Pedidos simultâneos
compartilham a mesma consulta e os mesmos downloads. A rotina diária em
segundo plano continua como antecipação do cache, sem limitar os pedidos dos
aplicativos. Releases publicadas manualmente funcionam sem reativar workflows.

Uma consulta que falhe preserva a última versão válida no servidor e marca a
resposta como `stale: true`. Se o Render estiver indisponível, não responder,
retornar esse cache antigo ou metadados inválidos, o aplicativo consulta
diretamente `https://api.github.com/repos/C1ean-dev/Lira/releases/latest` e usa
o instalador da release oficial para sua plataforma. Nas duas fontes, só
oferece atualização quando a versão é mais nova que a instalada.

A consulta ao Render tem limite de 65 segundos para permitir a inicialização
de um serviço ocioso e a preparação do cache; a alternativa no GitHub tem
limite próprio de 15 segundos. Se ambas falharem, a verificação informa falha
para permitir uma nova tentativa, sem indicar que a versão está atualizada.
Se o cache ainda estiver sendo preparado quando o Lira desistir da espera,
o servidor conclui a preparação para os próximos pedidos.

Para manter o cache entre reinícios e publicações do servidor, configure
`LIRA_UPDATE_CACHE_DIR` dentro de um disco persistente do Render. Sem disco,
o cache e o horário da consulta podem ser perdidos em um reinício, exigindo
uma nova busca. O plano gratuito não oferece discos persistentes; veja a
[documentação do Render](https://render.com/docs/disks).

O endpoint é implementado no repositório
[lira-signaling](https://github.com/C1ean-dev/lira-signaling), no módulo
`liraUpdates.mjs`. Os endpoints anteriores de sinalização, convites e
atualização do `lira-clean` continuam independentes.
