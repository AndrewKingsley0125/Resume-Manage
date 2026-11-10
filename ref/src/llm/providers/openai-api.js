// OpenAI API provider. Not implemented yet: needs an API key in settings
// and a model choice.
module.exports = function openaiApi() {
  return {
    name: 'openai-api',
    async complete() {
      throw new Error('The OpenAI API provider is not implemented yet. Use the "manual" provider.');
    },
  };
};
