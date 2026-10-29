# Compatibilidade de dependências transitivas

Os overrides em `package.json` removem implementações obsoletas sem alterar o
runtime Electron do aplicativo:

- ASAR 4 usa glob mantido; Node >=22.12 permite o carregamento via CommonJS
  utilizado pelo electron-builder e pelo hook de verificação do pacote.
- global-agent 4 mantém bootstrap e elimina boolean e roarr antigos.
- `temp-rimraf` substitui apenas o rimraf 2 usado por temp no caminho do
  electron-winstaller. Implementa remoção de caminhos literais com `fs.rm`,
  preservando callbacks, remoção síncrona e tentativas em arquivos ocupados.
  Não oferece expansão de glob e não deve ser aplicado globalmente.
- `native-domexception` permite que fetch-blob importe a DOMException nativa,
  sem o polyfill node-domexception abandonado.

Os adaptadores são pacotes locais privados, incluídos no repositório e resolvidos
pelo lockfile. Não edite node_modules. Remova cada override quando a dependência
de origem deixar de precisar dele. Os testes de compatibilidade ficam em
`src/__tests__/core/dependencyCompatibility.test.ts`.
