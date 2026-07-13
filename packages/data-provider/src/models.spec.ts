import { tModelSpecSchema } from './models';

describe('tModelSpecSchema', () => {
  it('preserves minimal landing display options', () => {
    const spec = tModelSpecSchema.parse({
      name: 'image-generation',
      label: 'Image Workspace',
      preset: {
        endpoint: 'agents',
        agent_id: 'agent_image',
      },
      showOnLanding: true,
      showIconOnLanding: false,
      showAgentContactOnLanding: false,
    });

    expect(spec.showIconOnLanding).toBe(false);
    expect(spec.showAgentContactOnLanding).toBe(false);
  });
});
