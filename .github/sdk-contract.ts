import { createUploader, type CreateUploaderOptions } from '@autorender/js';
import { createAR } from '@autorender/js/viewtag';
import { AutorenderUploader } from '@autorender/react';
import { ARImage as ReactARImage } from '@autorender/react/viewtag';
import { AutorenderUploader as NextAutorenderUploader } from '@autorender/nextjs';
import { ARImage as NextARImage } from '@autorender/nextjs/viewtag';
import { withAutorender } from '@autorender/nextjs/next-config';

const uploadOptions = {
  apiKey: 'contract-only',
} satisfies Pick<CreateUploaderOptions, 'apiKey'>;

// Referencing the values makes this a real export contract: deleting or renaming any
// published symbol makes TypeScript fail instead of allowing the SDK matrix to drift.
void [
  createUploader,
  createAR,
  AutorenderUploader,
  ReactARImage,
  NextAutorenderUploader,
  NextARImage,
  withAutorender,
  uploadOptions,
];
