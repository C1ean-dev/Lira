// png-chunks-encode only needs to convert Uint8Array data into a plain array.
module.exports = (value, start, end) => Array.prototype.slice.call(value, start, end)
