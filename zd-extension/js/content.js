// getWordAndContext, generateCandidates and mouseInRects come from js/zd-words.js, which the
// manifest loads before this file.

window.onload = function () {

    this.highlighter = new Highlighter()
    this.popup = new ResultFrame()

    chrome.runtime.sendMessage({type: 'get-dialect'}, function (response) {
        this.popup.dialect = response.dialect
    })

    chrome.runtime.sendMessage({type: 'check-globally-on'}, function (response) {
        this.zoopdogIsOn = response.status
    })

    this.addEventListener('resize', function (e) {
        this.highlighter.off()
        this.popup.hide()
        this.highlighter = new Highlighter()
    })

    this.addEventListener('scroll', function (e) {
        this.highlighter.off()
        this.popup.hide()
    })

    this.addEventListener('mouseout', function (e) {
        this.highlighter.off()
        this.popup.hide()
    })

    window.addEventListener('keydown', e => {
        if (e.which === 16) {
            this.highlighter.toggleLock()
            this.popup.toggleLock()
        }
    })

    var oldWord
    let mainListener = function (e) {

        if (this.popup.locked || !this.zoopdogIsOn) return true

        var mouse = {x: e.clientX, y: e.clientY}
        if (this.highlighter.highlights.length && mouseInRects(mouse, this.highlighter.highlights)) return true

        var origin = getWordAndContext(mouse)
        var el = document.elementFromPoint(mouse.x, mouse.y)

        if (!origin) return true
        if (!origin.word) return true

        this.highlighter.off()
        this.popup.hide()

        if (Array.from(el.childNodes).indexOf(origin.node) === -1) return true
        if (origin.word === oldWord) return true
        oldWord = origin.word

        var searchTerm = origin.word.replace(/[Đ\u00D0]/ug, "đ")
        chrome.runtime.sendMessage({type: 'initial-search', term: searchTerm}, function (response) {
            if (response.type === "range") {
                var candidates = generateCandidates(origin.context, response.range)
                chrome.runtime.sendMessage({type: 'second-search', candidates: candidates}, function (response) {
                    if (response.type === "results" && response.results.length) {
                        var numOfWordsToHighlight = response.results[0]['vn'].split(" ").length
                        this.highlighter.on(origin.node, origin.begin, numOfWordsToHighlight)
                        this.popup.populate(response.results)
                        if (this.highlighter.highlights) this.popup.show(this.highlighter.highlights[0])
                        setTimeout(() => {
                            oldWord = null
                        }, 500) // this is necessary to prevent flickers but allow intentionally going off and back on the same word
                    }
                })
            }
        })

    };
    this.addEventListener('mousemove', mainListener)
    // todo fix bug for iphone
  this.addEventListener('click', mainListener)

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

        if (message.type === 'toggle-zoopdog') {
            if (message.status) {
                window.zoopdogIsOn = true
            } else {
                window.zoopdogIsOn = false
                window.highlighter.off()
                window.popup.hide()
            }
        } else if (message.type === 'toggle-lock') {
            window.highlighter.toggleLock()
            window.popup.toggleLock()
        } else if (message.type === 'set-dialect') {
            window.popup.dialect = message.dialect
        }

    })
}
