# Biblioteca de imagens individuais

O fluxo normal usa `assets/library/catalog.json` e `assets/library/images/`.
O catálogo preserva IDs, categorias, animações, coordenadas do recortador e
metadados de edição. Cada arquivo de imagem usa SHA-256 do seu conteúdo no nome.
As folhas de origem e os frames permanecem imagens independentes; imagens iguais
são compartilhadas. Nenhum atlas global é montado para carregar ou salvar.

No desktop, abrir a biblioteca lê apenas o catálogo. As imagens são carregadas
pelo renderizador conforme forem usadas, com cache por URL. No navegador,
os dados locais usam IndexedDB com blobs e URLs estáveis, sem decodificação
antecipada dos pixels. O primeiro armazenamento local copia imagens distribuídas
necessárias antes de publicar o catálogo. As gravações publicam o catálogo só
após disponibilizar todas as imagens referenciadas.

Clientes atuais negociam o protocolo de imagens individuais, trocam o catálogo
e solicitam apenas imagens ausentes. Os bytes são enviados em blocos e conferidos
por SHA-256. Exportação PNG/XML e clientes anteriores ainda usam o adaptador de
atlas, sem mudar o armazenamento normal.

A inicialização migra automaticamente bibliotecas PNG/XML e dados antigos locais
quando ainda não existe catálogo novo. Edições e exclusões locais prevalecem
sobre os assets distribuídos. Os arquivos anteriores são mantidos como cópia.
Para converter uma biblioteca distribuída antes de empacotar, use
`python scripts/migrate-individual-library.py public/assets/library` com Pillow.
O conversor preserva folhas, recortes e camadas de edição, materializando os
frames antigos que eram derivados de composições.
