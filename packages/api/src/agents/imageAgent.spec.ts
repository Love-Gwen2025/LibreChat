import {
  BUILTIN_IMAGE_AGENT_MODEL_ADDITIONS,
  getBuiltinImageAgentId,
  getBuiltinImageAgentModels,
  getEffectiveAgentModels,
  normalizeAgentModels,
} from './imageAgent';

describe('image Agent helpers', () => {
  const originalOverride = process.env.IMAGE_GENERATION_AGENT_ID;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.IMAGE_GENERATION_AGENT_ID;
    } else {
      process.env.IMAGE_GENERATION_AGENT_ID = originalOverride;
    }
  });

  it('resolves the built-in Agent from the image-generation model spec', () => {
    expect(
      getBuiltinImageAgentId({
        modelSpecs: {
          list: [{ name: 'image-generation', preset: { agent_id: 'agent-image' } }],
        },
      }),
    ).toBe('agent-image');
  });

  it('prefers the deployment override', () => {
    process.env.IMAGE_GENERATION_AGENT_ID = 'agent-override';
    expect(getBuiltinImageAgentId(undefined)).toBe('agent-override');
  });

  it('normalizes and de-duplicates model IDs', () => {
    expect(normalizeAgentModels([' gpt-a ', 'gpt-a', '', null, 'gpt-b'])).toEqual([
      'gpt-a',
      'gpt-b',
    ]);
  });

  it('inherits the Agent allowlist when the user restriction is absent', () => {
    expect(getEffectiveAgentModels(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });

  it('intersects an explicit user allowlist', () => {
    expect(getEffectiveAgentModels(['a', 'b', 'c'], ['c', 'a', 'unknown'])).toEqual(['a', 'c']);
  });

  it('treats an explicit empty list as no permitted models', () => {
    expect(getEffectiveAgentModels(['a'], [])).toEqual([]);
  });

  it('adds the project image models without duplicating existing entries', () => {
    expect(getBuiltinImageAgentModels(['gpt-5.5', 'gpt-5.6-sol'])).toEqual([
      'gpt-5.5',
      ...BUILTIN_IMAGE_AGENT_MODEL_ADDITIONS,
    ]);
  });
});
