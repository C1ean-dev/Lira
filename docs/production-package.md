# Pacote de produção

Plataformas suportadas: Windows x64 (Intel/AMD) e Android. O instalador Windows
não inclui runtimes de macOS, Linux ou Windows ARM.

O Vite copia `public` para `dist` e compila o frontend nessa mesma pasta.
O instalador inclui somente `dist`, os bundles de `out`, `package.json`,
o módulo `ws` usado pelo processo principal e o auxiliar nativo de captura
de áudio. Fontes, testes, scripts e o projeto Android permanecem no repositório.
Os mapas sem conteúdo-fonte dos bundles continuam disponíveis para o serviço
de diagnóstico de erros em produção.

Bibliotecas do frontend são dependências de desenvolvimento: o Vite incorpora
o código necessário aos bundles. Apenas `ws`, externalizado no processo
principal, precisa existir em `node_modules` no aplicativo instalado.

`scripts/verify-production-package.cjs` inspeciona o ASAR no `afterPack` e falha
se entrar um arquivo fora desse limite, um runtime ONNX nativo, uma dependência
de IA ou um WASM de transcrição. A verificação executa antes de gerar o instalador.

## Transcrição opcional

Abrir o painel não baixa arquivos. No primeiro uso, **Baixar e iniciar
transcrição** baixa o runtime web de Transformers.js e o modelo Whisper.
O progresso distingue o módulo do arquivo de modelo que está sendo preparado.
Cancelar encerra o worker e suas requisições; arquivos já completos permanecem
salvos e podem ser reutilizados na próxima tentativa.

O runtime é fixado em 3.8.1. Os três arquivos necessários, com cerca de 22,5 MB
no total, vêm do pacote oficial no jsDelivr. Tamanho e SHA-256 são verificados
antes de salvar e executar. O modelo é baixado do Hugging Face pela biblioteca.
Nenhuma biblioteca de IA ou WASM dessa transcrição entra no APK ou no instalador.

Dependências e modelos ficam como blobs no IndexedDB `lira-optional-modules`,
com namespace por versão. Isso funciona na origem de arquivo do Electron e na
origem local do WebView Android. O modelo usa um adaptador de cache persistente;
uma nova sessão consegue iniciar sem rede depois da primeira instalação completa.
Excluir os dados locais do aplicativo também exclui o módulo baixado.

Ao atualizar Transformers.js, atualizar os hashes/tamanhos do manifesto em
`transcriptionModule.ts` e validar novamente o carregamento real do WASM/modelo.

## Validação

- `npm test`: inclui isolamento do pacote, integridade e reutilização dos downloads.
- `npm run build`: compila e empacota Windows x64, aplicando a verificação do ASAR.
- `LIRA_TARGET=web npx vite build`: gera o frontend usado pelo Android.
- `LIRA_RUN_TRANSCRIPTION_TESTS=1 node --test scripts/transcription-module.electron.test.mjs`:
  usa um perfil Electron temporário para testar ausência de download inicial,
  instalação real e reinício offline. Requer internet e baixa o modelo somente
  para esse perfil de teste, removido ao terminar.
