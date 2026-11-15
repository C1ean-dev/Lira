# Estúdio de Elementos

Mobílias, pisos e paredes usam uma única janela e um único salvamento no catálogo.
Os botões **Criar elemento**, **Criar** e **Editar no estúdio** abrem esse fluxo.
O comando de edição no menu de contexto da mobília também abre o mesmo estúdio.

- **Desenhar**: edite os pixels da camada selecionada com lápis, borracha,
  preenchimento, conta-gotas e mover pixels. Há tamanho de pincel, zoom, grade,
  cores, aparar bordas e desfazer/refazer por gesto. Clique na tela para usar
  Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z ou Ctrl+Y. As demais camadas são preservadas.
- **Importar e recortar**: carregue uma imagem, recorte peças e remova o fundo.
  As peças ficam na biblioteca do próprio estúdio para montar o elemento.
- **Montagem e colisão**: organize camadas, transparência, tamanho, colisões e
  assentos. O painel lateral mantém nome, tipo, categoria, direções e animação.

Trocar de área mantém o documento em edição. **Salvar Elemento no Catálogo**
grava o elemento existente com o mesmo ID ou cria um novo. Alterações de pixels
atualizam o quadro selecionado; os outros quadros, direções e configurações
permanecem no documento. Elementos antigos sem camadas editáveis são abertos
com uma camada base por quadro e direção.

Tamanhos em pixels e tiles são equivalentes: um tile corresponde a 32 pixels.
Por exemplo, 29×27 px corresponde a 0,90625×0,84375 tiles, sem arredondamento
para um tile inteiro. A ferramenta **Aparar bordas** recorta a camada selecionada
e mantém sua posição visual na composição.

O editor de pixels usado para roupas, avatares e pets continua disponível nesses
fluxos. A importação de atlas e o fatiamento de várias imagens continuam como
ferramentas especializadas da biblioteca.

A validação automatizada cobre desenho, histórico, tamanho, edição de quadros,
compatibilidade com elementos antigos, colisões, assentos e salvamento. Ela não
substitui uma revisão visual no aplicativo, que exige autorização conforme o
AGENTS.md do projeto.
