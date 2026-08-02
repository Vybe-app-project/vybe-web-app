import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { Button, Modal, Spinner, Textarea, useToast } from './ui';

export const REPORT_TARGET_TYPES = [
  'post',
  'meal',
  'workout',
  'workout_plan',
  'user',
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'dangerous_activity', label: 'Dangerous activity' },
  { value: 'copyright', label: 'Copyright infringement' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'other', label: 'Something else' },
];

/**
 * Reusable reporting dialog. Mount it anywhere content can be flagged and
 * control it with `open` / `onClose`.
 */
export function ReportModal({
  open,
  onClose,
  targetType,
  targetId,
  targetLabel,
  onReported,
}: {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
  onReported?: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (!open) {
      setReason(REPORT_REASONS[0].value);
      setDetail('');
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { targetType, targetId, reason };
      if (detail.trim()) payload.detail = detail.trim();
      const { data } = await api.post('/reports', payload);
      return data;
    },
    onSuccess: () => {
      toast.success('Report submitted. Thank you for keeping Vybe safe.');
      onReported?.();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not submit the report')),
  });

  return (
    <Modal open={open} onClose={onClose} title={`Report ${targetLabel || targetType}`}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted)]">
          Tell us what is wrong. Our moderation team reviews every report.
        </p>

        <label className="block space-y-1 text-xs text-[var(--color-muted)]">
          Reason
          <select
            className="input-base"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <Textarea
          rows={4}
          maxLength={1000}
          placeholder="Add any details that will help us review this (optional)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <p className="text-right text-[11px] text-[var(--color-muted)]">
          {detail.length}/1000
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? <Spinner size={16} /> : 'Submit report'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Convenience hook so callers only track the target, not the modal wiring. */
export function useReportModal() {
  const [target, setTarget] = useState<{
    targetType: ReportTargetType;
    targetId: string;
    targetLabel?: string;
  } | null>(null);

  const element = target ? (
    <ReportModal
      open
      onClose={() => setTarget(null)}
      targetType={target.targetType}
      targetId={target.targetId}
      targetLabel={target.targetLabel}
    />
  ) : null;

  return { report: setTarget, reportModal: element };
}

export default ReportModal;
