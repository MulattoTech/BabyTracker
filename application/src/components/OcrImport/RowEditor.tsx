import { CheckCircle2, CopyPlus, FileSearch, Trash2 } from 'lucide-react';
import type { OcrCandidate, OcrEditableField, OcrFieldOrigin } from '@/src/lib/ocr/types';
import { normalizeAmountMl } from '@/src/lib/ocr/validation';
import { Button } from '@/src/components/ui/button';
import { Textarea } from '@/src/components/ui/textarea';
import { useLocalization } from '@/src/context/localization';
import { ChoiceField, Field, TextField } from './Field';
import { RowOffsets, rowReviewIssues } from './review-helpers';
import TimeChoice from './TimeChoice';

interface Props {
  row: OcrCandidate;
  number: number;
  timeZone: string;
  offsets?: RowOffsets;
  locked: boolean;
  onEdit: (patch: Partial<OcrCandidate>) => void;
  onApprove: (value: boolean) => void;
  onOffset: (key: 'start' | 'end', value: number | undefined) => void;
  onSource: () => void;
  onSplit: () => void;
  onRemove: () => void;
}

const fieldLabels: Record<OcrEditableField, string> = {
  eventType: 'Event type', localDate: 'Event date', localTime: 'Event time', endLocalDate: 'Sleep end date',
  endLocalTime: 'Sleep end time', feedType: 'Feeding method', bottleType: 'Milk designation', amount: 'Feeding amount',
  unit: 'Amount unit', diaperType: 'Diaper type', sleepType: 'Sleep type', notes: 'Notes',
};
const originLabels: Record<OcrFieldOrigin, string> = {
  source: 'Recognized from source', context: 'Date or sheet context', missing: 'Not recorded',
  ambiguous: 'Needs clarification', corrected: 'Corrected during review',
};

