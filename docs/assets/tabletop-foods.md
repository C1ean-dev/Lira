# Comidas pequenas de mesa

Arte aprovada pelo usuário antes da integração, gerada com a ferramenta integrada
`image_gen` e fundo transparente. O PNG aprovado foi copiado sem alterações para
`public/assets/furniture/tabletop-foods.png`.

Os oito recortes são definidos em `src/assets/tabletopFoodAssets.ts`, no formato
nativo `lira-sprite:`. Cada decoração tem entre 18 e 26 pixels de largura, menos
que um quadrado de 32 pixels do mapa. Não bloqueiam a passagem, aparecem acima
das mesas e usam o ajuste fino de um quarto de quadrado existente no editor.
Edições e exclusões da biblioteca local são preservadas.

## Prompt da arte aprovada

Use case: stylized-concept. Asset type: ONE preview concept contact sheet for tabletop food decorations for the existing Lira 2D pixel-art virtual office game, not a final game integration. Create a beautiful cohesive transparent PNG contact sheet showing exactly eight isolated food sprites arranged in 4 columns and 2 rows with generous empty transparent gutters, each object completely separate. Reading order left to right: top row 1 a round pepperoni pizza on a simple plate, 2 a cheeseburger with a small portion of french fries on a plate, 3 a small sushi platter with maki and salmon nigiri, 4 three golden Brazilian coxinhas on a plate; bottom row 5 a small basket of Brazilian pão de queijo, 6 a fruit bowl with apples bananas and grapes, 7 a small strawberry-topped chocolate cake on a plate, 8 a Brazilian meal plate with rice, black beans and grilled steak. These are small placeable tabletop props, NOT furniture: no tables, legs, floor, room, people, text, lettering, numbering, logos, watermark, UI, borders, or decorations outside the food. Style: authentic crisp low-resolution 1990s/2000s top-down RPG pixel sprites matching a Pokemon-like pixel-art office map with blue pixel-outline furniture; square visible pixel clusters, restrained palette, dark charcoal/brown 1-pixel outlines at native size, bright appetizing colors, 3-4 flat shade levels, no gradients, no antialiasing or blur, no photorealism or smooth vector art. Each sprite should read as a native approximately 64x64 or 80x64 pixel object enlarged evenly with nearest-neighbor clarity for this preview. Camera: consistent orthographic three-quarter top-down view looking onto the top surfaces of plates, showing only a little front rim, no isometric diamond camera. Light from upper left, tiny tight pixelated contact shadow immediately under each plate/basket. Keep the same perspective, native pixel density and relative scale across all eight sprites, roughly centered in their cells. True transparent background with alpha, including the gutters. No checkerboard drawn into the image. Output a polished single wide preview sheet.

## Segunda seleção

Adicionados somente os seis recortes aprovados da prévia original: tacos, macarrão, lámen, panquecas, brigadeiros e pudim. Cachorro-quente e pastéis não são cadastrados nem oferecidos na biblioteca. A folha original transparente é preservada em `public/assets/furniture/tabletop-foods-2.png`, usando recortes nativos sem alterar as outras artes. As seis decorações mantêm largura de 22–24 pixels e não bloqueiam passagem.

## Bebidas aprovadas

Seis recortes da prévia gerada por `image_gen` foram adicionados à categoria Bebidas: café, suco de laranja, água com gelo, refrigerante, milkshake de morango e açaí. Chá e limonada não são cadastrados. A folha transparente `public/assets/furniture/tabletop-drinks.png` é usada com recortes nativos; largura de 12–18 pixels, sem colisão e sobre as mesas.

## Bebidas alcoólicas aprovadas

Adicionadas as oito opções aprovadas: chope, vinho tinto, whisky, caipirinha, martíni, gin-tônica, espumante e cerveja em garrafa. Arte gerada pela ferramenta integrada `image_gen`, preservada sem alterações em `public/assets/furniture/tabletop-drinks-alcoholic.png`. Recortes nativos, categoria Bebidas, largura de 8–16 pixels e altura inferior a 22 pixels; sem colisão e renderizados sobre mesas.

Prompt: folha de prévia transparente com oito bebidas alcoólicas isoladas em quatro colunas e duas linhas, sprites de RPG em pixel art vistos de cima em três quartos, contornos escuros e paleta restrita, sombras pequenas, sem marcas ou texto. Caneca de chope, vinho tinto, whisky com gelo, caipirinha, martíni com azeitona, gin-tônica, espumante e garrafa de cerveja. Objetos pequenos para decoração de mesas, ampliados na prévia para aprovação.
