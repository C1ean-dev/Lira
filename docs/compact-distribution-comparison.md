# Comparação da distribuição compacta

Medição de 14/10/2026. O instalador publicado da versão 1.1.115 foi comparado com um instalador Windows x64 gerado a partir dos dados commitados desta branch. A versão de comparação foi definida como 1.1.115 somente na cópia isolada; a versão do projeto permanece inalterada.

Código medido: `47a1122`. Electron 33.4.11. Dependências instaladas a partir do arquivo de versões fixadas. O aplicativo e os instaladores não foram iniciados.

| Arquivo | Versão 1.1.115 | Distribuição compacta |
| --- | ---: | ---: |
| Instalador | 274,10 MB | 150,84 MB |
| Conteúdo do aplicativo (app.asar) | 283,75 MB | 88,69 MB |
| JavaScript principal da interface | 86,20 MB | 3,62 MB |

Redução real do instalador: **123,26 MB (44,97%)**. Os valores em MB usam 1.000.000 bytes.

## Integridade e compatibilidade

- 1297 imagens distintas foram verificadas por SHA-256 dentro do pacote. Seus bytes foram preservados.
- Os dois catálogos mantêm 117 assets. Suas 1204 ocorrências de imagens embutidas foram substituídas por referências aos arquivos registrados. Nenhuma dessas imagens permaneceu embutida no JavaScript compilado.
- Todas as referências do manifesto e os caminhos locais do HTML possuem arquivos correspondentes no pacote.
- 13 mapas de código do aplicativo foram preservados. Os mapas das dependências foram excluídos.
- Ícones desktop, dependência de runtime ws e capturador nativo de áudio foram conferidos.
- Fontes, catálogos JSON originais, testes, logs e cópias de trabalho ficaram fora do pacote.
- O marcador de pasta vazia .gitkeep não é registrado no manifesto, pois o empacotador exclui esse arquivo.
- A compilação TypeScript, a compilação de produção e a geração do instalador passaram. A suíte final aprovou 2.441 testes, com 4 ignorados, usando os dados commitados.
- Alterações locais de assets, mapas e rede foram preservadas.

## Identificação dos instaladores

- Instalador publicado: 274099234 bytes; SHA-256 `6b70b8e5dd7d48afce51a6f9e57689c31e43687753d3dc7c0ce4345c1281a94b`.
- Instalador compacto: 150839721 bytes; SHA-256 `11439455e9a44a523715b02d4c1a91e395c11d7b4bbb83e6e797a5c26d369c6d`.
