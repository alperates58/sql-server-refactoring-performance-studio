module.exports = {
  scan: {
    viewPrefix: 'AA_',
    maxDependencyDepth: 32,
    runtimeWindowHours: 24
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'deepseek',
    baseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
    model: process.env.AI_MODEL || 'deepseek-chat'
  }
};
