import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import imageGenerationTaskSchema from '~/schema/imageGenerationTask';
import type { IImageGenerationTask } from '~/types';

export function createImageGenerationTaskModel(
  mongoose: typeof import('mongoose'),
): Model<IImageGenerationTask> {
  applyTenantIsolation(imageGenerationTaskSchema);
  return (
    mongoose.models.ImageGenerationTask ||
    mongoose.model<IImageGenerationTask>('ImageGenerationTask', imageGenerationTaskSchema)
  );
}
