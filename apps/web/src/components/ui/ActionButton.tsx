'use client';

import { useState } from 'react';
import { Button, type ButtonVariant } from './Button';
import { ConfirmDialog, type ConfirmLines } from './ConfirmDialog';

/**
 * A button that is a legal power: shown only when the server listed its action
 * as available, it opens the three-line confirmation window before acting.
 */
export function ActionButton({
  label,
  lines,
  onConfirm,
  variant = 'primary',
  type = 'button',
  disabled,
}: {
  label: string;
  lines: ConfirmLines;
  /** returns true when the dialog may close */
  onConfirm: () => Promise<boolean>;
  variant?: ButtonVariant;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} type={type} disabled={disabled} onClick={() => { setOpen(true); }}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        lines={lines}
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          void onConfirm().then((close) => {
            setBusy(false);
            if (close) setOpen(false);
          });
        }}
      />
    </>
  );
}
