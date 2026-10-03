# Lira Context

Lira Desktop Virtual Office & Coworking with Pixel Art, Realtime Map Editor, Zone Calls, Screenshare, and Noise Suppression.

## Language

### Avatar & Character Customization

**Avatar Preset**:
A selectable, reusable visual variant of a modular avatar component (e.g. hair style, shirt type, facial hair).
_Avoid_: Skin preset, character template

**Component Layer**:
One of the eleven canonical visual rendering layers that compose the complete modular avatar (`skin`, `eyes`, `hair`, `facialHair`, `top`, `jacket`, `bottom`, `shoes`, `hat`, `glasses`, `other`).
_Avoid_: Body part, sprite slot

**Avatar Sprite Sheet**:
A PNG image file containing packed graphic frames, poses, and angles for modular avatar components.
_Avoid_: Spritemap, texture page

**Sprite Atlas XML**:
An XML metadata file in Sparrow/Starling/TexturePacker format mapping subtexture names (`<category>_<presetId>_<direction>_<frame>`), source coordinates `(x, y)`, dimensions `(width, height)`, and frame offsets for elements packed in an Avatar Sprite Sheet.
_Avoid_: Coordinates list, sprite config

**AvatarAtlasManager**:
Engine service that asynchronously fetches, parses, and caches avatar spritesheets and XML atlases, providing O(1) subtexture coordinates and canvas draw calls.
_Avoid_: Sprite cache, texture helper

**Custom Asset**:
A user-created or user-customized pixel art graphic element stored permanently in native assets or space data.
_Avoid_: Upload, custom image

**Bake on Demand**:
Dynamic offscreen canvas rasterization that renders a procedural or composite preset into an editable pixel art raster buffer.
_Avoid_: Screenshot, raster copy

**Hybrid Fallback**:
Rendering resolution order where the engine attempts to draw from the Sprite Atlas first, then custom native assets, falling back to legacy procedural renderers if no raster sprite exists.
_Avoid_: Fallback cascade, double render

### Chamada de Zona & Mídia

**Chamada de Zona**:
Mesh de áudio e vídeo formada automaticamente entre os participantes cujo identificador de zona atual coincide dentro de uma sala privada.
_Avoid_: Videochamada, conferência

**Live**:
Transmissão da tela de um participante para os demais presentes na mesma zona.
_Avoid_: Stream, broadcast

**Trilha Local**:
Fluxo de microfone e webcam do próprio usuário após processamento de áudio, sempre com uma trilha de áudio e uma de vídeo.
_Avoid_: Stream do mic

