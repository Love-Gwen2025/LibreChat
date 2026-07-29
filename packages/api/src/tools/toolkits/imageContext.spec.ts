import { buildImageToolContext } from './imageContext';

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
});
