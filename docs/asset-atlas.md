# Biblioteca de assets

Personagens, pets, mobílias, pisos e paredes usam uma biblioteca PNG + XML em
`public/assets/library`. O XML `library.xml` aponta para o PNG pelo nome com hash.
O índice dos XMLs distribuídos é gerado automaticamente pelo Vite; não há um
catálogo JSON para manter.

O formato é Sparrow, com `TextureAtlas`, `SubTexture` e uma extensão
`LiraAssets` versionada. Essa extensão guarda IDs, categorias, animações,
dimensões, colisões e dados do editor como elementos XML tipados. Imagens são
referências a `SubTexture`; miniaturas e composições reproduzíveis são derivadas
em memória. Frames idênticos aos recortes de uma folha original reutilizam suas
coordenadas. Os IDs existentes dos assets e dos mapas permanecem iguais.

No desenvolvimento, a biblioteca é salva no projeto. O Electron instalado usa
`userData/assets/library`. Web e Android usam uma transação IndexedDB com PNG
como blob e XML como texto. O par local completo representa a biblioteca atual,
inclusive exclusões, e tem precedência sobre os assets distribuídos.

A gravação em disco escreve primeiro um PNG imutável e confirma a mudança ao
substituir o XML. Um bloqueio entre processos impede que duas instâncias limpem
o PNG de outra gravação. PNGs antigos sem referências são recolhidos após a
confirmação. Importação, fatiador e estúdio aguardam essa confirmação.

A inicialização publica os frames já reconstruídos pelo leitor do atlas. O
pré-carregamento do cache de imagens é opcional, limita as decodificações
simultâneas e espera no máximo um segundo. Rejeições ou promessas pendentes
nessa etapa não bloqueiam a abertura. A validação do PNG/XML continua obrigatória
antes de qualquer gravação ou substituição da biblioteca.

Na primeira abertura, o app migra o catálogo antigo do Electron e
`lira_custom_user_assets`. Alterações locais têm precedência. Os dados antigos
só são retirados depois da validação e gravação do par. A migração do catálogo
do repositório pode ser repetida com `python scripts/migrate-asset-atlas.py`
(requer Pillow); sem assets antigos, ela não modifica a biblioteca.

O compartilhamento envia PNG + XML com SHA-256 e valida o conteúdo antes de
aplicá-lo. Atlas recebidos são reutilizados por hash em memória. Os clientes
precisam estar atualizados para usar esse formato.

O fatiador aceita vários spritesheets PNG por personagem. Cada recorte identifica
sua folha de origem; `sourceSheets` e os frames de `activityAnimations` são
referências XML ao mesmo atlas, sem criar um catálogo de imagens separado.
Caminhar tem quatro direções. Bocejar e dormir têm uma sequência única em loop,
independente da direção da caminhada. As versões antigas com ações por direção
são reunidas em uma lista, preservando os frames e suas folhas de origem.
Ao exportar várias folhas pelo fatiador, o PNG combinado acompanha o XML, que inclui os
deslocamentos das folhas e nomes de frames com `yawn` e `sleep`.

Dentro do espaço, a inatividade dispara um bocejo a cada 60 segundos e mantém
o sono após 5 minutos. Cliques, teclado, movimento do ponteiro, rolagem, edição
de campos e movimento do personagem reiniciam o prazo. O estado visual é
compartilhado com os participantes, sem alterar o status de presença escolhido.
Personagens sem frames próprios dessas ações exibem um indicador discreto.

## Verificação

- `npx tsc --noEmit` e `npx vitest run`.
- `node_modules/electron/dist/electron.exe scripts/verify-spritesheet-slicer.cjs`
  verifica recortes, zoom, várias folhas, animações, PNG inválido e salvar/reabrir
  com o leitor/gravador de atlas real em memória, usando um perfil isolado.
- `npx vite build` para Electron; `LIRA_TARGET=web npx vite build` para web/Android.
- Com um servidor web de desenvolvimento em execução, defina `LIRA_TEST_URL` e
  execute `node scripts/verify-asset-atlas.mjs`. O teste usa Edge headless,
  perfil isolado e armazenamento de teste, sem escrever na biblioteca real.
- Após o build Electron, execute
  `node_modules/electron/dist/electron.exe scripts/verify-asset-electron.cjs`
  para verificar o preload e a gravação IPC reais em uma pasta temporária.

As folhas de origem que não tinham uma cópia integral comprovada permanecem
preservadas. A biblioteca ativa não depende de imagens embutidas em JSON nem
de PNGs individuais de frames.
