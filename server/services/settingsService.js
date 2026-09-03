/**
 * Settings Management Service
 *
 * Keeps runtime configuration in Node.js process memory.
 * Passwords and API keys are NEVER logged or written to file/browser.
 */

const inMemoryConfig = {
  activePrefix: 'AA_',
  scoring: {
    runtimeWeight: 35,
    regressionWeight: 25,
    repeatedWeight: 15,
    depthWeight: 10,
    sargableWeight: 10,
    blastWeight: 5
  },
  ai: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-coder',
    temperature: 0.15,
    maxTokens: 4096,
    hasApiKey: false,
    apiKey: null // strictly volatile in Node process memory
  },
  runtime: {
    preference: 'auto', // 'auto' | 'query_store' | 'plan_cache'
    historyWindow: '24h' // '1h' | '24h' | '7d' | '30d'
  },
  appearance: {
    theme: 'dark',
    density: 'comfortable',
    fontScale: 'default',
    editorFontSize: 14,
    graphGrid: 'on',
    animations: 'on'
  }
};

function getConfig() {
  // Return safe copy without the raw secret key
  return {
    activePrefix: inMemoryConfig.activePrefix,
    scoring: { ...inMemoryConfig.scoring },
    ai: {
      provider: inMemoryConfig.ai.provider,
      baseUrl: inMemoryConfig.ai.baseUrl,
      model: inMemoryConfig.ai.model,
      temperature: inMemoryConfig.ai.temperature,
      maxTokens: inMemoryConfig.ai.maxTokens,
      hasApiKey: !!inMemoryConfig.ai.apiKey
    },
    runtime: { ...inMemoryConfig.runtime },
    appearance: { ...inMemoryConfig.appearance }
  };
}

function updateConfig(updates = {}) {
  if (updates.activePrefix) inMemoryConfig.activePrefix = String(updates.activePrefix).trim();
  if (updates.scoring) {
    inMemoryConfig.scoring = {
      ...inMemoryConfig.scoring,
      ...updates.scoring
    };
  }
  if (updates.ai) {
    const aiUpdates = { ...updates.ai };
    if (aiUpdates.apiKey) {
      inMemoryConfig.ai.apiKey = String(aiUpdates.apiKey).trim();
      delete aiUpdates.apiKey;
    }
    inMemoryConfig.ai = {
      ...inMemoryConfig.ai,
      ...aiUpdates
    };
  }
  if (updates.runtime) {
    inMemoryConfig.runtime = {
      ...inMemoryConfig.runtime,
      ...updates.runtime
    };
  }
  if (updates.appearance) {
    inMemoryConfig.appearance = {
      ...inMemoryConfig.appearance,
      ...updates.appearance
    };
  }
  return getConfig();
}

function getApiKey() {
  return inMemoryConfig.ai.apiKey;
}

function resetScoringDefaults() {
  inMemoryConfig.scoring = {
    runtimeWeight: 35,
    regressionWeight: 25,
    repeatedWeight: 15,
    depthWeight: 10,
    sargableWeight: 10,
    blastWeight: 5
  };
  return inMemoryConfig.scoring;
}

module.exports = {
  getConfig,
  updateConfig,
  getApiKey,
  resetScoringDefaults
};
