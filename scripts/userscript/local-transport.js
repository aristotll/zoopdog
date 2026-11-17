// Local reader transport. Its dependencies are injected so request semantics can be tested
// independently of popup UI and userscript-manager globals.
/**
 * @typedef {object} ZooLocalTransportOptions
 * @property {string} baseUrl
 * @property {() => number} getTimeout
 * @property {(details: ZooRequestDetails) => void} send
 */
/**
 * @typedef {object} ZooRequestDetails
 * @property {string} method
 * @property {string} url
 * @property {number} timeout
 * @property {(response: {status: number, responseText?: string}) => void} onload
 * @property {() => void} onerror
 * @property {() => void} ontimeout
 * @property {string} [data]
 * @property {Record<string, string>} [headers]
 */
/** @param {ZooLocalTransportOptions} options */
function createZooLocalTransport(options) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {Record<string, any> | null | undefined} params
   * @param {string | undefined} body
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  return function(method, path, params, body, timeout) {
    var limit = timeout || options.getTimeout();
    return new Promise(function(resolve, reject) {
      var settled = false;
      /** @type {any} */
      var watchdog = null;
      /** @param {(value: any) => void} callback @param {any} value */
      function settle(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        callback(value);
      }
      /** @type {string[]} */
      var pairs = [];
      if (params) {
        Object.keys(params).forEach(function(key) {
          var value = params[key];
          if (value === undefined || value === null || value === '') return;
          pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        });
      }
      var query = pairs.join('&');
      var url = options.baseUrl + path + (query ? (path.indexOf('?') === -1 ? '?' : '&') + query : '');
      watchdog = setTimeout(function() { settle(reject, new Error('request timed out')); }, limit + 25);
      try {
        /** @type {ZooRequestDetails} */
        var details = {
          method: method, url: url, timeout: limit,
          onload: function(response) {
            /** @type {any} */
            var payload = {};
            try { payload = JSON.parse(response.responseText || '{}'); } catch (parseError) { payload = {}; }
            if (response.status >= 200 && response.status < 300) {
              settle(resolve, payload);
            } else {
              var failure = /** @type {Error & {status?: number, payload?: any}} */ (
                new Error(payload.error || payload.message || ('request failed (' + response.status + ')')));
              failure.status = response.status;
              failure.payload = payload;
              settle(reject, failure);
            }
          },
          onerror: function() { settle(reject, new Error('request failed')); },
          ontimeout: function() { settle(reject, new Error('request timed out')); }
        };
        if (body !== undefined) {
          details.data = body;
          details.headers = {'Content-Type': 'application/json'};
        }
        options.send(details);
      } catch (error) { settle(reject, error); }
    });
  };
}
