# Distribuição compacta de imagens

Os catálogos em `src/data` e os arquivos em `public` continuam sendo as fontes de edição. A compilação de produção aplica `compactAssetsPlugin`: as imagens embutidas nos dois catálogos e as imagens públicas são armazenadas por SHA-256 em `dist/assets/images`. Conteúdos idênticos usam o mesmo arquivo, sem recodificação ou alteração dos pixels.

Os módulos dos catálogos exportam apenas metadados e referências. `dist/assets/bundled-images.json` registra os arquivos e os caminhos antigos; o módulo de manifesto do renderer recebe a mesma informação. XMLs e outros arquivos públicos são copiados uma vez, e o favicon é atualizado no HTML. O servidor de desenvolvimento continua usando suas fontes normais.

O instalador inclui `dist`, `dist-electron`, dependências de produção e os dois ícones desktop explícitos. O capturador de áudio permanece em `extraResources`. Os mapas de código do aplicativo são mantidos para os relatórios de erro; os mapas das dependências são excluídos. Fontes, catálogos originais, testes, logs e worktrees ficam fora do aplicativo.

## Compatibilidade

O carregamento resolve os caminhos antigos de sprites e XMLs a partir da base do aplicativo, inclusive `file://` no Electron e o endereço do WebView Android. Os IDs, categorias, quadros, camadas e metadados dos assets permanecem iguais.

Gravações de assets personalizados, exportações do editor e perfis convertem referências distribuídas em data URLs antes de persistir. Mensagens para participantes e amigos fazem a mesma conversão, mantendo o protocolo anterior e permitindo que versões antigas recebam as imagens. As operações usam filas ordenadas e capturam os valores no momento da solicitação. Envios pendentes são descartados se a conexão ou a sessão tiver sido substituída.

No Electron, `readBundledImage(hash)` permite ler apenas arquivos registrados no manifesto e verifica o SHA-256 antes de devolver a imagem. No navegador e no Android, a conversão lê o arquivo da distribuição. As leituras de imagens têm concorrência limitada a quatro. Uma falha de leitura impede a gravação ou o envio de referências quebradas; a fila continua disponível para operações posteriores.

## Verificação

Os testes cobrem a emissão e deduplicação dos arquivos, preservação dos bytes e metadados de todos os catálogos e imagens públicas, caminhos antigos e atlas, gravações, perfis e mensagens portáveis. A suíte completa pode ser executada numa cópia isolada com os dados commitados quando houver edições locais dos catálogos. O teste de importação dos módulos usa o prazo de 30 segundos nessa execução, pois precisa carregar os catálogos originais grandes; não é uma medição de tempo de abertura do aplicativo.

O tamanho final deve ser medido gerando um novo instalador após autorização; o inventário das fontes e os testes não substituem essa medição.
