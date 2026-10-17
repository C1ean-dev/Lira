# Biblioteca de imagens individuais

O fluxo normal usa `assets/library/catalog.json` e `assets/library/images/`.
O catálogo preserva IDs, categorias, animações, coordenadas do recortador e
metadados de edição. Cada arquivo de imagem usa SHA-256 do seu conteúdo no nome.
As folhas de origem e os frames permanecem imagens independentes; imagens iguais
são compartilhadas. Nenhum atlas global é montado para carregar ou salvar.

No Electron em desenvolvimento, a interface HTTP carrega as imagens pelo mesmo
servidor Vite, em `assets/library/images/`. URLs `file://` devolvidas pelo processo
principal são convertidas para esse endereço ao carregar e salvar: Chromium
bloqueia arquivos locais quando a página usa HTTP. O aplicativo empacotado mantém
as URLs locais da biblioteca do usuário, sem alterar a segurança do navegador.

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

O teste `npm run test:sprites:electron` verifica a decodificação das imagens
salvas, distribuídas e retornadas após editar, nas interfaces HTTP e `file://`.
Também abre todas as imagens referenciadas no catálogo real do projeto, sem
modificá-las; somente a biblioteca temporária de teste recebe gravações.
É necessário consultar o usuário antes de executá-lo, conforme AGENTS.md.

Verificação local de 17/10/2026: o teste reproduziu o bloqueio de `file://` na
interface HTTP antes da correção. Depois dela, as 848 imagens do catálogo local
decodificaram nas interfaces HTTP e `file://`, incluindo os casos de carregar,
editar/salvar e usar imagens distribuídas. A suíte completa passou em 253 arquivos,
com 2.588 testes aprovados e quatro variações condicionais de cursor ignoradas.
