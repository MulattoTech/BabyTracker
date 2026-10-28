import { FormEvent, useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useLocalization } from '@/src/context/localization';
import { recognizeBrowserOcr } from '@/src/lib/ocr/browser';
import { packBrowserOcrEnvelope } from '@/src/lib/ocr/envelope';
import { ChoiceField, Field, TextField } from './Field';

interface Props {
  babyName: string;
  defaultTimeZone: string;
  busy: string;
  onUpload: (form: FormData) => unknown;
  onCancel: () => void;
}

export default function UploadPanel({ babyName, defaultTimeZone, busy, onUpload, onCancel }: Props) {
  const { t } = useLocalization();
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState('');
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [timeFormat, setTimeFormat] = useState('unknown');
  const [rotation, setRotation] = useState('0');
  const [retention, setRetention] = useState('30');
  const [error, setError] = useState('');
  const [recognitionMode, setRecognitionMode] = useState<'server' | 'browser'>('server');
  const [progress, setProgress] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setTimeZone(current => current || defaultTimeZone); }, [defaultTimeZone]);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!file) { setError(t('Choose a photo or PDF first.')); return; }
    if (file.size > 12 * 1024 * 1024) { setError(t('Choose a document smaller than 12 MB.')); return; }
    const form = new FormData();
    form.set('file', file); form.set('timeZone', timeZone); form.set('timeFormat', timeFormat);
    form.set('rotation', rotation); form.set('retentionDays', retention);
    form.set('defaultDate', date);
    if (recognitionMode === 'browser') {
      const abort = new AbortController(); controller.current = abort;
      setRecognizing(true); setProgress(t('Loading local OCR engine'));
      try {
        const evidence = await recognizeBrowserOcr(file, abort.signal, { onProgress: setProgress });
        if (abort.signal.aborted) return;
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        const envelope = packBrowserOcrEnvelope(sourceBytes, evidence);
        form.set('file', new File([envelope.buffer as ArrayBuffer], file.name, { type: 'application/octet-stream', lastModified: file.lastModified }));
      } catch (reason) {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
        else if (reason instanceof Error) setError(t('Recognition cancelled. No care records were created.'));
        return;
      } finally { controller.current = null; setRecognizing(false); setProgress(''); }
    }
    await onUpload(form);
  };
  const busyNow = Boolean(busy) || recognizing;
  return <form className="ocr-panel ocr-upload" onSubmit={submit}>
    <div className="ocr-panel-title"><UploadCloud aria-hidden="true" /><div><h2>{t('Bring a care log into your timeline')}</h2><p>{t('Import for')}: <strong>{babyName}</strong></p></div></div>
    <p className="ocr-muted">{t('English printed text is the current recognition baseline. Handwriting recognition is unsupported and may need manual transcription. Every event needs your approval.')}</p>
    <Field label="Photo or document" hint="JPEG, PNG, WebP or PDF · up to 12 MB and 6 PDF pages. Export HEIC photos to JPEG first.">
      {id => <Input id={id} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busyNow} onChange={event => setFile(event.target.files?.[0] ?? null)} />}
    </Field>
    <ChoiceField label="Recognition location" value={recognitionMode} onChange={value => { const next = value as 'server' | 'browser'; setRecognitionMode(next); if (next === 'browser') setRotation('0'); }} disabled={busyNow} choices={[
      ['server', 'Server-side local OCR'], ['browser', 'Browser local OCR'],
    ]} />
    {recognizing && <p className="ocr-hint" role="status" aria-live="polite">{progress || t('Processing locally...')}</p>}
    <div className="ocr-field-grid">
      <TextField label="Date for rows without a date" type="date" value={date} onChange={setDate} disabled={busyNow} />
      <TextField label="Source time zone" value={timeZone} onChange={setTimeZone} placeholder="America/Chicago" disabled={busyNow} />
      <ChoiceField label="Clock format on this sheet" value={timeFormat} onChange={setTimeFormat} disabled={busyNow} choices={[
        ['unknown', 'Unspecified — flag ambiguous times'], ['24h', '24-hour clock'], ['12h', '12-hour clock with AM/PM'],
      ]} />
      <ChoiceField label="Rotate before recognition" value={rotation} onChange={setRotation} disabled={busyNow || recognitionMode === 'browser'} choices={[
        ['0', 'No extra rotation'], ['90', '90° clockwise'], ['180', '180°'], ['270', '90° counterclockwise'],
      ]} />
      <TextField label="Keep original source for days" type="number" min={1} max={365} step={1} value={retention} onChange={setRetention} disabled={busyNow} />
    </div>
    <p className="ocr-hint">{t('A blank date stays unresolved. Confirm the time zone written on the log; it may differ from your device. Source files can be removed after review without deleting care events.')}</p>
    {error && <p role="alert" className="ocr-error">{error}</p>}
    <div className="ocr-button-row">
      <Button type="submit" disabled={!file || busyNow}>{recognizing ? t('Recognizing document…') : busy === 'upload' ? t('Creating review draft…') : t('Upload and create review draft')}</Button>
      {(busy === 'upload' || recognizing) && <Button type="button" variant="outline" onClick={() => { controller.current?.abort(); onCancel(); }}>{t('Cancel recognition')}</Button>}
    </div>
  </form>;
}
