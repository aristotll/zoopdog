  // A Save/Preview/Confirm handler is asynchronous: until its request settles a
  // second click (or Enter) would send the same write again and race the first
  // on the server. Wraps such a handler so the modal's action buttons are
  // disabled while its promise is pending and a re-entry is ignored. Every
  // action button is covered (Save and Confirm write the same entry); Cancel
  // stays usable. Mirrors ReaderShared.modal.guard (shared/modal.js).
  function zooGuard(handler) {
    return function(event) {
      var origin = event && (event.currentTarget || event.target);
      var scope = origin && origin.closest ? (origin.closest('.zd-modal, form') || origin) : null;
      if (scope && scope.getAttribute('data-zd-busy')) {
        if (event && event.preventDefault) event.preventDefault();
        return undefined;
      }
      var buttons = scope && scope.querySelectorAll
        ? Array.prototype.filter.call(scope.querySelectorAll('button'), function(button) {
            return !button.disabled && !button.hasAttribute('data-zd-modal-cancel');
          })
        : [];
      if (origin && origin.matches && origin.matches('button') && !origin.disabled && buttons.indexOf(origin) < 0) {
        buttons.push(origin);
      }
      if (scope) scope.setAttribute('data-zd-busy', '1');
      buttons.forEach(function(button) { button.disabled = true; });
      var release = function() {
        buttons.forEach(function(button) { button.disabled = false; });
        if (scope) scope.removeAttribute('data-zd-busy');
      };
      var result;
      try {
        result = handler.call(this, event);
      } catch (error) {
        release();
        throw error;
      }
      Promise.resolve(result).then(release, release);
      return result;
    };
  }

