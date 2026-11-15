# Estúdio de Elementos

Mobílias, pisos e paredes usam uma única janela e um único salvamento no catálogo.
Os botões **Criar elemento**, **Criar** e **Editar no estúdio** abrem esse fluxo.
O comando de edição no menu de contexto da mobília também abre o mesmo estúdio.

- **Desenhar**: edite os pixels da camada selecionada com lápis, borracha,
  preenchimento, conta-gotas e mover pixels. Há tamanho de pincel, zoom, grade,
  cores, aparar bordas e desfazer/refazer por gesto. Clique na tela para usar
  Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z ou Ctrl+Y. As demais camadas são preservadas.
  O desenho começa centralizado e ajustado à área disponível. A roda do mouse
  aproxima ou afasta mantendo o ponto sob o cursor. Arraste com o botão direito,
  com o botão do meio ou com Espaço + esquerdo para mover a visualização. É possível
  pressionar o direito durante um traço e depois continuar com o esquerdo sem
  pintar o caminho da movimentação. **Ajustar desenho à área** restaura o enquadramento.
  Ao passar o cursor, um destaque suave mostra os pixels afetados pela ferramenta:
  tamanho do lápis/borracha, região conectada do preenchimento, pixel do conta-gotas
  ou área visível a mover. A prévia acompanha a grade e o zoom, não é salva na imagem
  e fica oculta durante a navegação da tela.
  Cada ferramenta tem seu próprio cursor: lápis, borracha, balde de tinta,
  conta-gotas e mover pixels. A ponta do ícone acompanha o pixel da operação;
  ao arrastar a visualização, o cursor muda para a mão.
- **Importar e recortar**: carregue uma imagem, recorte peças e remova o fundo.
  As peças ficam na biblioteca do próprio estúdio para montar o elemento.
- **Montagem e colisão**: organize camadas, transparência, tamanho, colisões e
  assentos. O painel lateral mantém nome, tipo, categoria, direções e animação.

Trocar de área mantém o documento em edição. **Salvar Elemento no Catálogo**
grava o elemento existente com o mesmo ID ou cria um novo. Alterações de pixels
atualizam o quadro selecionado; os outros quadros, direções e configurações
permanecem no documento. Elementos antigos sem camadas editáveis são abertos
com uma camada base por quadro e direção.

O painel apresenta dois controles em pixels: **Tamanho da tela**, que define a
resolução da camada em edição, e **Tamanho final no mapa**, que define a exibição
do elemento. Os tamanhos são independentes. Ao ampliar a tela, os pixels existentes
são mantidos; ao reduzir, as bordas direita e inferior ficam apenas ocultas.
A imagem completa é preservada em PNG junto da camada, inclusive depois de salvar
e reabrir o elemento. Ampliar novamente recupera os pixels ocultos; áreas que nunca
tiveram conteúdo ficam transparentes. Desenhar ou apagar na área visível mantém
os pixels de fora da tela intactos. O ajuste proporcional ou esticado continua disponível
para a exibição final. A resolução de desenho fica salva com as camadas.

A conversão para tiles continua interna: um tile corresponde a 32 pixels, sem
arredondar elementos pequenos para um tile inteiro. A ferramenta **Aparar bordas**
recorta a camada selecionada e mantém sua posição visual na composição.

O editor de pixels usado para roupas, avatares e pets continua disponível nesses
fluxos. A importação de atlas e o fatiamento de várias imagens continuam como
ferramentas especializadas da biblioteca.

A validação automatizada cobre desenho, histórico, tamanho, edição de quadros,
compatibilidade com elementos antigos, colisões, assentos e salvamento. Ela não
substitui uma revisão visual no aplicativo, que exige autorização conforme o
AGENTS.md do projeto.
