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

Abra o ícone do quadro na barra do espaço ou na chamada. Desenhe com mouse,
toque ou caneta, escolha cor e espessura, desfaça seus traços ou exporte SVG.
Limpar o quadro pede confirmação e afeta todos os participantes do espaço.
O quadro pertence ao espaço inteiro, inclusive participantes em outras zonas.

As operações são transmitidas por P2P. Ao abrir o quadro, um participante recebe
o histórico do anfitrião antes de desenhar. Operações repetidas, concorrentes e
fora de ordem são mescladas; pacotes antigos não restauram traços já apagados.
O estado fica na sessão, sem persistência em disco. Para guardar os desenhos,
exporte antes de sair. O limite é de 1.000 operações entre limpezas; ao atingi-lo,
limpe o quadro para continuar. Todos devem usar uma versão com suporte ao quadro.

## Validação

Os testes de histórico, resumo, captura e sincronização usam dados e respostas
simulados. Não iniciam o app, não abrem navegador e não chamam a IA real.
