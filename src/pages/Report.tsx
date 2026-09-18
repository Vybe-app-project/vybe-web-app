import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { Button, Modal, RadioGroup, Textarea, humanize, useToast } from './ui';
import { Shield } from './icons';

export const REPORT_TARGET_TYPES = ['post', 'meal', 'workout', 'workout_plan', 'user'] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS: { value: string; label: string; description?: string }[] = [
  { value: 'spam', label: 'Spam or scam', description: 'Unwanted promotion, fake offers or repetitive posting.' },
  { value: 'harassment', label: 'Harassment or bullying', description: 'Targeting someone to intimidate or degrade them.' },
  { value: 'hate_speech', label: 'Hate speech', description: 'Attacks on people for who they are.' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'misinformation', label: 'Misinformation', description: 'False health, nutrition or training claims.' },
  { value: 'dangerous_activity', label: 'Dangerous activity', description: 'Encourages training or dieting that could cause harm.' },
  { value: 'copyright', label: 'Copyright infringement' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'other', label: 'Something else', description: 'Tell us more below.' },
];

const DETAIL_MAX = 1000;
const DETAIL_ID = 'report-detail';

/**
 * Reusable reporting dialog. Mount it anywhere content can be flagged and
 * control it with `open` / `onClose`. Renders as a sheet on phones and a
 * dialog on desktop.
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
  const what = (targetLabel || humanize(targetType)).toLowerCase();
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [detail, setDetail] = useState('');
  const [detailError, setDetailError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) {
      setReason(REPORT_REASONS[0].value);
      setDetail('');
      setDetailError(undefined);
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
      toast.success('Report sent. Thanks for keeping Vybe safe.');
      onReported?.();
      onClose();
    },
    onError: (e) => {
      // A second report of the same thing is not an error the user can act
      // on: the first one is already in the moderation queue.
      if ((e as { response?: { status?: number } } | null)?.response?.status === 409) {
        toast.info(`You’ve already reported this ${what}. Our team is reviewing it.`);
        onReported?.();
        onClose();
        return;
      }
      toast.error(errMsg(e, 'Could not send the report. Try again in a moment.'));
    },
  });

  const needsDetail = reason === 'other';

  function send() {
    if (needsDetail && detail.trim().length < 10) {
      setDetailError('Add a few words so we know what to look at.');
      document.getElementById(DETAIL_ID)?.focus();
      return;
    }
    setDetailError(undefined);
    submit.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Report ${what}`}
      description="Tell us what is wrong. Our moderation team reviews every report."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={submit.isPending} onClick={send} icon={<Shield size={18} />}>
            Send report
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <RadioGroup
          label="Reason"
          name="report-reason"
          value={reason}
          onChange={(v) => {
            setReason(v);
            if (detailError) setDetailError(undefined);
          }}
          options={REPORT_REASONS.map((r) => ({ value: r.value, label: r.label, description: r.description }))}
        />

        <Textarea
          id={DETAIL_ID}
          label={needsDetail ? 'Details' : 'Details (optional)'}
          rows={3}
          autoGrow
          maxRows={8}
          maxLength={DETAIL_MAX}
          placeholder="Anything that helps us review this faster."
          value={detail}
          error={detailError}
          hint={detailError ? undefined : `${detail.length}/${DETAIL_MAX} characters`}
          onChange={(e) => {
            setDetail(e.target.value);
            if (detailError) setDetailError(undefined);
          }}
        />
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
