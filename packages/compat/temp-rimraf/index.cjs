const { rm, rmSync } = require('node:fs')

// temp@0.9 uses only literal paths and the rimraf callback/sync API.
// Keep the override scoped to temp; this is not a general glob implementation.
function optionsFor(options) {
  return { recursive: true, force: true, maxRetries: options?.maxBusyTries ?? 3 }
}

function remove(target, options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = undefined
  }
  rm(target, optionsFor(options), callback)
}

remove.sync = (target, options) => rmSync(target, optionsFor(options))
module.exports = remove
