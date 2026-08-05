import {
  buildImageToolContext,
  getVerifiedImageIds,
  enrichImageEditToolDefinitions,
} from './imageContext';

describe('buildImageToolContext', () => {
  it('returns an empty string when no images are available', () => {
    expect(buildImageToolContext({ imageFiles: [], toolName: 'image_edit_oai' })).toBe('');
  });

  it('marks current IDs as verified and tells the model to edit without requesting re-upload', () => {
    const context = buildImageToolContext({
      imageFiles: [{ file_id: 'first-image' }, { file_id: 'second-image' }],
      toolName: 'image_edit_oai',
      contextDescription: 'image editing',
    });

    expect(context).toContain('\n\t- first-image');
    expect(context).toContain('\n\t- second-image');
    expect(context).toContain('These image IDs are verified and available in this turn.');
    expect(context).toContain('instead of claiming that image IDs are unavailable');
    expect(context).toContain('asking the user to upload the same files again');
  });

  it('drops empty IDs and preserves the first occurrence order', () => {
    expect(
      getVerifiedImageIds([
        { file_id: ' first-image ' },
        undefined,
        { file_id: '' },
        { file_id: 'second-image' },
        { file_id: 'first-image' },
      ]),
    ).toEqual(['first-image', 'second-image']);
  });

  it('adds verified IDs to the edit tool schema and registry without mutating either', () => {
    const imageEditDefinition = {
      name: 'image_edit_oai',
      description: 'Edit an image.',
      parameters: {
        type: 'object' as const,
        properties: {
          image_ids: {
            type: 'array' as const,
            description: 'Referenced image IDs.',
          },
        },
      },
    };
    const unrelatedDefinition = { name: 'image_gen_oai', description: 'Generate an image.' };
    const toolDefinitions = [imageEditDefinition, unrelatedDefinition];
    const toolRegistry = new Map(
      toolDefinitions.map((definition) => [definition.name, definition]),
    );

    const result = enrichImageEditToolDefinitions({
      imageFiles: [{ file_id: 'current-image-123' }],
      toolDefinitions,
      toolRegistry,
    });

    expect(result.toolDefinitions[0].description).toContain('current-image-123');
    expect(result.toolDefinitions[0].parameters?.properties?.image_ids?.description).toContain(
      'current-image-123',
    );
    expect(result.toolRegistry?.get('image_edit_oai')?.description).toContain('current-image-123');
    expect(result.toolDefinitions[1]).toBe(unrelatedDefinition);
    expect(result.toolRegistry).not.toBe(toolRegistry);
    expect(imageEditDefinition.description).toBe('Edit an image.');
    expect(imageEditDefinition.parameters.properties.image_ids.description).toBe(
      'Referenced image IDs.',
    );
  });
});
