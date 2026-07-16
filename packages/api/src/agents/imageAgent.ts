type ModelSpecConfig = {
  modelSpecs?: {
    list?: Array<{
      name?: string;
      preset?: {
        agent_id?: string;
      };
    }>;
  };
};

export const IMAGE_AGENT_SPEC_NAME = 'image-generation';
export const BUILTIN_IMAGE_AGENT_MODEL_ADDITIONS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const;

export function getBuiltinImageAgentId(config: ModelSpecConfig | null | undefined): string | null {
  const override = process.env.IMAGE_GENERATION_AGENT_ID?.trim();
  if (override) {
    return override;
  }

  const spec = config?.modelSpecs?.list?.find((item) => item.name === IMAGE_AGENT_SPEC_NAME);
  const agentId = spec?.preset?.agent_id?.trim();
  return agentId || null;
}

export function normalizeAgentModels(models: unknown): string[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return Array.from(
    new Set(
      models
        .filter((model): model is string => typeof model === 'string')
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  );
}

export function getBuiltinImageAgentModels(agentModels: unknown): string[] {
  return normalizeAgentModels([
    ...normalizeAgentModels(agentModels),
    ...BUILTIN_IMAGE_AGENT_MODEL_ADDITIONS,
  ]);
}

/** `undefined` inherits the Agent list; an explicit empty array denies every model. */
export function getEffectiveAgentModels(agentModels: unknown, userModels: unknown): string[] {
  const available = normalizeAgentModels(agentModels);
  if (userModels === undefined || userModels === null) {
    return available;
  }

  const allowed = new Set(normalizeAgentModels(userModels));
  return available.filter((model) => allowed.has(model));
}
