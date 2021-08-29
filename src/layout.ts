import RBush from 'rbush'

type RectTuple = [number, number, number, number]

export default class GranularRectLayout<T> {
  private rectangles: Map<
    string,
    {
      minY: number
      maxY: number
      minX: number
      maxX: number
      id: string
    }
  >

  public maxHeightReached: boolean

  private maxHeight: number

  private rbush: RBush<{ id: string }>

  private spacing: number

  private pTotalHeight: number

  constructor({
    maxHeight = Infinity,
    spacing = 2,
  }: {
    maxHeight?: number
    spacing?: number
  } = {}) {
    this.maxHeightReached = false
    this.rbush = new RBush()
    this.spacing = spacing
    this.rectangles = new Map()
    this.maxHeight = maxHeight
    this.pTotalHeight = 0
  }

  /**
   * @returns top position for the rect, or Null if laying
   *  out the rect would exceed maxHeight
   */
  addRect(
    id: string,
    left: number,
    right: number,
    height: number,
    data?: unknown,
  ): number | null {
    // add to rbush
    const existingRecord = this.rectangles.get(id)
    if (existingRecord) {
      return existingRecord.minY
    }

    let currHeight = 0
    let maxHeightReached = false
    let found = false
    while (
      // 0.01 fudge factor to avoid edge-exact collision detection returning
      // true
      this.rbush.collides({
        minX: left,
        minY: currHeight + 0.01,
        maxX: right,
        maxY: currHeight + height - 0.01,
      }) &&
      currHeight <= this.maxHeight
    ) {
      found = true
      currHeight += 1
      if (currHeight + height >= this.maxHeight) {
        maxHeightReached = true
        break
      }
    }
    if (found) {
      currHeight += this.spacing
    }

    if (!maxHeightReached) {
      const record = {
        minX: left,
        minY: currHeight,
        maxX: right,
        maxY: currHeight + height,
        id,
        data,
      }
      this.rbush.insert(record)
      this.rectangles.set(id, record)
      this.pTotalHeight = Math.min(
        this.maxHeight,
        Math.max(this.pTotalHeight, currHeight + height),
      )
    }
    this.maxHeightReached = this.maxHeightReached || maxHeightReached
    return maxHeightReached ? null : currHeight
  }

  hasSeen(id: string): boolean {
    return this.rectangles.has(id)
  }

  getByCoord(x: number, y: number): Record<string, T> | string | undefined {
    const rect = { minX: x, minY: y, maxX: x + 1, maxY: y + 1 }
    return this.rbush.collides(rect) ? this.rbush.search(rect)[0].id : undefined
  }

  getByID(id: string): RectTuple | undefined {
    const rect = this.rectangles.get(id)
    if (rect) {
      const { minX, maxX, minY, maxY } = rect
      return [minX, minY, maxX, maxY]
    }

    return undefined
  }

  cleanup(): void {}

  get totalHeight() {
    return this.pTotalHeight
  }

  getRectangles(): Map<string, RectTuple> {
    return new Map(
      [...this.rectangles.entries()].map(([id, { minX, minY, maxX, maxY }]) => [
        id,
        [minX, minY, maxX, maxY],
      ]),
    )
  }
}
