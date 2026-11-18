import { discountConfigFieldsSchema } from '@/features/campaigns/lib/discount-config';
import { campaignConfigFieldsSchema } from '@/features/campaigns/lib/marketplace-campaign-config';
import {
  COMMISSION_SOURCE_FIELD,
  UPLOAD_FILE_FIELD,
  UPLOAD_NAME_FIELD,
} from '@/features/campaigns/lib/upload-error';
import type { WorkbookUploadExtras } from '@/features/campaigns/lib/workbook-verticals';

/**
 * The multipart fields each kind of upload form can send besides the file, read from the
 * sources the upload dialog submits from: the name field constant, the commission source field
 * constant, and the keys of the config schemas the two config forms validate with. Nothing here
 * is a hand-typed copy of a field name, so a renamed form field shows up in the import contract
 * test against the API's spec.
 */
const EXTRA_IMPORT_FIELDS: Readonly<Record<WorkbookUploadExtras, readonly string[]>> = {
  none: [],
  commissionSource: [COMMISSION_SOURCE_FIELD],
  discountConfig: [UPLOAD_NAME_FIELD, ...Object.keys(discountConfigFieldsSchema.shape)],
  campaignConfig: [UPLOAD_NAME_FIELD, ...Object.keys(campaignConfigFieldsSchema.shape)],
};

/**
 * Every multipart field name an upload form of this kind can put on the wire: the file, then
 * the form's own fields. A field left empty is not sent, so this is the most a request carries.
 */
export function emittedImportFields(extras: WorkbookUploadExtras): readonly string[] {
  return [UPLOAD_FILE_FIELD, ...EXTRA_IMPORT_FIELDS[extras]];
}
