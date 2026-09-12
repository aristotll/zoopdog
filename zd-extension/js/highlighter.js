class Highlighter {

  constructor() {
    this.highlights = []
    this.padding = 5
    this.locked = false

    this.canvas = document.createElement('canvas')
    this.canvas.id = 'zoopdog-canvas'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
    this.canvas.style.position = 'fixed'
    this.canvas.style.left = 0;
    this.canvas.style.top = '1px' // slight offset required for precise positioning
    this.canvas.style.zIndex = 100000
    this.canvas.style.pointerEvents = 'none' //Make sure you can click 'through' the canvas
    this.context = null
    this.rangeRect = null
    document.body.appendChild(this.canvas); //Append canvas to body element
    this.context = this.canvas.getContext("2d")
  }

  on(node, begin, howManyWords) { // adapted from https://stackoverflow.com/a/31369978

    if (this.highlights.length) this.off()
    if (node === undefined) return true

    var boundary = zdContainerBoundary(node)
    var ranges = []
    var words = 0,
        prevChar = "",
        curNode = node,
        curBegin = begin

    // A match can straddle more than one <ruby>-wrapped word (see zd-words.js), so keep
    // building ranges into whatever text node follows once this one runs out, rather than
    // stopping at this node's own end.
    while (curNode && words < howManyWords) {
      var data = curNode.data
      var i
      for (i = curBegin; i < data.length; i++) {
        if (data[i] === " ") {
          if (prevChar && zdIsWordChar(prevChar)) words++
        } else if (!zdIsWordChar(data[i])) { // break on punctuation
          break
        }
        if (words === howManyWords) {
          break
        }
        prevChar = data[i]
      }

      if (i === curBegin) break
      var rangeBegin = curBegin
      if (data[rangeBegin] === " ") rangeBegin++
      if (rangeBegin < i) {
        var range = new Range()
        range.setStart(curNode, rangeBegin)
        range.setEnd(curNode, i)
        ranges.push(range)
      }

      if (words >= howManyWords || i < data.length) break

      var nextNode = zdNextTextNode(curNode, boundary)
      if (!nextNode) break
      if (prevChar && zdIsWordChar(prevChar)) {
        // The node boundary itself stands in for the space between words.
        words++
        prevChar = ""
        if (words === howManyWords) break
      }
      curNode = nextNode
      curBegin = 0
    }

    if (!ranges.length) return true

    this.highlights = ranges.reduce((rects, range) => rects.concat(Array.from(range.getClientRects())), [])
    for (var hl of this.highlights) {
      this.context.rect(hl.left - this.padding,
                        hl.top - this.padding,
                        hl.width + (this.padding * 2),
                        hl.height + (this.padding * 2))
      this.context.globalAlpha = 0.25
      this.context.fillStyle = '#B6638F'
      this.context.fill()
    }
  }

  off() {
    if (this.locked) return true
    this.context.beginPath();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.globalAlpha = 0
    this.highlights = []
  }

  toggleLock() {
    if (this.locked) {
      this.locked = false
      this.off()
    } else if (this.highlights.length) {
      this.locked = true
    }
  }

}

// Present only under Node, so the class is unit-testable without a browser -- see
// zd-words.js, which the class relies on for zdIsWordChar/zdContainerBoundary/zdNextTextNode
// as ambient globals exactly as the extension's manifest load order provides them.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {Highlighter}
}
