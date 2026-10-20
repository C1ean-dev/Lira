# Folhas originais e recortes XML

O catálogo versão 3 guarda os PNGs originais uma única vez. Cada quadro é um
elemento XML `<Sprite image="...png" x="..." y="..." width="..." height="..."/>`.
A ordem dos elementos nas listas de direção e animação define a reprodução,
inclusive quadros repetidos. As versões anteriores continuam legíveis.

`spriteFrame` e `readSpriteFrame` fazem a ligação entre o XML e a referência usada
em memória. O carregador decodifica a folha e desenha a região em um canvas em
memória. As prévias DOM e os editores materializam uma URL somente quando precisam
de um `<img>`; essas imagens de prévia não são gravadas na biblioteca.

Ao salvar, `compactSourceSprites` compara os pixels antes de reutilizar coordenadas
da folha original. Se uma edição alterou os pixels ou as dimensões de um quadro,
os quadros atuais são reunidos sem redimensionamento em uma folha atualizada.
O catálogo, os metadados do editor e os XMLs recebem as coordenadas correspondentes.
As camadas editáveis, colisões, nomes, identificadores e sequências são preservados.

Cada asset tem uma pasta `assets/library/sprites/<nome>--<id>/`, com suas imagens
e o `sprite.xml` Sparrow quando possui recortes. Nomes são normalizados para uso
em arquivos e o ID distingue sprites com o mesmo nome. Ao adicionar ou renomear
um sprite, o salvamento calcula a pasta automaticamente. Folhas compartilhadas
têm uma cópia em cada pasta para que os XMLs sejam independentes.

O catálogo mantém os hashes das imagens e um mapa opcional `imagePaths` para os
caminhos organizados. Catálogos antigos sem esse mapa continuam usando `images/`;
ao salvar, as imagens são copiadas para a nova organização sem apagar arquivos
ainda referenciados por uma sessão aberta. As transferências atuais enviam a
folha e o XML. Cada participante anuncia a versão do catálogo que consegue ler.
Clientes de catálogo v2 recebem quadros materializados no formato anterior;
clientes anteriores ao protocolo de imagens individuais recebem o atlas legado.
Essas conversões acontecem somente durante a transferência e não alteram a
biblioteca local de folhas originais.

A cópia anterior à migração do projeto fica em `.scratch/source-sprites-before/`.
Imagens antigas sem referências no catálogo são movidas para essa cópia, para que
os recortes individuais não entrem novamente no pacote distribuído.
