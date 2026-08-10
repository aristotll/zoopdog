'use strict';

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  VALIDATION: 2,
  STALE: 3,
  APPLY_FAILED: 4
});

class WorkflowError extends Error {
  constructor(message, exitCode = EXIT_CODES.VALIDATION, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

module.exports = {
  EXIT_CODES,
  WorkflowError
};
