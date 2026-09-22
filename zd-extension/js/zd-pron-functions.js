// Thin browser adapter over the pure pronunciation core (zd-extension/js/zd-pron-core.js).
//
// Kept as a separate file, and kept exporting these exact bare global names, because every
// consumer page/frame (js/zd-pron.js, zd-extension/js/zd-pronguide.js, zd-extension/js/frame.js,
// and the generated popup userscript) already calls `pronunciationGuide(...)`,
// `getHomophones(...)`, etc. as plain top-level functions -- see docs/pronunciation-engine.md.
// All the actual logic, including the String.prototype-mutation-free, total-result-contract
// implementation, lives in zd-pron-core.js; this file only re-exposes it under those names.
//
// Load order (see pronunciation.jade, pronguide.jade, homophones.jade, zd-extension/frame.jade):
// zd-pron-data.js, [realwords.js, only where homophones are used], zd-pron-core.js, this file.
const pronunciationGuide      = ZDPronCore.pronunciationGuide
const getHomophones           = ZDPronCore.getHomophones
const getShortLongPairs       = ZDPronCore.getShortLongPairs
const getMultiWordHomophones  = ZDPronCore.getMultiWordHomophones
const numbersToWords          = ZDPronCore.numbersToWords
