// Copy/paste provider: the widget shows the request, the user runs it in
// ChatGPT and pastes the reply back. Matches the existing Resume Manager
// workflow and needs no API key.
module.exports = function manual({ askUser }) {
  return {
    name: 'manual',
    complete: (text, { purpose }) => askUser({ kind: 'llm', purpose, text }),
  };
};
