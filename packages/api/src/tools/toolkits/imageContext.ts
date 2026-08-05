import type { LCTool, LCToolRegistry } from '@librechat/agents';

type ImageFileRef = {
  file_id?: string | null;
};

export function getVerifiedImageIds(
  imageFiles: ReadonlyArray<ImageFileRef | null | undefined> | null | undefined,
): string[] {
  if (!imageFiles?.length) {
    return [];
  }

  const imageIds: string[] = [];
  const seen = new Set<string>();
  for (const file of imageFiles) {
    const imageId = file?.file_id?.trim();
    if (!imageId || seen.has(imageId)) {
      continue;
    }
    seen.add(imageId);
    imageIds.push(imageId);
  }
  return imageIds;
}

/** Builds turn-scoped instructions containing verified image IDs. */
export function buildImageToolContext({
  imageFiles,
  toolName,
  contextDescription = 'image context',
}: {
  imageFiles: ReadonlyArray<ImageFileRef | null | undefined>;
  toolName: string;
  contextDescription?: string;
}): string {
  const imageIds = getVerifiedImageIds(imageFiles);
  if (imageIds.length === 0) {
    return '';
  }

  let toolContext = `Image files provided in this request (their image IDs listed in order of appearance) available for ${contextDescription}:`;
  for (const imageId of imageIds) {
    toolContext += `\n\t- ${imageId}`;
  }
  toolContext += `\n\nThese image IDs are verified and available in this turn. Include any you need in the \`image_ids\` array when calling \`${toolName}\` to use them as visual context for generation. For an image-editing request, call \`${toolName}\` with the relevant IDs instead of claiming that image IDs are unavailable or asking the user to upload the same files again. You may also include previously referenced or generated image IDs.`;
  return toolContext;
}

function addVerifiedIdsToDefinition(definition: LCTool, imageIds: string[]): LCTool {
  const idsText = JSON.stringify(imageIds);
  const availability =
    `Current verified image IDs for this request: ${idsText}. ` +
    'For edits or enhancements of the uploaded images, call this tool and copy the relevant IDs exactly; do not claim that an ID is unavailable.';
  const imageIdsSchema = definition.parameters?.properties?.image_ids;

  return {
    ...definition,
    description: [availability, definition.description].filter(Boolean).join('\n\n'),
    ...(imageIdsSchema && {
      parameters: {
        ...definition.parameters,
        properties: {
          ...definition.parameters?.properties,
          image_ids: {
            ...imageIdsSchema,
            description: [availability, imageIdsSchema.description].filter(Boolean).join('\n\n'),
          },
        },
      },
    }),
  };
}

/**
 * Places verified request IDs directly in the image-edit tool schema. This is a
 * second, schema-level source of truth in addition to dynamic system context.
 */
export function enrichImageEditToolDefinitions({
  imageFiles,
  toolDefinitions,
  toolRegistry,
  toolName = 'image_edit_oai',
}: {
  imageFiles: ReadonlyArray<ImageFileRef | null | undefined>;
  toolDefinitions: ReadonlyArray<LCTool>;
  toolRegistry?: LCToolRegistry;
  toolName?: string;
}): { toolDefinitions: LCTool[]; toolRegistry?: LCToolRegistry } {
  const imageIds = getVerifiedImageIds(imageFiles);
  if (imageIds.length === 0) {
    return { toolDefinitions: [...toolDefinitions], toolRegistry };
  }

  const enrichedDefinitions = toolDefinitions.map((definition) =>
    definition.name === toolName ? addVerifiedIdsToDefinition(definition, imageIds) : definition,
  );
  const registryDefinition = toolRegistry?.get(toolName);
  if (!registryDefinition || !toolRegistry) {
    return { toolDefinitions: enrichedDefinitions, toolRegistry };
  }

  const enrichedRegistry = new Map(toolRegistry);
  enrichedRegistry.set(toolName, addVerifiedIdsToDefinition(registryDefinition, imageIds));
  return { toolDefinitions: enrichedDefinitions, toolRegistry: enrichedRegistry };
}
