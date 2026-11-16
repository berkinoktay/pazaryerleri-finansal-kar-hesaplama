'use client';

import * as React from 'react';

import { useUploadFieldErrorMessage } from '../hooks/use-upload-field-error-message';
import { unplacedIssues } from '../lib/upload-error';

export interface UploadUnplacedIssuesProps {
  /** The submit mutation's error. Only a `422 VALIDATION_ERROR` produces lines. */
  error: Error | null | undefined;
  /** The fields that have a message slot on screen right now; their issues render there. */
  placedFields: readonly string[];
}

/**
 * The inline lines of a 422's field issues that no input on screen owns: a field the dialog
 * does not render, or a parameter the current kurgu hides. One line per distinct sentence, so
 * two issues that read the same are shown once. Renders nothing when every issue has a slot.
 */
export function UploadUnplacedIssues({
  error,
  placedFields,
}: UploadUnplacedIssuesProps): React.ReactElement | null {
  const fieldErrorMessage = useUploadFieldErrorMessage();
  const messages = [
    ...new Set(unplacedIssues(error, placedFields).map((issue) => fieldErrorMessage(issue.code))),
  ];
  if (messages.length === 0) return null;

  return (
    <div className="gap-3xs flex flex-col">
      {messages.map((message) => (
        <p key={message} role="alert" className="text-2xs text-destructive font-medium">
          {message}
        </p>
      ))}
    </div>
  );
}
