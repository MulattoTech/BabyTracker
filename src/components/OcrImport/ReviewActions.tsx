import { CheckCircle2, Save, ScanSearch } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { useLocalization } from '@/src/context/localization';
import type { OcrImportController } from './useOcrImport';
import { ChoiceField } from './Field';
import { rowReviewIssues } from './review-helpers';

export default function ReviewActions({ controller: state }: { controller: OcrImportController }) {
  const { t } = useLocalization();
  if (!state.document) return null;
  if (state.document.committedAt) return <section className="ocr-panel ocr-complete" role="status">
    <CheckCircle2 aria-hidden="true" /><h2>{t(state.document.result?.created ? 'Import saved to the care timeline' : 'Review finalized — no new care events')}</h2>
    <p>{t('Created')}: {state.document.result?.created ?? 0} · {t('Already imported')}: {state.document.result?.duplicates ?? 0} · {t('Skipped by your duplicate decisions')}: {state.document.rows.filter(row => row.approved && state.document?.duplicateDecisions?.[row.id] === 'skip').length}</p>
    <p>{state.document.rows.filter(row => !row.approved).length} {t('unchecked rows were excluded from this finalized document')}</p>
    <p className="ocr-hint">{t('This document is locked after import. Its source and review history remain available under the retention policy.')}</p>
  </section>;
  const selected = state.rows.filter(row => row.approved);
  const selectedIds = new Set(selected.map(row => row.id));
  const localErrors = selected.some(row => rowReviewIssues(row, state.timeZone, state.utcOffsets[row.id]).errors.length > 0);
  const serverIssues = state.preview?.issues.filter(issue => selectedIds.has(issue.rowId)) ?? [];
  const duplicates = state.preview?.duplicates.filter(item => selectedIds.has(item.rowId)) ?? [];
  const duplicateRowIds = [...new Set(duplicates.map(item => item.rowId))];
  const unresolvedDuplicate = duplicateRowIds.some(id => !state.duplicateDecisions[id]);
  const ready = selected.length > 0 && !localErrors && Boolean(state.preview) && !serverIssues.some(issue => issue.errors.length > 0) && !unresolvedDuplicate && state.acknowledgeWarnings;
  return <section className="ocr-panel ocr-final-review" aria-label={t('Confirm import')}>
    <div className="ocr-panel-title"><ScanSearch aria-hidden="true" /><div><h2>{t('Final review')}</h2><p>{selected.length} {t('approved events selected')} · {state.rows.length - selected.length} {t('unchecked rows will be excluded and locked')}</p></div></div>
    <p className="ocr-muted">{t('Saving a draft never writes care events. Preview checks selected events against the current timeline, then you confirm the import.')}</p>
    <div className="ocr-button-row">
      <Button type="button" variant="outline" onClick={() => state.requestReview('save')} disabled={Boolean(state.busy)}><Save size={16} aria-hidden="true" />{t('Save review draft')}</Button>
      <Button type="button" variant="outline" onClick={() => state.requestReview('preview')} disabled={Boolean(state.busy) || selected.length === 0 || localErrors}>{t('Check selected events and duplicates')}</Button>
    </div>
    {state.preview && <div className="ocr-preview-results">
      <h3>{t('Import preview — no care events saved')}</h3>
      {serverIssues.filter(issue => issue.errors.length > 0 || issue.warnings.length > 0).map(issue => <div key={issue.rowId} className="ocr-notice">
        <strong>{t('Draft event')} {state.rows.findIndex(row => row.id === issue.rowId) + 1}</strong>
        {issue.errors.map(message => <p key={message} className="ocr-error">{t(message)}</p>)}
        {issue.warnings.map(message => <p key={message}>{t(message)}</p>)}
      </div>)}
      {duplicateRowIds.map(id => <div key={id} className="ocr-duplicate">
        <strong>{t('Possible duplicate for draft event')} {state.rows.findIndex(row => row.id === id) + 1}</strong>
        <p>{t('Compare these existing records before choosing whether this is a separate event.')}</p>
        <ul>{duplicates.filter(item => item.rowId === id).map(item => <li key={item.recordId}>{t(item.eventType)} · {item.occurredAt}</li>)}</ul>
        <ChoiceField label="Duplicate decision" value={state.duplicateDecisions[id] ?? ''} choices={[
          ['', 'Choose after comparing'], ['skip', 'Skip this row — already recorded'], ['keep', 'Keep this row — a separate real event'],
        ]} onChange={value => state.changeDuplicateDecision(id, value as '' | 'skip' | 'keep')} disabled={Boolean(state.busy)} />
      </div>)}
      {duplicates.length === 0 && <p className="ocr-muted">{t('No possible duplicates were reported for the selected events.')}</p>}
      {state.rows.some(row => !row.approved) && <p className="ocr-notice">{t('Confirming finalizes this document. Unchecked rows will be excluded and locked. Correct and approve them before confirming if you need to import them; uploading the same file will reopen this finalized review.')}</p>}
      <label className="ocr-approval ocr-final-approval"><input type="checkbox" checked={state.acknowledgeWarnings} disabled={Boolean(state.busy)} onChange={event => state.setAcknowledgeWarnings(event.target.checked)} /><span>{t('I reviewed the original source, every selected event, all corrections and warnings, and any duplicate decisions. Import these approved events.')}</span></label>
    </div>}
    <Button type="button" variant="success" onClick={() => state.requestReview('commit')} disabled={!ready || Boolean(state.busy)}>{state.busy === 'commit' ? t('Importing approved events…') : t('Confirm and import approved events')}</Button>
  </section>;
}
