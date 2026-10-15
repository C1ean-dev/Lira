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

Na primeira abertura, o app migra o catálogo antigo do Electron e
`lira_custom_user_assets`. Alterações locais têm precedência. Os dados antigos
só são retirados depois da validação e gravação do par. A migração do catálogo
do repositório pode ser repetida com `python scripts/migrate-asset-atlas.py`
(requer Pillow); sem assets antigos, ela não modifica a biblioteca.

O compartilhamento envia PNG + XML com SHA-256 e valida o conteúdo antes de
aplicá-lo. Atlas recebidos são reutilizados por hash em memória. Os clientes
precisam estar atualizados para usar esse formato.

## Verificação

- `npx tsc --noEmit` e `npx vitest run`.
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
