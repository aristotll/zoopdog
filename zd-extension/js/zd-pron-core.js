// Pure Vietnamese pronunciation/number-spelling/homophone core.
//
// No `String.prototype` mutation, no implicit globals, no DOM access: every function here is a
// side-effect-free transformation from explicit inputs to explicit outputs. This is the single
// authoritative implementation shared by the website pages, the extension popup frame, and the
// generated popup userscript -- see docs/pronunciation-engine.md for the result contract and
// which module owns what.
//
// `createPronunciationCore(pronData, allPossibleRealWords)` builds the core against explicit
// data. In a browser, zd-pron-functions.js calls it once against the ambient globals that
// zd-pron-data.js (and, on pages that need homophones, realwords.js) declared as earlier
// <script> tags -- classic scripts share one top-level lexical scope, so those `const`s are
// plain bare identifiers here, exactly as the pre-refactor monolith relied on. Under Node,
// callers (tests, scripts) `require` the data explicitly and pass it in; see zd-pron-data.js
// and realwords.js for their own CommonJS exports.
function createPronunciationCore(pronData, allPossibleRealWords) {
  var dialects      = pronData.dialects
    , vowelTable     = pronData.vowelTable
    , toneTable      = pronData.toneTable
    , toneCodes      = pronData.toneCodes
    , tones          = pronData.tones
    , rimesToIPA     = pronData.rimesToIPA
    , initialsToIPA  = pronData.initialsToIPA
    , numbers        = pronData.numbers
    , TENS_WORD      = pronData.TENS_WORD
    , zoopdogSymbols = pronData.zoopdogSymbols
    , wordUnitsRegex = pronData.wordUnitsRegex

  // The real-word lexicon is only required by getHomophones/getMultiWordHomophones, and not
  // every page that loads this core needs homophones (pronunciation.jade and pronguide.jade
  // never call them). Building the Set lazily, on first actual use, means a page that omits
  // realwords.js still loads cleanly -- exactly like the pre-refactor code, which only ever
  // dereferenced the bare `allPossibleRealWords` global inside getHomophones's body.
  var realWordsSetCache = null
  function getRealWordsSet() {
    if (!realWordsSetCache) {
      if (!allPossibleRealWords) {
        throw new Error('ZDPronCore: the real-word lexicon (realwords.js) was not supplied; homophone search needs it')
      }
      realWordsSetCache = new Set(allPossibleRealWords)
    }
    return realWordsSetCache
  }

  const cleanUpNumbers = (str) => {
    return String(str).replace(/[,\.](?=\d{3})/gi, "")
                       .replace(/\,(?=\d{1,2}\b)/gi, ".")
  }

  // https://stackoverflow.com/a/29622653/4210855
  const longestKeyFirst = (o) => {
    return Object.keys(o).sort((a, b) => b.length - a.length)
  }

  const dissect = (word) => {
    /* ======================================================== //
    // Break a word down into the following components:         //
    // INITIAL string corresponding to a key in initialsToIPA   //
    // GLIDE boolean                                            //
    // RIME string corresponding to a key in rimesToIPA         //
    // TONE string corresponding to a key in toneTable          //
    // ======================================================== */

    var tone = ""
    for (var toneKey in toneTable) {
      if (toneTable[toneKey].test(word)) {
        tone = toneKey
        break
      }
    }
    for (var baseVowel in vowelTable) {
      var tonedVowels = vowelTable[baseVowel]
      word = word.replace(tonedVowels, baseVowel)
    }

    word = word.replace(/uy([aêuctn])/, "ui$1")
    var initial = longestKeyFirst(initialsToIPA).find((i) => word.startsWith(i)) || ""
      , rime    = longestKeyFirst(rimesToIPA).find((r) => {
          // first statement prevents incorrect separation of words like "gia", "quy"
          if (initial.length) return word.endsWith(r) && !r.startsWith(initial.slice(-1))
          else if (r === "iêu") return word === "yêu"
          else if (r === "iên") return word === "yên"
          else return word.endsWith(r) // vowel-initial words
        }) || ""
      , glide   = (word.length > (initial + rime).length || word.startsWith("qu"))

    // Exceptions
    if (word === "gi") rime = "i"
    else if (word === "gin") rime = "in" // giữ gìn
    else if (word === "giêng") rime = "iêng"

    return [initial, glide, rime, tone]

  }

  const addTone = (word, tone) => {
    /* ======================================================== //
    // Place a given tone mark on the correct letter in a word, //
    // in accordance with Vietnamese spelling rules.            //
    // ======================================================== */

    var split     = /(\S*)([mtp]|ch?|n[gh]?)$/.exec(word) || [word, word, ""]
      , beginning = split[1]
      , coda      = split[2]
      , result    = ""
      , toneMark  = toneCodes[tone] || ""
    if (word === "qua") result = beginning + toneMark
    else if (/[ouư]?[aeioơôuư][iou]$|[aăâ]y$|[uư]a$/.test(word) || beginning === "oi") result = beginning.slice(0, -1) + toneMark + beginning.slice(-1)
    else result = beginning + toneMark + coda
    return result.normalize()
  }

  const construct = (i, glide, r, tone) => {
    /* ======================================================== //
    // Construct a word from the same components in `dissect`,  //
    // in accordance with Vietnamese spelling rules.             //
    // ======================================================== */

    // Prevent impossible initials
    if (/^n?gh/.test(i) && (/^[oau]/.test(r) || glide)) return null
    if (/^n?g$/.test(i) && (/^[ieê]/.test(r) || !glide)) return null

    // Prevent impossible glides/rimes
    if (glide) {
      if (/^[oôưu]/.test(r)) return null                // prevent hoong, nguưa
      if (i === "" && /^(a|u?ya)$/.test(r)) return null // prevent "uya", "oa"
      if (/v|gi|r/.test(i)) return null                 // prevent nonsensical results for "duyên"
      if (r.startsWith("i")) r = "y" + r.slice(1)       // fix spelling: u-glide + i = uy
    } else if (i === "gi") {
      if (r === "i") i = "g"                            // gi
      else if (r.startsWith("i")) return null           // prevent cases like "giiep"
    }

    var g
    if (i.endsWith("u")) g = ""           // don't add another "u" to "qu"
    else if (!glide) g = ""
    else if (/^[ae]/.test(r)) g = "o"     // on-glide is "o" before a/e (hoàng, khoẻ)
    else g = "u"

    return addTone((i + g + r), tone)

  }

  const loopThroughNumbers = (number, dialect) => {
    /* ======================================================== //
    // Internal function to convert a positive integer into a   //
    // sequence of dialect words, using positional tens/hundreds //
    // rules. Callers handle zero explicitly (see numbersToWords)//
    // -- this function is never invoked with number === 0.      //
    // ========================================================= */
    var result = []
    while (number > 0) {
      var unit         = (number > 9) ? parseInt(longestKeyFirst(numbers).find(x => x.length <= number.toString().length)) : 1
        , howManyUnits = (unit > 9) ? Math.floor(number / unit) : number
        , remainder    = number % unit
        , difference   = unit - remainder

      if (howManyUnits > 9) {
        result = result.concat(loopThroughNumbers(howManyUnits, dialect))
        result.push(numbers[unit.toString()][dialect])
      } else if (howManyUnits === 0) {
        // nothing to push at this position
      } else if (unit === 10 && howManyUnits === 1) {
        // Exact multiple of ten in the tens place (10, 110, 1010, ...): always "mười", never
        // "mươi" -- this is the defect a blanket "mười"->"mươi" string replacement got wrong
        // (it also rewrote this case, producing "một trăm mươi" for 110 instead of "một trăm
        // mười"). Deciding it here, from the actual digit value, replaces that global rewrite.
        result.push(numbers["10"][dialect])
      } else if (unit === 10) {
        // Tens digit 2-9: "hai mươi", "ba mươi", etc.
        result.push(numbers[howManyUnits.toString()][dialect])
        result.push(TENS_WORD[dialect])
      } else {
        result.push(numbers[howManyUnits.toString()][dialect])
        if (unit > 1) result.push(numbers[unit.toString()][dialect])
      }

      if (901 <= difference && difference < 1000) result.push("không trăm")
      else if (91 <= difference && difference < 100) result.push(numbers["0"][dialect])
      number = number % unit
    }
    return result
  }

  const numbersToWords = (number, dialect) => {
    //* ======================================================== //
    // "Spell out" a given number (can be string or number) in   //
    // the appropriate dialect. Supported grammar: a non-negative //
    // integer part up to 10 digits, optionally followed by "."  //
    // and one or two decimal digits read as individual numerals. //
    // Anything else (more than one ".", a longer integer part,  //
    // a sign, exponents, ...) is explicitly unsupported and is  //
    // returned unchanged -- see docs/pronunciation-engine.md.   //
    // ========================================================= */

    dialect = dialect || "hanoi"
    number = (typeof number === "number") ? number.toString() : String(number)
    var sourceArray = number.split(".")
    if (sourceArray.length > 2) return number // incomprehensible input
    else if (!/^\d+$/.test(sourceArray[0])) return number // not a plain non-negative integer
    else if (sourceArray[0].length > 10) return number // number is bigger than 9.99 billion

    var integerPart = parseInt(sourceArray[0], 10)
      , result       = (integerPart === 0) ? ["không"] : loopThroughNumbers(integerPart, dialect)

    if (sourceArray.length === 2) { // read decimal points as "point number number"
      if (!/^\d{1,2}$/.test(sourceArray[1])) return number
      result.push("chấm")
      var decimal = sourceArray[1].split("").map(n => numbers[n][dialect])
      result = result.concat(decimal)
    }

    return result.join(" ")
                 .replace(/ mươi một/gi, " mươi mốt")
                 .replace(/ năm/gi, " lăm")
  }

  const emptyDialectResults = () => {
    var result = {}
    dialects.forEach(dialect => { result[dialect] = {ipa: "", zd: ""} })
    return result
  }

  // todo prononciation
  const wordPronunciation = (word) => {
    /* ======================================================== //
    // For each dialect, produce a pronunciation guide for the  //
    // given word in two formats: a fairly narrow IPA           //
    // transcription and a less technical transcription         //
    // with HTML formatting more suitable for consumption by    //
    // laypeople on the web.                                    //
    // ======================================================== */
    var [initial, glide, rime, tone] = dissect(word)
      , g                            = (glide) ? "ʷ" : ""
      , result                       = {}

    dialects.forEach(dialect => {

      result[dialect] = {ipa: word, zd: word}

      if (/^\d{1,10}(\.\d{1,2})?$/.test(word)) { // convert words up to 10 digits, ignore above that
        result[dialect] = pronunciationGuide(numbersToWords(word, dialect))[dialect]
        return
      } else if (initial.length && Object.keys(initialsToIPA).indexOf(initial) === -1) {
        return // result[dialect] = word // not a Vietnamese word
      } else if (Object.keys(rimesToIPA).indexOf(rime) === -1) {
        return // result[dialect] = word // not a Vietnamese word
      }

      // IPA version

      var i = (initial) ? initialsToIPA[initial][dialect].replace(/ʷ/, "") : ""
        , r = rimesToIPA[rime][dialect]

      // Add glottal stops to Hanoi output depending on the tone
      if (dialect === "hanoi" && tone === ".") {
        r += "ʔ"
      } else if (dialect === "hanoi" && tone === "~") {
        if (/ʷ/.test(r)) r = r.replace(/ʷ/, "ʷʔ")
        else if (/(.)ː/.test(r)) r = r.replace(/(.)ː/, "$1ʔ$1")
        else if (/(ŋ͡m|k͡p)$/.test(r)) r = r.replace(/(ŋ͡m|k͡p)$/, "ʔ$1")
        else r = r.slice(0, 1) + "ʔ" + r.slice(1)
      }

      var ipa = i + g + r

      if (dialect === "saigon") ipa = ipa.replace(/^[ŋhk]ʷ/, "w") // saigon merger of velar + onglide
      else if (dialect === "quangnam") ipa = ipa.replace(/^kʷ/, "w") // quangnam quy = uy

      ipa += tones[tone][dialect].replace(/[ʔ_]/gi, "").normalize()
      result[dialect].ipa = ipa

      // Zoopdog version

      var i2 = (initial) ? initialsToIPA[initial][dialect].replace(/ʰ/, "’")
                                                          .replace(/ʷ/, "")
                                                          .replace(/j/, "y") : ""
        , r2 = rimesToIPA[rime][dialect].replace(/^(.)w$/, "$1U") // may, mau -> final vowel should be treated like coda
                                        .replace(/^(.)j$/, "$1I")

      var glideForRendering = glide

      // QN & SGN simplification of onsets
      if (dialect === "saigon" && /^[ŋhk]?ʷ/.test(i2 + g)) { i2 = "W"; glideForRendering = false }
      else if (dialect === "quangnam" && /^[k]?ʷ/.test(i2 + g)) { i2 = "W"; glideForRendering = false }

      var html        = ""
        , codaMatch   = r2.match(/(ŋ͡m|k͡p|[mnŋptkUI])/)
        , nucleus     = (codaMatch) ? r2.substring(0, codaMatch.index) : r2
        , coda        = (codaMatch !== null) ? zoopdogSymbols[codaMatch[0]] || codaMatch[0] : ""
        , vowels      = nucleus.match(/(.̈?̟?̯?ː?)|[jwʷ]/gi)
        , qualities   = vowels.map(v => {
                          if (/[̯̈ʷ]/.test(v)) return "glide"
                          else if (/ː/.test(v)) return "long-vowel"
                          else return "short-vowel"
                        })
        , pg          = (dialect === "hanoi" && (!i2.length || /ʔ/.test(i2))) ?  " preglottalized" : ""
        , longFinal   = true
        , doubleGlide = (glideForRendering && qualities[0] === "glide") // "thuy" in QN & SGN, for example

      if (i2) html += `<span class='phonemic-unit consonant'>${zoopdogSymbols[i2] || i2}</span>`
      if (glideForRendering && !doubleGlide) html += `<span class='phonemic-unit glide'>w</span>`

      if (qualities.filter(x => x === "long-vowel").length || qualities.filter(x => x === "short-vowel").length > 1) longFinal = false

      for (var z = 0; z < vowels.length; z++) {
        var coreVowel = vowels[z].split(/[̟̯ː]/)[0]
          , v         = zoopdogSymbols[coreVowel] || coreVowel

        if (coreVowel === "ɤ") {
          // Minor ɤ (e.g. Saigonese/Quangnam "-i" rimes such as "i", "y"): simplified to the
          // schwa "ə" only when there is no preceding onset consonant (i2 === "") -- this
          // branch previously compared `i === 0` (a string to the number 0), which is never
          // true, so it silently never fired. The `i2` used here is the initial *after* the
          // QN/SGN "W" onset simplification above, matching what actually precedes the vowel
          // in the rendered word.
          if (i2 === "" && qualities[z] !== "long-vowel") v = "ə"
          else if (vowels.length > 2) v = "ə" // nuôi, nươi, etc
        }

        // glide superscript
        if (qualities[z] === "glide" && v !== "ʷ") v = `<span class="super">${v}</span>`
        // double glide
        if (z === 0 && doubleGlide) v = `w${v}`

        html += `<span class='phonemic-unit ${qualities[z]}'>${v}</span>`
      }

      if (codaMatch) {
        // special for "may", "mau"
        if (/[UI]/.test(coda)) html += `<span class='phonemic-unit long-consonant consonant'>${coda.toLowerCase()}${coda.toLowerCase()}</span>`
        else if (longFinal) html += `<span class='phonemic-unit long-consonant consonant'>${coda}</span>`
        else html += `<span class='phonemic-unit consonant'>${coda}</span>`
      }

      result[dialect].zd = `<div class='zoopdog-word${pg}' tone='${tones[tone][dialect]}'>\
                              <div class='phonemes'>${html}</div>\
                              <div class='source-word'>${word}</div>\
                              <div class='source-ipa'>${ipa}</div>\
                            </div>`

    })
    return result
  }

  const pronunciationGuide = (str) => {
    /* ======================================================== //
    // Given a string of words, produce IPA and HTML            //
    // pronunciation guide for a given string in each dialect.  //
    // Total: always returns all three dialect keys with string //
    // (never undefined) .ipa/.zd fields, plus `status` and the //
    // normalized `input`. Empty/whitespace-only input is the   //
    // one case with no per-word result: it returns "" for both //
    // fields per dialect instead of echoing a stray space.     //
    // ======================================================== */

    var normalized = (str === null || str === undefined) ? "" : String(str).normalize().toLowerCase()
      , trimmed     = normalized.trim()

    if (trimmed === "") {
      var empty = emptyDialectResults()
      empty.status = "empty"
      empty.input = normalized
      return empty
    }

    var sourceArray = cleanUpNumbers(normalized).match(wordUnitsRegex)
      , outputArray = (sourceArray === null) ? [] : sourceArray.map(word => wordPronunciation(word))
      , reduced      = outputArray.reduce(function(res, item){
          for (var dialect in item) {
            res[dialect] = res[dialect] || {}
            for (var style in item[dialect]) {
              res[dialect][style] = [res[dialect][style], item[dialect][style]].join(" ")
            }
          }
          return res
        }, {})

    dialects.forEach(dialect => {
      reduced[dialect] = reduced[dialect] || {ipa: "", zd: ""}
    })
    reduced.status = "ok"
    reduced.input = normalized
    return reduced
  }

  const getHomophones = (word, includeSelf) => {
    /* ======================================================== //
    // For each dialect, return all possible words that are     //
    // homophonous with the given word.                         //
    // ======================================================== */

    var [initial, glide, rime, tone] = dissect(word)
      , homophones = {}
      , realWords  = getRealWordsSet()
    includeSelf = includeSelf || false

    dialects.forEach(dialect => {
      homophones[dialect] = [];

      if (initial.length && Object.keys(initialsToIPA).indexOf(initial) === -1) {
        homophones[dialect].push(word) // not a Vietnamese word
      } else if (Object.keys(rimesToIPA).indexOf(rime) === -1) {
        homophones[dialect].push(word) // not a Vietnamese word
      } else {

        if (includeSelf) homophones[dialect].push(word)

        var initialPron = (initial.length) ? initialsToIPA[initial][dialect] : ""
          , rimePron    = rimesToIPA[rime][dialect]
          , homInitials = (initial.length) ? Object.keys(initialsToIPA).filter(i => initialsToIPA[i][dialect] === initialPron) : [""]
          , homRimes    = Object.keys(rimesToIPA).filter(r => rimesToIPA[r][dialect] === rimePron)
        // account for saigon merger of velar + onglide (hoang = quang = oang = ngoang)
        if (dialect === "saigon" && glide && ["ng", "qu", "h", ""].indexOf(initial) > -1) {
          homInitials = ["ng", "qu", "h", ""]
        // account for quangnam merger of /kw/ & /w/ initial (quy = uy)
        } else if (dialect === "quangnam" && glide && ["qu", ""].indexOf(initial) > -1) {
          homInitials = ["qu", ""]
        }

        for (var i of homInitials) {
          for (var r of homRimes) {
            var candidates = [];
            candidates.push(construct(i, glide, r, tone))
            if (["quangnam", "saigon"].indexOf(dialect) > -1) { // QN & SGN merger of hoi & nga tones
              if (tone === "?") candidates.push(construct(i, glide, r, "~"))
              if (tone === "~") candidates.push(construct(i, glide, r, "?"))
            }
            candidates.forEach(w => {
              if (!w) return false
              if ([word, "qui"].indexOf(w) > -1 || homophones[dialect].indexOf(w) > -1) return false
              if (realWords.has(w)) homophones[dialect].push(w)
            })
          }
        }

      }
    })
    return homophones
  }

  const getShortLongPairs = (word) => {
    /* ======================================================== //
    // For each dialect, return all possible words that form a  //
    // vowel-length minimal pair with a given word,             //
    // and indicate whether it is shorter or longer than        //
    // the given word.                                          //
    // ======================================================== */

    var [initial, glide, rime, tone] = dissect(word)
      , results = []
      , generated = []

    dialects.forEach(dialect => {
      results[dialect] = {shorter: [], longer: []}
      var initialPron = (initial.length) ? initialsToIPA[initial][dialect] : ""
        , rimePron    = rimesToIPA[rime][dialect]
        , isLong      = /ː/.test(rimePron)
        , homRimes    = Object.keys(rimesToIPA).filter((r) => {
            var target = rimesToIPA[r][dialect]
            var condition
            if (isLong) { // if vowel is long, look for short
              condition = target.length < rimePron.length
            } else {              // if vowel is short, look for long
              condition = target.length > rimePron.length
            }
            return (target.replace(/ː/gi, "") === rimePron.replace(/ː/gi, "") && condition)
          })
      for (var r of homRimes) {
        var newWord = construct(initial, glide, r, tone)
        if (!newWord) continue
        if ([word, "qui"].indexOf(newWord) > -1 || generated.indexOf(newWord) > -1) continue
        if (isLong) results[dialect]["shorter"].push(newWord)
        else results[dialect]["longer"].push(newWord)
      }
    })
    return results
  }

  // Stolen and adapted from https://stackoverflow.com/a/33385401/4210855
  const getPermutations = (array, prefix) => {
    /* ======================================================== //
    // Given an array of arrays                                 //
    // [["a"], ["b", "c", "d"], ["e", "f"]],                    //
    // return an array                                          //
    // ["a b e", "a b f", "a c e", "a c f", "a d e", "a e f"]   //
    // ======================================================== */

    prefix = prefix || ''
    if (!array.length) return prefix
    var result = array[0].reduce((result, value) => {
      return result.concat(getPermutations(array.slice(1), prefix + " " + value))
    }, [])
    return result.map((x) => x.trim()) // get rid of initial spaces
  }

  const howManyPossibilities = (array) => {
    if (!array.length) return 0
    return array.reduce((cur, next) => {
      return cur * next.length
    }, 1)
  }

  const getMultiWordHomophones = (str, limit) => {
    /* ======================================================== //
    // Given a string of words, return all possible strings of  //
    // words that would be pronounced the same in each dialect. //
    // ======================================================== */

    var normalized  = (str === null || str === undefined) ? "" : String(str).normalize().toLowerCase()
      , sourceArray  = normalized.match(wordUnitsRegex)
      , outputArray  = (sourceArray !== null) ? sourceArray.map(word => getHomophones(word, true)) : []
      , result       = {}
    dialects.forEach((dialect) => {
      var sequence = outputArray.map(homophones => homophones[dialect])
        , total    = howManyPossibilities(sequence)
      if (!sourceArray) result[dialect] = "&nbsp;"
      else if (total >= limit) result[dialect] = total // return a number if the total exceeds the limit
      else result[dialect] = getPermutations(sequence).filter(hp => hp !== sourceArray.join(" ")) || "&nbsp;"
    })
    return result
  }

  return {
    cleanUpNumbers,
    dissect,
    addTone,
    construct,
    numbersToWords,
    wordPronunciation,
    pronunciationGuide,
    getHomophones,
    getShortLongPairs,
    getPermutations,
    howManyPossibilities,
    getMultiWordHomophones
  }
}

// Present only under Node, matching zd-words.js: a classic <script> has no `module`, and
// `typeof` on an undeclared name is safe. In the browser, build the page-wide namespace
// immediately from the ambient globals declared by the preceding <script> tags.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPronunciationCore }
} else {
  var ZDPronCore = createPronunciationCore(
    {
      dialects, vowelTable, toneTable, toneCodes, tones, rimesToIPA, initialsToIPA, numbers,
      TENS_WORD, zoopdogSymbols, wordUnitsRegex
    },
    (typeof allPossibleRealWords !== 'undefined') ? allPossibleRealWords : null
  )
}
