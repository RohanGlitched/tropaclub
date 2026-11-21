'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { resolveInput } from '@/lib/client';

/** A plain "paste a wallet" field that opens the ticket page. */
export default function SeatSearchBox({ label = 'Find your seat', button = 'Find seat', note }: { label?: string; button?: string; note?: string }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <form
      className="find"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg('');
        const r = await resolveInput(value);
        if (!r.ok) {
          setBusy(false);
          return setMsg(r.message);
        }
        router.push(`/ticket/${r.address}`);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="find-row">
        <input id={id} name="wallet" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0x… or yourname.base.eth" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={msg ? true : undefined} aria-describedby={`${id}-s`} />
        <button className="btn btn-accent" type="submit" disabled={busy}>{busy ? 'Looking…' : button}</button>
      </div>
      <p id={`${id}-s`} className="find-status tone-warn" role="status" aria-live="polite">{msg}</p>
      {note && <p className="find-note">{note}</p>}
    </form>
  );
}
