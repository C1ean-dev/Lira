# ADR-0002: Image table and lossless PNGs in the native data files

## Status
Accepted

## Context
`src/data/nativeAssets.json` holds the assets made in the editor and shipped with the app. It was 3.9 MB, and 97% of that was base64 PNG:

- The same picture is stored in several fields of an asset (`frames`, `directionalFrames`, `slicerPresets`, the editor's layers, `thumbnail`). 1,217 data URLs in the file were 565 different pictures, so 41% of the file was repeated copies.
- The canvas writes every PNG as 8-bit RGBA with no filtering, and nearly all of the pictures are pixel art. 510 of the 565 have 256 colours or fewer.

The file is imported as a JSON module (so it is in the renderer bundle and parsed at start), mirrored into `localStorage`, and written again in full at every start and every edit.

## Decision
1. **A table of images.** On disk each distinct image is stored once, under a top-level `images` key, and the fields that use it hold a reference, `"@<id>"`. The id is a hash of the stored image, so it does not depend on the order of the assets. Text that starts with `@` is written with one more `@`. A file with no `images` key is the old format and is read as it is. The code is `src/utils/imageTable.ts`; `useCustomAssetsStore` expands the table when it reads the file, so nothing else sees references.
2. **Lossless PNG re-encoding on write.** `electron/pngOptimizer.ts` rewrites an 8-bit RGBA PNG as an indexed PNG when it has at most 256 colours, and otherwise picks the best filter for each row. The pixels are identical. Colour-space chunks (`sRGB`, `iCCP`, `gAMA`, `cHRM`, `cICP`) are copied as they are. Anything it does not understand (other formats, interlaced, animated, damaged, over 2 million pixels) is left untouched.
3. **A marker on what was looked at.** Every PNG the optimizer has examined gets an empty private chunk, `liRa`. The next write skips it without decoding, so the writes at start and after each edit cost milliseconds; only a new image costs time.
4. **One writer.** `electron/nativeDataFile.ts` is used by the Electron main process (`save-native-assets` / `load-native-assets`) and by the Vite dev middleware (`/api/save-native-assets`). The renderer still sends the full data. The file keeps its layout: two-space indentation, no final newline.

## Consequences
- `nativeAssets.json` went from 3.94 MB to 1.71 MB (-57%), and each save moves less through the disk and the git history. The bundle is smaller by the same amount. Checked on the real file: all 1,205 pictures decode to the same pixels.
- The first write after upgrading re-encodes everything (about 2 s, once); the file is then stable, byte for byte, between writes.
- `localStorage` still holds the expanded assets (the optimized PNGs make it about a third smaller; the table does not help there). Storing only what differs from the shipped assets would shrink it further.
- `nativeSpaces.json` has no images (67 KB) and is unchanged.
- Editor-only data (`frameLayers`, `sourceImageSrc`, `slicerPresets`) is still stored. Dropping it would save another 0.5 MB but would take layer-level editing away from the shipped assets.
