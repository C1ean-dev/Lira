const path = require('node:path')
const assert = require('node:assert/strict')
const { getRawHeader } = require('@electron/asar')

function verifyProductionFiles(files) {
  const hasCatalog = files.includes('dist/assets/library/catalog.json')
  for (const file of files) {
    assert.match(file, /^(?:dist\/|out\/[^/]+\.(?:js|mjs|cjs|map)$|package\.json$|node_modules\/ws\/)/, `Arquivo fora do pacote de produção: ${file}`)
    assert.doesNotMatch(file, /(?:^|\/)(?:__tests__|scripts|fixtures|node_modules\/(?:onnxruntime[^/]*|@huggingface|@img|sharp))(?:\/|$)/, `Dependência ou arquivo desnecessário: ${file}`)
    assert.doesNotMatch(file, /(?:^|\/)ort-wasm[^/]*\.wasm$/, `WASM da transcrição deve ser baixado sob demanda: ${file}`)
    if (hasCatalog) assert.doesNotMatch(file, /^dist\/assets\/library\/(?:library\.xml|library(?:-[a-f0-9]{64})?\.png)$/, `Atlas legado duplicado no pacote: ${file}`)
  }
  for (const required of ['package.json', 'out/main.js', 'out/preload.js', 'dist/index.html', 'dist/icon.png', 'dist/tray-icon.png']) {
    assert(files.includes(required), `Arquivo necessário ausente: ${required}`)
  }
}

module.exports = async context => {
  require('./windows-update-package.cjs').rememberPack(context)
  const files = []
  function visit(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const file = prefix + name
      if (entry.files) visit(entry, file + '/')
      else files.push(file)
    }
  }
  visit(getRawHeader(path.join(context.appOutDir, 'resources', 'app.asar')).header)
  verifyProductionFiles(files)
  console.log(`[Production package] Validated ${files.length} files: compiled app and ws only.`)
}
module.exports.verifyProductionFiles = verifyProductionFiles
