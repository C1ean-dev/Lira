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
