// Local-mode extension for zoopdog-popupdict.user.js -- see docs/local-mode.md.
// Only concatenated into the -local build by scripts/build-popupdict-userscript.js
// (readRuntimeSources / LOCAL_RUNTIME_SOURCES); the github-hosted build never inlines this.
// Declared inside the same IIFE as popupdict.runtime.js, so it shares that scope --
// core helpers like escapeHtml() and ZOO_DICTIONARY are visible here. The core file reaches this
// one through `zooLocal`, assigned at the end of this file, and nothing else by name.
// The local code itself lives in the local-*.js fragments listed ahead of this file in
// LOCAL_RUNTIME_SOURCES (docs/runtime-boundaries.md); this file is last so every function the seam
// names is declared before it runs.

  // The one seam between the core runtime and this fragment. `zooLocal` is declared (null) at the
  // top of popupdict.runtime.js's IIFE, ahead of every runtime source, so this assignment runs after
  // the declaration; the core code tests `zooLocal` instead of probing each function with typeof.
  zooLocal = {
    renderActions: zooRenderLocalActions,
    probe: zooProbeLocalMode,
    wireSelectionBar: zooWireSelectionBar,
    openNomModal: zooOpenNomModal,
    openNomOrderModal: zooOpenNomOrderModal
  };
