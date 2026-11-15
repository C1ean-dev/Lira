# Animações no mini display

O botão com ícone de rosto sorridente no cabeçalho do mini display abre as animações disponíveis do personagem
atual. Dormir e bocejar aparecem como **Dormir** e **Bocejar** quando essas
sequências existem no personagem. As outras atividades salvas em
`activityAnimations` aparecem automaticamente com o nome escolhido pelo usuário sem emojis decorativos.
A lista acompanha alterações do catálogo e trocas de personagem enquanto aberta.
Personagens sem sequências apresentam uma mensagem explicativa.

Selecionar uma atividade inicia a reprodução no mapa e transmite o início aos
outros participantes. A escolha manual permanece ativa durante interações com
os menus. **Parar animação**, voltar a andar ou trocar para um personagem sem a
sequência encerra a escolha. Depois disso, as animações automáticas por inatividade
continuam funcionando. É possível reiniciar a mesma animação selecionando-a de novo.

O menu fecha ao selecionar, clicar fora, pressionar Escape ou redimensionar a janela.
Ele aparece em uma camada própria, com altura limitada, para funcionar também quando
o painel da chamada estiver recolhido ou próximo às bordas da janela.

No editor de spritesheets, **Nova animação** cria uma sequência independente.
Digite o nome, confirme em **Criar animação** e adicione os recortes ou use
**Pintar** para desenhar seus frames. Os frames podem ser duplicados, removidos
ou reordenados como nas outras sequências. **Salvar Alterações** grava o personagem;
as sequências com frames passam a aparecer no menu de animações.

A animação personalizada selecionada oferece **Renomear animação** e
**Excluir animação**. Renomear preserva a sequência e os frames. Nomes podem ter
espaços, acentos, pontuação e emojis; nomes vazios ou repetidos no mesmo personagem
são recusados. Caminhar, Bocejar e Dormir continuam disponíveis como sequências padrão.
Cada preset mantém suas próprias animações.

As sequências usam identificadores estáveis e seus nomes são salvos separadamente
em `activityAnimationNames` e `animationNames` nos presets editáveis. O catálogo,
a reconstrução da folha e a exportação/importação Sparrow preservam os nomes e
os recortes. Os identificadores Sparrow de Bocejar e Dormir continuam compatíveis
com os arquivos anteriores.
