import { useEffect, useRef, useState } from 'react';
import { errMsg, mediaUrl } from '../../lib/api';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, uploadImage } from '../../lib/hooks';
import { Button, Spinner } from '../../components/ui';
import { Image as ImageIcon, X } from '../../components/icons';

/**
 * Optional cover photo for a workout. Uploads through the same owned-media
 * route post photos use; the API re-verifies ownership when the workout is saved.
 */
export function CoverPicker({
  storageKey,
  existingUri,
  onChange,
}: {
  storageKey: string | null;
  existingUri?: string;
  onChange: (key: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview || (!removed && existingUri ? mediaUrl(existingUri) : '');

  async function pick(file?: File) {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError('Use a JPEG, PNG, WebP or HEIC image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is larger than 10 MB. Pick a smaller one.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadImage(file, 'posts');
      onChange(uploaded.key);
      setRemoved(false);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    } catch (e) {
      setError(errMsg(e, 'Upload failed. Check your connection and try again.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      <p className="type-label mb-1.5 text-text-2">Cover photo</p>
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-surface-2">
          {shown ? (
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-text-3" aria-hidden="true">
              <ImageIcon size={22} />
            </span>
          )}
          {uploading ? (
            <span className="absolute inset-0 flex items-center justify-center bg-scrim/40">
              <Spinner size={18} />
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" icon={<ImageIcon size={16} />} loading={uploading} onClick={() => fileRef.current?.click()}>
            {shown ? 'Replace photo' : 'Add photo'}
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              icon={<X size={16} />}
              disabled={uploading}
              onClick={() => {
                setRemoved(true);
                setPreview((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return null;
                });
                onChange(null);
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-text-3">Optional. Shown on the card. JPEG, PNG, WebP or HEIC up to 10 MB.</p>
      )}
      <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden aria-label="Choose a cover photo" onChange={(e) => void pick(e.target.files?.[0])} />
      {storageKey ? <span className="sr-only">Photo ready to save</span> : null}
    </div>
  );
}
