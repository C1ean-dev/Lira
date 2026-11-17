# Armazenamento e recuperação

Os armazenamentos atuais permanecem em uso. Esta migração não adiciona SQL nem ORM.

## Preferências e dados locais

`src/store/persistedState.ts` centraliza o middleware `persist` do Zustand e os
schemas Zod. O adaptador lê e grava o JSON original nas mesmas chaves, sem adicionar
um envelope obrigatório. Também aceita um envelope Zustand para migração.
Cada store expõe os métodos públicos anteriores e mantém um subestado persistente.
Mudanças de posição, FPS, streams, conexões ou abertura de painéis não provocam
escritas. Chaves de API permanecem em memória. Preferências de áudio continuam
agrupadas antes da escrita.

| Dados | Chaves / formato preservados |
| --- | --- |
| Gráficos e áudio | `lira_graphics_settings`, `lira_audio_settings`: objetos JSON |
| Perfil e contatos | Chaves anteriores de perfil, amigos e perfis de amigos |
| Chat | Mensagens diretas, canais diretos e marcos de leitura nas chaves anteriores |
| Reuniões | `lira_meeting_history`: até 20 reuniões neste dispositivo |
| Mapas | `lira_custom_map`: formato compactado anterior |
| Espaços | `lira_saved_spaces`: lista com mapas compactados; chave do espaço ativo preservada |

Espaços salvos localmente continuam prevalecendo sobre os espaços nativos com o
mesmo ID. A sincronização com arquivos nativos permanece separada do adaptador.
JSON corrompido ou incompatível usa os padrões do store e registra diagnóstico;
uma falha de escrita mantém a alteração disponível em memória.

## IndexedDB

O adaptador `idb` substitui callbacks e Promises manuais. Não há mudança de nome,
versão ou object stores dos bancos existentes:

| Banco | Versão | Conteúdo |
| --- | --- | --- |
| `lira-image-library` | 1 | `catalog` e `images`; chave de catálogo `library` |
| `lira-optional-modules` | 1 | Cache do módulo de transcrição, nas chaves anteriores |
| `lira-whiteboards` | 1 | Novo store `documents`, chaveada pela identidade da sala |

Catálogo e blobs de imagens são gravados na mesma transação. Se faltar uma imagem
ou a transação abortar, o catálogo anterior permanece válido. Download, integridade
e cache de URLs continuam fora do adaptador. Aguardar a Promise da transação
significa aguardar a gravação, não apenas o sucesso de uma requisição.

## Conversão dos quadros

Cada documento novo contém `schemaVersion: 2`, operações compactadas e relógio
lógico. Elementos e arquivos usam os tipos do Excalidraw. A conversão lê
`lira_whiteboard_<identificador da sala codificado>`, restaura traços/objetos e
imagens com o SDK e só então grava o documento por sala em IndexedDB. IDs,
coordenadas e revisões são conservados; um ponto isolado continua sendo um ponto.
Repetir a migração não duplica objetos nem muda suas revisões.

Os bytes antigos do localStorage **não são apagados**. Após a conversão, apenas o
novo banco recebe edições. A cópia antiga não contém desenhos feitos depois da
migração. A persistência e a sincronização assíncronas isolam salas diferentes;
limpezas e exclusões mantêm barreiras contra revisões atrasadas.

## Recuperação

Antes de reverter uma versão ou apagar armazenamento, exporte o quadro atual em
`.excalidraw` e preserve os dados locais. Para voltar ao editor antigo, reverta
seletivamente os commits do quadro e use a cópia anterior preservada. Não apague o
banco novo para tentar recuperar alterações recentes: elas só existem nele ou em
uma exportação. Os dados legados guardados permitem repetir a conversão se a
primeira tentativa falhar.

Para as outras etapas, os formatos permanecem compatíveis: a recuperação se faz
pela reversão seletiva do commit correspondente. Preserve sempre alterações do
usuário que não pertençam à refatoração. O checklist e os commits estão em
[Refatoração com bibliotecas](refatoracao-bibliotecas.md).
