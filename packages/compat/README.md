# Compatibilidade de dependências transitivas

Os overrides em `package.json` removem implementações obsoletas e atualizam
dependências indiretas que ainda estão fixadas pelas bibliotecas de origem:

- ASAR 4 usa glob mantido; Node >=22.12 permite o carregamento via CommonJS
  utilizado pelo electron-builder e pelo hook de verificação do pacote.
- global-agent 4 mantém bootstrap e elimina boolean e roarr antigos.
- `temp-rimraf` substitui apenas o rimraf 2 usado por temp no caminho do
  electron-winstaller. Implementa remoção de caminhos literais com `fs.rm`,
  preservando callbacks, remoção síncrona e tentativas em arquivos ocupados.
  Não oferece expansão de glob e não deve ser aplicado globalmente.
- `native-domexception` permite que fetch-blob importe a DOMException nativa,
  sem o polyfill node-domexception abandonado.
- `native-slice` substitui somente o `sliced` abandonado usado por
  `png-chunks-encode`, com `Array.prototype.slice` nativo. A exportação PNG do
  Excalidraw continua convertendo bytes para um array antes de calcular o CRC.
- Transformers 3 mantém o runtime de transcrição e seus arquivos verificados;
  apenas seu processador de imagens Node, `sharp`, recebe a correção 0.35.5.
- Excalidraw 0.18.1 recebe o conversor de diagramas 3.6 e Nano ID corrigidos.
  O conversor mantido remove a árvore antiga de Mermaid e preserva diagramas
  editáveis, sem forçar uma versão incompatível de Mermaid. Minimatch 11 é
  aplicado apenas a `app-builder-lib` e `@electron/universal`, preservando os
  consumidores antigos das versões 3 e 5.

Os adaptadores são pacotes locais privados, incluídos no repositório e resolvidos
pelo lockfile. Não edite node_modules. Remova cada override quando a dependência
de origem deixar de precisar dele. Os testes de compatibilidade ficam em
`src/__tests__/core/dependencyCompatibility.test.ts`.

## Node e scripts de instalação

Use a versão Node 26 registrada em `.node-version` (26.13.1). Os builds
Windows e Android leem esse mesmo arquivo. O requisito `engines.node` acompanha
o mínimo exigido pelo jsdom 31; não se deve reduzir a versão do jsdom para
acomodar um Node antigo.

`allowScripts` registra as versões revisadas dos pacotes com scripts de
instalação. Ao atualizar um deles, revise seu script e atualize a entrada;
`npm install-scripts ls` lista decisões pendentes. Não use aprovação global.

Validação: `npm test` cobre os requisitos de Node, os scripts revisados, ASAR,
PNG e Sharp. `npm run test:dependencies:browser` verifica que o conversor do
Excalidraw continua gerando diagramas Mermaid editáveis com as versões corrigidas.

O SDK fica fora do pré-processamento do Vite para permitir a localização das
fontes. Suas dependências CommonJS precisam constar em `optimizeDeps.include`;
sem isso, o navegador rejeita seus imports e o quadro mostra o erro de
carregamento. `npm run test:whiteboard:browser` abre o editor real, desenha e
verifica a persistência após recarregar, sem acessar serviços externos.
