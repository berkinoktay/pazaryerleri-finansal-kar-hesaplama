import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

/**
 * Whether an upload or rename name is longer than the API's name rule allows. The API trims
 * the name and then counts code points, so this does the same: an emoji outside the Basic
 * Multilingual Plane counts once here, while the browser's `maxlength` would count it twice
 * (two UTF-16 units).
 */
export function isUploadNameTooLong(value: string): boolean {
  return Array.from(value.trim()).length > UPLOAD_NAME_MAX_LENGTH;
}
