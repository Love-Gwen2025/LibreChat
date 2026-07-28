/** Maps separately selectable child tools to the constructor that creates them. */
export const toolkitParent = {
  image_edit_oai: 'image_gen_oai',
} as const satisfies Readonly<Record<string, string>>;
