# Ferramentas de colaboração

## Desfazer e refazer no editor de espaço

Os botões ficam no cabeçalho do editor. Use Ctrl/Cmd+Z para desfazer e
Ctrl/Cmd+Shift+Z ou Ctrl+Y para refazer. Os atalhos preservam a edição de texto
em campos e diálogos. Uma pincelada ou arraste contínuo ocupa uma entrada do
histórico, limitado às últimas 100 ações. Uma edição nova elimina a pilha de
refazer. Pisos, paredes, móveis, zonas e a limpeza do mapa podem ser restaurados.

O mapa restaurado é salvo e sincronizado com o espaço. Carregar outro documento,
trocar de espaço ou receber uma edição remota reinicia o histórico local para
evitar sobrescrever as alterações de outra pessoa.

## Resumos após a chamada

Abra **Transcrição** na chamada expandida e inicie o Whisper. O módulo e o modelo
de voz são baixados no primeiro uso; o áudio é processado localmente. A captura
é iniciada apenas por esse comando. Ao parar, voltar ao mapa, mudar de zona ou
sair do espaço, as últimas falas pendentes são processadas e arquivadas.

O botão de resumos fica na barra do espaço, na chamada e no menu inicial.
As 20 reuniões mais recentes ficam neste dispositivo. É possível consultar as
falas, excluir uma reunião ou exportar o resumo e a transcrição em Markdown.
Se o armazenamento estiver cheio, o painel avisa para exportar antes de fechar.
Iniciar outra transcrição cria uma nova reunião.

Depois de finalizar a transcrição, informe uma chave OpenRouter e clique em
**Gerar resumo com IA**. A chave da sala já configurada para Pet IA também pode
ser usada. A chave permanece em memória. Somente essa ação envia o texto
transcrito à OpenRouter e ao provedor do modelo `openrouter/free`; o áudio não
é enviado. Reuniões longas são resumidas por partes e depois consolidadas em
resumo, decisões, tarefas com responsáveis/prazos e pendências. Falhas da IA
preservam as falas para uma nova tentativa. A disponibilidade e os limites do
modelo dependem do provedor e da chave.

## Quadro branco colaborativo

Abra o ícone do quadro na barra do espaço ou na chamada. O painel carrega o
Excalidraw sob demanda, em português. Desenho, seleção, transformação e histórico
local usam o SDK. Os atalhos ficam dentro do painel; temas claro/escuro e laser
compartilhado continuam disponíveis. Limpar pede confirmação e afeta todos.

**Abrir quadro** aceita arquivos antigos `lira-whiteboard` e `.excalidraw`. A
importação substitui a cena com uma barreira de limpeza sincronizada. O menu do
editor exporta `.excalidraw`, SVG e PNG. Imagens precisam estar incorporadas no
arquivo; URLs remotas e embeds não são aceitos. As fontes acompanham o aplicativo,
sem necessidade de CDN; recursos de IA e serviços externos não são habilitados.

O quadro pertence ao espaço inteiro, inclusive participantes em outras zonas.
As operações e imagens continuam usando o P2P do Lira. Ao abrir, o participante
aguarda o estado do anfitrião antes de editar; arquivos de imagem já presentes
não precisam ser enviados novamente. Alterações repetidas, concorrentes e fora
de ordem são mescladas por objeto. Exclusões e limpezas preservam barreiras contra
pacotes antigos. Mudanças remotas não criam ações no histórico local nem retornam
à rede como edições locais.

Os documentos versão 2 ficam em IndexedDB, separados por sala, inclusive offline.
Na primeira abertura, o Lira converte os dados antigos usando a restauração do
SDK, grava o novo documento e conserva a cópia original do localStorage. Se a
gravação falhar, o desenho continua na memória e aparece um aviso para exportar.
Veja [Armazenamento e recuperação](armazenamento.md) antes de remover dados locais.

O limite continua em 1.000 operações compactadas, incluindo imagens, exclusões e
a barreira da última limpeza. Revisões de um objeto substituem sua revisão anterior.
Arquivos importados reservam espaço para a barreira. Limpar permite continuar ao
atingir o limite; uma imagem pode ocupar até 2.000.000 caracteres de data URL.
Todos os participantes precisam da versão **1.1.211 ou superior**. Os payloads usam
`schemaVersion: 2`; não há comunicação com o editor anterior.

## Validação

Os testes de histórico, resumo, captura e sincronização usam dados e respostas
simulados. Não iniciam o app, não abrem navegador e não chamam a IA real.