export default function RowEditor({ row, number, timeZone, offsets, locked, onEdit, onApprove, onOffset, onSource, onSplit, onRemove }: Props) {
  const { t } = useLocalization();
  const issues = rowReviewIssues(row, timeZone, offsets);
  const warnings = [...new Set([...row.warnings, ...issues.warnings])];
  const change = <K extends keyof OcrCandidate,>(key: K, value: OcrCandidate[K]) => onEdit({ [key]: value });
  const status = row.approved ? 'Approved for import' : issues.errors.length ? 'Needs correction' : 'Ready for review';
  return <article className={`ocr-row${row.approved ? ' ocr-row-approved' : ''}`} aria-label={`${t('Draft event')} ${number}`}>
    <header className="ocr-row-header">
      <div><span className="ocr-row-number">{number}</span><strong>{t('Draft event')}</strong><span className={`ocr-status ${row.approved ? 'ocr-status-ok' : 'ocr-status-review'}`}>{row.approved && <CheckCircle2 size={13} aria-hidden="true" />}{t(status)}</span></div>
      <Button type="button" size="sm" variant="ghost" onClick={onSource}><FileSearch size={15} aria-hidden="true" />{t('Page')} {row.source.page}</Button>
    </header>
    <fieldset disabled={locked} className="ocr-row-fields">
      <legend className="sr-only">{t('Correct this event')}</legend>
      <div className="ocr-field-grid">
        <ChoiceField label="Event type" value={row.eventType} onChange={value => change('eventType', value as OcrCandidate['eventType'])} choices={[
          ['unknown', 'Choose event type'], ['feed', 'Feeding'], ['diaper', 'Diaper'], ['sleep', 'Sleep'],
        ]} />
        <TextField label="Event date" type="date" value={row.localDate ?? ''} onChange={value => change('localDate', value || null)} />
        <TextField label="Event time (24-hour)" type="time" value={row.localTime ?? ''} onChange={value => change('localTime', value || null)} />
        <TimeChoice date={row.localDate} time={row.localTime} timeZone={timeZone} value={offsets?.start} onChange={value => onOffset('start', value)} />
        {row.eventType === 'feed' && <>
          <ChoiceField label="Feeding method" value={row.feedType ?? ''} onChange={value => change('feedType', value as OcrCandidate['feedType'] || null)} choices={[
            ['', 'Choose feeding method'], ['BOTTLE', 'Bottle'], ['BREAST', 'Breastfeeding'],
          ]} />
          <ChoiceField label="Milk designation" value={row.bottleType ?? ''} onChange={value => change('bottleType', value as OcrCandidate['bottleType'] || null)} choices={[
            ['', 'Not recorded'], ['Formula', 'Formula'], ['Breast Milk', 'Breast milk'], ['Other', 'Other — describe in notes'],
          ]} />
          <TextField label="Feeding amount" type="number" min={0} step="any" value={row.amount === null ? '' : String(row.amount)} onChange={value => change('amount', value === '' ? null : Number(value))} />
          <ChoiceField label="Amount unit" value={row.unit ?? ''} onChange={value => change('unit', value as OcrCandidate['unit'] || null)} choices={[
            ['', 'Choose unit'], ['ML', 'mL'], ['OZ', 'US fluid ounces'],
          ]} />
        </>}
        {row.eventType === 'diaper' && <ChoiceField label="Diaper type" value={row.diaperType ?? ''} onChange={value => change('diaperType', value as OcrCandidate['diaperType'] || null)} choices={[
          ['', 'Choose diaper type'], ['WET', 'Wet'], ['DIRTY', 'Dirty'], ['BOTH', 'Wet and dirty'], ['DRY', 'Dry'],
        ]} />}
        {row.eventType === 'sleep' && <>
          <ChoiceField label="Sleep type" value={row.sleepType ?? ''} onChange={value => change('sleepType', value as OcrCandidate['sleepType'] || null)} choices={[
            ['', 'Choose sleep type'], ['NAP', 'Nap'], ['NIGHT_SLEEP', 'Night sleep'],
          ]} />
          <TextField label="Sleep end date" type="date" value={row.endLocalDate ?? ''} onChange={value => change('endLocalDate', value || null)} />
          <TextField label="Sleep end time (24-hour)" type="time" value={row.endLocalTime ?? ''} onChange={value => change('endLocalTime', value || null)} />
          <TimeChoice date={row.endLocalDate} time={row.endLocalTime} timeZone={timeZone} value={offsets?.end} onChange={value => onOffset('end', value)} end />
        </>}
      </div>
      {row.eventType === 'feed' && row.amount !== null && Number.isFinite(row.amount) && row.amount > 0 && row.unit && <p className="ocr-hint">{t('Equivalent volume')}: {normalizeAmountMl(row.amount, row.unit)} mL · {t('The entered unit is preserved.')}</p>}
      <Field label="Notes and stool characteristics">{id => <Textarea id={id} value={row.notes} maxLength={2000} rows={2} onChange={event => change('notes', event.target.value)} />}</Field>
      {issues.errors.length > 0 && <ul className="ocr-row-errors" aria-label={t('Fields to resolve')}>{issues.errors.map(message => <li key={message}>{t(message)}</li>)}</ul>}
      <label className="ocr-approval"><input type="checkbox" checked={row.approved} disabled={locked || (!row.approved && issues.errors.length > 0)} onChange={event => onApprove(event.target.checked)} /><span>{t('I checked this event against the source. Include it in the import.')}</span></label>
    </fieldset>
    <details className="ocr-evidence">
      <summary>{t('Recognized text, uncertainty and provenance')}</summary>
      <p className="ocr-hint">{t('Source page')}: {row.source.page} · {t('Line')}: {row.source.line} · {t('Engine')}: {row.source.engine}</p>
      <p className="ocr-hint">{t(row.source.recognitionMode === 'handwriting-unsupported' ? 'Handwriting is unsupported; use manual transcription.' : row.source.recognitionMode === 'manual-transcription' ? 'Manual transcription — compare every field with the original page.' : 'Printed-text OCR baseline only; handwriting recognition is not proven.')}</p>
      {row.source.crop && <p className="ocr-hint">{t('Source crop (x, y, width, height)')}: {row.source.crop.x}, {row.source.crop.y}, {row.source.crop.width}, {row.source.crop.height}</p>}
      {row.source.extractionVersion && <p className="ocr-hint">{t('Extraction/model version')}: {row.source.extractionVersion}</p>}
      <p className="ocr-hint">{t('Engine recognition score')}: {row.source.confidence === null ? t('Unavailable') : `${row.source.confidence.toFixed(1)} / 100`} · {t('This is not a field accuracy score.')}</p>
      <pre className="ocr-raw-text">{row.source.rawText || t('Manual transcription — compare with the original page.')}</pre>
      {warnings.length > 0 && <ul className="ocr-warnings">{warnings.map(message => <li key={message}>{t(message)}</li>)}</ul>}
      <dl className="ocr-provenance">{Object.entries(row.fieldSources).map(([field, origin]) => <div key={field}><dt>{t(fieldLabels[field as OcrEditableField] || field)}</dt><dd>{t(originLabels[origin] || origin)}</dd></div>)}</dl>
    </details>
    {!locked && <div className="ocr-button-row ocr-row-tools">
      <Button type="button" size="sm" variant="outline" onClick={onSplit}><CopyPlus size={14} aria-hidden="true" />{t('Split into another draft row')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 size={14} aria-hidden="true" />{t('Remove draft row')}</Button>
    </div>}
  </article>;
}
