import { resolveBundledAssetUrl } from '../../media/bundledImages'

export interface SubTexture {
  name: string
  x: number
  y: number
  width: number
  height: number
  frameX?: number
  frameY?: number
  frameWidth?: number
  frameHeight?: number
}

export interface TextureAtlasData {
  imagePath: string
  subTextures: Map<string, SubTexture>
}

export class AvatarAtlasManager {
  private static atlases: Map<string, TextureAtlasData> = new Map()
  private static imageCache: Map<string, HTMLImageElement> = new Map()
  private static loadingPromises: Map<string, Promise<boolean>> = new Map()
  private static version: number = 0

  static getVersion(): number {
    return AvatarAtlasManager.version
  }

  static parseAtlasXml(xmlString: string): TextureAtlasData {
    const result: TextureAtlasData = {
      imagePath: '',
      subTextures: new Map(),
    }

    if (!xmlString || typeof xmlString !== 'string') {
      return result
    }

    try {
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser()
        const doc = parser.parseFromString(xmlString, 'application/xml')

        const parserError = doc.querySelector('parsererror')
        if (parserError) {
          return this.parseAtlasXmlWithRegex(xmlString)
        }

        const atlasNode = doc.querySelector('TextureAtlas')
        if (atlasNode) {
          result.imagePath = atlasNode.getAttribute('imagePath') || ''

          const subNodes = atlasNode.querySelectorAll('SubTexture')
          subNodes.forEach((node) => {
            const name = node.getAttribute('name')
            const xStr = node.getAttribute('x')
            const yStr = node.getAttribute('y')
            const wStr = node.getAttribute('width')
            const hStr = node.getAttribute('height')

            if (name && xStr !== null && yStr !== null && wStr !== null && hStr !== null) {
              const x = parseFloat(xStr)
              const y = parseFloat(yStr)
              const width = parseFloat(wStr)
              const height = parseFloat(hStr)

              if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
                const sub: SubTexture = { name, x, y, width, height }

                const fx = node.getAttribute('frameX')
                const fy = node.getAttribute('frameY')
                const fw = node.getAttribute('frameWidth')
                const fh = node.getAttribute('frameHeight')

                if (fx !== null && !isNaN(parseFloat(fx))) sub.frameX = parseFloat(fx)
                if (fy !== null && !isNaN(parseFloat(fy))) sub.frameY = parseFloat(fy)
                if (fw !== null && !isNaN(parseFloat(fw))) sub.frameWidth = parseFloat(fw)
                if (fh !== null && !isNaN(parseFloat(fh))) sub.frameHeight = parseFloat(fh)

                result.subTextures.set(name, sub)
              }
            }
          })

          return result
        }
      }
    } catch {
    }

    return this.parseAtlasXmlWithRegex(xmlString)
  }

  private static parseAtlasXmlWithRegex(xmlString: string): TextureAtlasData {
    const result: TextureAtlasData = {
      imagePath: '',
      subTextures: new Map(),
    }

    const atlasMatch = xmlString.match(/<TextureAtlas[^>]*imagePath=["']([^"']*)["']/i)
    if (atlasMatch) {
      result.imagePath = atlasMatch[1]
    }

    const subTextureRegex = /<SubTexture\s+([^>]+)\/?>/gi
    let match: RegExpExecArray | null

    while ((match = subTextureRegex.exec(xmlString)) !== null) {
      const attrsStr = match[1]
      const attrs: Record<string, string> = {}
      const attrRegex = /([a-zA-Z0-9_-]+)=["']([^"']*)["']/g
      let attrMatch: RegExpExecArray | null

      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        attrs[attrMatch[1]] = attrMatch[2]
      }

      const { name, x, y, width, height, frameX, frameY, frameWidth, frameHeight } = attrs

      if (name && x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
        const numX = parseFloat(x)
        const numY = parseFloat(y)
        const numW = parseFloat(width)
        const numH = parseFloat(height)

        if (!isNaN(numX) && !isNaN(numY) && !isNaN(numW) && !isNaN(numH)) {
          const sub: SubTexture = {
            name,
            x: numX,
            y: numY,
            width: numW,
            height: numH,
          }

          if (frameX !== undefined && !isNaN(parseFloat(frameX))) sub.frameX = parseFloat(frameX)
          if (frameY !== undefined && !isNaN(parseFloat(frameY))) sub.frameY = parseFloat(frameY)
          if (frameWidth !== undefined && !isNaN(parseFloat(frameWidth))) sub.frameWidth = parseFloat(frameWidth)
          if (frameHeight !== undefined && !isNaN(parseFloat(frameHeight))) sub.frameHeight = parseFloat(frameHeight)

          result.subTextures.set(name, sub)
        }
      }
    }

    return result
  }

  static registerAtlasXml(category: string, xmlString: string, imageSrc?: string): TextureAtlasData {
    const atlas = this.parseAtlasXml(xmlString)
    this.atlases.set(category, atlas)
    AvatarAtlasManager.version++

    if (imageSrc && typeof Image !== 'undefined') {
      const img = new Image()
      img.src = resolveBundledAssetUrl(imageSrc)
      this.imageCache.set(category, img)
    }

    return atlas
  }

  static async loadAtlas(category: string, xmlUrl: string, imageUrl?: string): Promise<boolean> {
    if (this.atlases.has(category)) {
      return true
    }

    const cacheKey = `${category}_${xmlUrl}`
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey)!
    }

    const promise = (async () => {
      try {
        const res = await fetch(resolveBundledAssetUrl(xmlUrl))
        if (!res.ok) {
          console.warn(`[AvatarAtlasManager] Failed to fetch atlas XML: ${xmlUrl} (${res.status})`)
          return false
        }
        const xmlText = await res.text()
        const atlas = this.parseAtlasXml(xmlText)
        this.atlases.set(category, atlas)
        AvatarAtlasManager.version++

        const finalImgUrl = imageUrl
          ? resolveBundledAssetUrl(imageUrl)
          : atlas.imagePath
          ? resolveBundledAssetUrl(atlas.imagePath, xmlUrl)
          : resolveBundledAssetUrl(xmlUrl.replace(/\.xml$/i, '.png'))
        if (typeof Image !== 'undefined' && finalImgUrl) {
          const img = new Image()
          img.src = finalImgUrl
          await new Promise<void>((resolve) => {
            img.onload = () => resolve()
            img.onerror = () => {
              console.warn(`[AvatarAtlasManager] Could not load image for atlas: ${finalImgUrl}`)
              resolve()
            }
          })
          this.imageCache.set(category, img)
        }

        return true
      } catch (err) {
        console.warn(`[AvatarAtlasManager] Error loading atlas for ${category}:`, err)
        return false
      } finally {
        this.loadingPromises.delete(cacheKey)
      }
    })()

    this.loadingPromises.set(cacheKey, promise)
    return promise
  }

  static getSubTexture(category: string, name: string): SubTexture | undefined {
    const atlas = this.atlases.get(category)
    if (atlas) {
      return atlas.subTextures.get(name)
    }

    for (const [, a] of this.atlases) {
      const sub = a.subTextures.get(name)
      if (sub) return sub
    }

    return undefined
  }

  static hasSubTexture(category: string, name: string): boolean {
    return this.getSubTexture(category, name) !== undefined
  }

  static getImage(category: string): HTMLImageElement | undefined {
    return this.imageCache.get(category)
  }

  static setImage(category: string, img: HTMLImageElement): void {
    this.imageCache.set(category, img)
  }

  static clearCache(): void {
    this.atlases.clear()
    this.imageCache.clear()
    this.loadingPromises.clear()
    AvatarAtlasManager.version++
  }

  static getAllAtlases(): Map<string, TextureAtlasData> {
    return this.atlases
  }
}
