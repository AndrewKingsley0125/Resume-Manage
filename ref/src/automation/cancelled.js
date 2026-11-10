/** Thrown when the user cancels; the run records "cancelled" instead of "failed". */
class Cancelled extends Error {
  constructor() {
    super('Cancelled by user');
  }
}

module.exports = { Cancelled };
