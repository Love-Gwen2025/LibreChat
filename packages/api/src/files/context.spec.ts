import { FileSources } from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import { extractFileContext } from './context';

const makeFile = (file_id: string, text: string): IMongoFile =>
  ({
    file_id,
    filename: `${file_id}.txt`,
    source: FileSources.text,
    text,
  }) as IMongoFile;

const makeRequest = (fileTokenLimit: number): ServerRequest =>
  ({
    body: { fileTokenLimit },
    config: {},
  }) as ServerRequest;

describe('extractFileContext', () => {
  it('applies fileTokenLimit across all attachments instead of once per file', async () => {
    const context = await extractFileContext({
      attachments: [makeFile('first', '1234567890'), makeFile('second', 'abcdefghij')],
      req: makeRequest(10),
      tokenCountFn: (text) => text.length,
    });

    expect(context).toContain('1234567890');
    expect(context).not.toContain('second.txt');
  });

  it('uses the remaining aggregate budget for later attachments', async () => {
    const context = await extractFileContext({
      attachments: [makeFile('first', '123456'), makeFile('second', 'abcdefghij')],
      req: makeRequest(10),
      tokenCountFn: (text) => text.length,
    });

    expect(context).toContain('123456');
    expect(context).toContain('abc');
    expect(context).not.toContain('abcd');
  });
});
