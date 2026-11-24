  // A fragment of nom-ruby.runtime.js, moved out of it verbatim (no renames, no body changes).
  // scripts/build-nom-userscript.js inlines it where it used to sit, inside the one IIFE of
  // nom-ruby.runtime.js, so it shares that scope; nothing is exported.
  // Holds: the mutation handler and changed-node refresh, the scan roots and excluded tags, the
  // time-sliced scan job (scanTextNodes ... scheduleScanContinuation) and the adaptive safety-net poll.
  // Relies on shared-IIFE names declared elsewhere:
  // state and settings declared in nom-ruby.runtime.js (SETTINGS, doc, newNodes, changedNodes,
  // injections, enabled, rescanNow, scanJob, scanGeneration, scanPasses, scanContinuation),
  // watchShadowRootFor (nom-ruby.runtime.js), annotateTextNode (nom-ruby-annotate.js) and
  // zdCreateBackoffPoll (zd-userscript-common.js).

  // A preceding line can be reconciled for delayed widgets, but a sibling may itself be an
  // entire feed. Limit both inspection and the subsequent scan to a small connected region.
  var MAX_NEIGHBOR_NODES = 64;
  function isBoundedNeighbor(root) {
    var pending = [root], visited = 0;
    while (pending.length) {
      var node = pending.pop();
      if (++visited > MAX_NEIGHBOR_NODES) return false;
      if (node.shadowRoot) pending.push(node.shadowRoot);
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (visited + pending.length >= MAX_NEIGHBOR_NODES) return false;
        pending.push(child);
      }
    }
    return true;
  }

  function mutationHandler(mutationList) {
    mutationList.forEach(function(mutationRecord) {
      if (mutationRecord.type === 'characterData') {
        changedNodes.add(mutationRecord.target);
        return;
      }

      function markRemoved(node) {
        var pending = [node];
        while (pending.length) {
          var current = pending.pop();
          if (injections.has(current)) changedNodes.add(current);
          for (var child = current.firstChild; child; child = child.nextSibling) pending.push(child);
        }
      }
      Array.prototype.forEach.call(mutationRecord.removedNodes || [], markRemoved);
      // A paused scan resumes from a saved "next sibling". When the page takes a child out of a
      // parent the scan is inside (a removal, or a move within that same parent), that pointer
      // may now skip siblings that were never visited, so the parent is scanned again.
      if (scanJob && mutationRecord.removedNodes && mutationRecord.removedNodes.length) {
        for (var depth = 0; depth < scanJob.stack.length; depth++) {
          if (scanJob.stack[depth].parent === mutationRecord.target) {
            newNodes.add(mutationRecord.target);
            break;
          }
        }
      }

      // Reconcile the addition and at most its previous sibling. This preserves recovery of a
      // silently attached preceding line without rescanning a whole feed on each insertion.
      Array.prototype.forEach.call(mutationRecord.addedNodes || [], function(added) {
        newNodes.add(added);
        if ((added.nodeType === Node.TEXT_NODE ? added.nodeValue : added.firstChild) &&
            added.previousSibling && isBoundedNeighbor(added.previousSibling)) {
          newNodes.add(added.previousSibling);
        }
      });
    });
  }

  // Splitting a text node and rewriting its tail are character data changes of this
  // script's own making, so a node still holding the text left behind by the last pass has
  // nothing new to annotate.
  function refreshChangedNode(node) {
    var injection = injections.get(node);

    if (injection) {
      if (injection.segments && injection.segments.every(function(segment) {
        return segment.node.isConnected && segment.node.nodeValue === segment.text;
      })) {
        return;
      }
      if (!injection.segments && injection.text === node.nodeValue) {
        return;
      }

      if (injection.segments) {
        // A page may edit a trailing node created by our split. Preserve its current visible
        // content, including any later annotations, instead of restoring a stale snapshot.
        function currentText(part, seen) {
          if (!part || !part.isConnected || seen.has(part)) return '';
          seen.add(part);
          if (part.nodeType === Node.TEXT_NODE) {
            var value = part.nodeValue;
            var nested = injections.get(part);
            if (nested && nested !== injection) {
              nested.nodes.forEach(function(child) { value += currentText(child, seen); });
            }
            return value;
          }
          if (part.nodeType === Node.ELEMENT_NODE && /^(rt|rp)$/i.test(part.tagName)) return '';
          var text = '';
          for (var child = part.firstChild; child; child = child.nextSibling) text += currentText(child, seen);
          return text;
        }
        injection.segments.forEach(function(segment) {
          injections.delete(segment.node);
          if (segment.node.isConnected && segment.node.nodeValue === segment.text) {
            segment.node.nodeValue = segment.tail
              ? segment.original.substring(0, segment.tailBase) + currentText(segment.tail, new Set())
              : segment.original;
            newNodes.add(segment.node);
          }
        });
      } else injections.delete(node);
      function removeInserted(inserted) {
        var nested = injections.get(inserted);
        if (nested && nested !== injection) {
          injections.delete(inserted);
          nested.nodes.forEach(removeInserted);
        }
        if (inserted.parentNode) {
          inserted.parentNode.removeChild(inserted);
        }
      }
      injection.nodes.forEach(removeInserted);
    }

    newNodes.add(node);
  }

  var MAX_RESCAN_PASSES = 8;

  // Drops every queued node that an also-queued ancestor's scan would reach anyway. A node under
  // an excluded element is kept: scanning the ancestor stops at the exclusion, so only a direct
  // scan of the node itself ever looks at it.
  function outermostNodes(nodes) {
    if (nodes.length < 2) {
      return nodes;
    }

    var queued = new Set(nodes);
    return nodes.filter(function(node) {
      for (var el = node.parentNode; el; el = el.parentNode) {
        if (el.nodeType === Node.ELEMENT_NODE && isExcludedElement(el)) {
          return true;
        }
        if (queued.has(el)) {
          return false;
        }
      }
      return true;
    });
  }

  // Not the same list as EXCLUDED_TAGS in cjk-ruby.runtime.js; they are not unified because changing
  // either changes what that script annotates. Compared with it, this one also skips rp, button,
  // option, code, pre, kbd and samp, and lacks template; it tests `tag in EXCLUDED_TAGS`, which also
  // matches inherited property names, where cjk-ruby indexes the object.
  var EXCLUDED_TAGS = {
    ruby: true,
    rt: true,
    rp: true,
    script: true,
    style: true,
    noscript: true,
    select: true,
    textarea: true,
    input: true,
    button: true,
    option: true,
    code: true,
    pre: true,
    kbd: true,
    samp: true
  };

  function isExcludedElement(element) {
    var tag = element.tagName.toLowerCase();
    // Only this script's own ruby and other scripts' annotation text (rt/rp) are off limits. The
    // base text of a foreign <ruby> can be Vietnamese too: a translator replaces text nodes that
    // another script (zoopdog-cjk-ruby) had wrapped, leaving the translation inside its <ruby>.
    // The popup dictionary and the other zoopdog panels are not page text: annotating them put ruby inside
    // the entries and drew overlay labels over the popup.
    if (element.id && element.id.indexOf('zoopdog-') === 0) return true;
    if (tag === 'ruby') return /(?:^|\s)zoopdog-nom-ruby(?:\s|$)/.test(String(element.className || ''));
    return tag in EXCLUDED_TAGS || element.isContentEditable;
  }

  // Entry point for a synchronous scan of one root (a shadow root that has just appeared).
  function scanTextNodes(node) {
    runScanJob(createScanJob([node]), Infinity);
  }

  // The job owns a zdContainerBoundary cache for its whole life (every slice of it). The first boundary
  // the scan needs fills it from all the roots in one go: reads made later, one at a time between two
  // <ruby> insertions, each force a style recalculation (zdPrefillBoundaryCache).
  function createScanJob(roots) {
    return {roots: roots, index: 0, stack: [], boundaryCache: zdCreateBoundaryCache(roots)};
  }

  function scanClock() {
    return typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
      ? performance.now() : Date.now();
  }

  // The time a slice that starts now may run until. Without timers there is nowhere to continue,
  // so the scan then stays fully synchronous.
  // A hidden document is not sliced either: nobody is watching it stutter, and a background tab
  // throttles timers to about one a second, which would stretch a long scan to minutes.
  function scanDeadline() {
    if (doc.hidden === true || typeof window.setTimeout !== 'function') {
      return Infinity;
    }
    return scanClock() + SETTINGS.scanSliceMs;
  }

  // Walks the roots of `job` depth-first with an explicit stack instead of recursion, so it can
  // stop between two nodes and resume later. Returns true when the job is done, false when the
  // deadline passed first (at least one node is always handled, so a slice makes progress).
  // The next sibling is read *before* a child is handled, because handling a text node inserts
  // its ruby and remaining text right after it and those are this script's own output, not
  // something to visit again in this pass.
  function runScanJob(job, deadline) {
    var stack = job.stack;
    boundaryCache = job.boundaryCache;
    for (;;) {
      var frame = stack[stack.length - 1];
      if (!frame) {
        if (job.index >= job.roots.length) {
          return true;
        }
        beginScanRoot(job, job.roots[job.index++]);
      } else if (frame.next) {
        var child = frame.next;
        if (child.parentNode !== frame.parent) {
          // The page moved or removed the next sibling while the scan was paused, so the
          // rest of this parent's children can no longer be reached from it: scan the parent again.
          newNodes.add(frame.parent);
          stack.pop();
        } else {
          frame.next = child.nextSibling;
          visitScanNode(job, child);
        }
      } else {
        stack.pop();
        // An element's shadow root is scanned after its light children.
        var shadow = frame.element && frame.element.shadowRoot;
        if (shadow && watchShadowRootFor(shadow)) {
          visitScanNode(job, shadow);
        }
      }
      if (deadline !== Infinity && scanClock() >= deadline) {
        return false;
      }
    }
  }

  // A mutation can queue a descendant directly, bypassing the tree walk from the body, so the
  // ancestors are checked here -- once per root -- and the descent only ever looks at the node it is on.
  function beginScanRoot(job, node) {
    if (!node || !node.isConnected) {
      return;
    }
    for (var ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode || ancestor.host) {
      if (ancestor.nodeType === Node.ELEMENT_NODE && isExcludedElement(ancestor)) return;
    }
    visitScanNode(job, node);
  }

  function visitScanNode(job, node) {
    // `isConnected` is true for a node reachable from the document either directly or through
    // an attached shadow tree, unlike `doc.body.contains(node)` -- which a ShadowRoot always
    // fails, since a shadow tree is a separate root, not a descendant in the light-DOM sense.
    if (!node || !node.isConnected) {
      return;
    }

    switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      if (isExcludedElement(node)) {
        return;
      }
      job.stack.push({parent: node, element: node, next: node.firstChild});
      return;

    case Node.DOCUMENT_FRAGMENT_NODE:
      job.stack.push({parent: node, element: null, next: node.firstChild});
      return;

    case Node.TEXT_NODE:
      annotateTextNode(node);
    }
  }

  function cancelScanContinuation() {
    if (scanContinuation) {
      scanContinuation();
      scanContinuation = null;
    }
  }

  // Drops an in-flight sliced scan and its pending continuation.
  function cancelScan() {
    scanGeneration++;
    scanJob = null;
    scanPasses = 0;
    cancelScanContinuation();
  }

  // Continues a paused scan in a later task, when the browser is idle if it can tell.
  function scheduleScanContinuation() {
    var generation = scanGeneration;
    var handle;
    var useIdle = typeof window.requestIdleCallback === 'function';
    function resume() {
      scanContinuation = null;
      if (generation === scanGeneration && enabled && rescanNow) rescanNow();
    }
    scanContinuation = function() {
      if (useIdle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
      else if (!useIdle) window.clearTimeout(handle);
    };
    handle = useIdle
      ? window.requestIdleCallback(resume, {timeout: SETTINGS.scanIdleTimeoutMs})
      : window.setTimeout(resume, 0);
  }

  // A ShadowRoot is itself a DocumentFragment, so scanTextNodes already knows how to walk its
  // childNodes once handed one -- what it does not get for free is future observation, which
  // needs its own explicit observe() call per shadow root (see the comment on `observer` above).
  // The safety net behind the MutationObserver and the frame callback: a self-rescheduling timer
  // for what they miss (a hidden tab never runs frame callbacks, leftovers of a bounded pass, text a
  // page translator rewrites where nothing is observed). It starts at rescanIntervalMs, doubles up
  // to rescanIdleMaxMs while polls find nothing, and drops back as soon as a poll finds work or a
  // mutation is observed (poll.wake). A backed-off poll would leave a mutation waiting for seconds;
  // one already at the short interval is left alone, so a steady stream of mutations cannot keep
  // postponing it (zdCreateBackoffPoll, zd-userscript-common.js). It stops re-arming once disabled.
  var poll = zdCreateBackoffPoll({
    intervalMs: SETTINGS.rescanIntervalMs,
    maxMs: SETTINGS.rescanIdleMaxMs,
    run: function() { return rescanNow(); },
    isActive: function() { return enabled; },
    setTimeout: function(callback, ms) { return window.setTimeout(callback, ms); },
    clearTimeout: function(handle) { window.clearTimeout(handle); }
  });
