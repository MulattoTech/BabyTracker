'use client';

import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import {
  FormPage,
  FormPageContent,
  FormPageFooter,
} from '@/src/components/ui/form-page';
import { useLocalization } from '@/src/context/localization';
import ConfigureStep from './ConfigureStep';
import ReviewStep from './ReviewStep';
import LogSheetReview from './LogSheetReview';
import { recognizeLogSheetFiles } from '@/src/lib/importers/log-sheet/recognize';
import type { LogSheetCandidate, LogSheetSourcePage } from '@/src/lib/importers/log-sheet/types';
import {
  ExistingBaby,
  ExternalImportProps,
  ExternalImportPreviewResponse,
  ExternalImportStep,
  ExternalImportUiConfiguration,
  ExternalImportCompletedResult,
} from './external-import.types';

type ProviderId = 'baby-buddy' | 'huckleberry' | 'log-sheet-ocr';

const providerOptions: readonly {
  id: ProviderId;
  name: string;
  description: string;
  multiple: boolean;
}[] = [
  {
    id: 'baby-buddy',
    name: 'Baby Buddy',
    description: 'Select the CSV files exported from Baby Buddy Database Admin',
    multiple: true,
  },
  {
    id: 'huckleberry',
    name: 'Huckleberry',
    description: 'Select a Huckleberry care log CSV export',
    multiple: false,
  },
  {
    id: 'log-sheet-ocr',
    name: 'Photo or PDF care log',
    description: 'Review mixed feeding and diaper log rows extracted locally from a photo or PDF page',
    multiple: true,
  },
];

export default function ExternalImport({
  isOpen,
  onClose,
}: ExternalImportProps) {
  const { t } = useLocalization();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionAbortRef = useRef<AbortController | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>('baby-buddy');
  const [preview, setPreview] =
    useState<ExternalImportPreviewResponse | null>(null);
  const [isPreviewing, setIsPreviewing] =
    useState(false);
  const [error, setError] = useState('');
  const [step, setStep] =
    useState<ExternalImportStep>('select');
  const [babies, setBabies] =
    useState<ExistingBaby[]>([]);
  const [isLoadingBabies, setIsLoadingBabies] =
    useState(false);
  const [configuration, setConfiguration] =
    useState<ExternalImportUiConfiguration>({
      sourceTimezone: 'UTC',
      childDestinations: {},
      units: {},
    });
  const [isImporting, setIsImporting] =
    useState(false);
  const [completedResult, setCompletedResult] =
    useState<ExternalImportCompletedResult | null>(null);
  const [logSheetRows, setLogSheetRows] = useState<LogSheetCandidate[]>([]);
  const [logSheetPages, setLogSheetPages] = useState<LogSheetSourcePage[]>([]);
  const [logSheetBabyId, setLogSheetBabyId] = useState('');
  const [recognitionProgress, setRecognitionProgress] = useState('');

  useEffect(() => () => {
    logSheetPages.forEach(page => {
      if (page.imageUrl.startsWith('blob:')) URL.revokeObjectURL(page.imageUrl);
    });
  }, [logSheetPages]);

  useEffect(() => {
    if (isOpen) {
      const detectedTimezone =
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone || 'UTC';

      setConfiguration({
        sourceTimezone: detectedTimezone,
        childDestinations: {},
        units: {},
      });

      return;
    }

    setFiles([]);
    setProviderId('baby-buddy');
    setPreview(null);
    setError('');
    setIsPreviewing(false);
    setStep('select');
    setBabies([]);
    setIsLoadingBabies(false);
    setIsImporting(false);
    setCompletedResult(null);
    setLogSheetRows([]);
    setLogSheetPages([]);
    setLogSheetBabyId('');
    setRecognitionProgress('');
    recognitionAbortRef.current = null;
  }, [isOpen]);

  const getAuthHeaders = (): HeadersInit => {
    const token = localStorage.getItem('authToken');

    return token
      ? { Authorization: `Bearer ${token}` }
      : {};
  };

  const handleFilesSelected = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = Array.from(
      event.target.files || [],
    );

    setFiles(selectedFiles);
    setPreview(null);
    setLogSheetRows([]);
    setLogSheetPages([]);
    setError('');
  };

  const loadExistingBabies = async (): Promise<ExistingBaby[]> => {
    setIsLoadingBabies(true);

    try {
      const response = await fetch('/api/baby', {
        headers: getAuthHeaders(),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            t('Failed to load existing babies'),
        );
      }

      const available = (result.data as ExistingBaby[]).filter(baby => !baby.inactive);
      setBabies(available);
      return available;
    } finally {
      setIsLoadingBabies(false);
    }
  };

  const initialiseConfiguration = (
    response: ExternalImportPreviewResponse,
  ) => {
    const childDestinations = Object.fromEntries(
      response.details.children.map(child => [
        child.sourceId,
        child.activityOnly
          ? {
              mode: 'existing' as const,
              targetBabyId: '',
            }
          : {
              mode: 'new' as const,
              gender: '' as const,
            },
      ]),
    );

    const units = Object.fromEntries(
      response.details.unitRequirements.map(
        requirement => [
          requirement.entityType,
          requirement.allowedUnits[0],
        ],
      ),
    );

    setConfiguration(current => ({
      ...current,
      childDestinations,
      units,
    }));
  };

  const providerConfiguration = () => ({
    feedingUnit: configuration.units.feeding,
    pumpingUnit: configuration.units.pumping,
    heightUnit: configuration.units.height,
    weightUnit: configuration.units.weight,
    headCircumferenceUnit:
      configuration.units['head-circumference'],
    temperatureUnit: configuration.units.temperature,
  });

  const buildExecutionConfiguration = () => ({
    execution: {
      sourceTimezone: configuration.sourceTimezone,
      childDestinations:
        configuration.childDestinations,
    },
    provider: providerConfiguration(),
  });

  const handleImport = async () => {
    if (providerId !== 'log-sheet-ocr' && !preview) {
      return;
    }

    try {
      setIsImporting(true);
      setError('');

      let response: Response;
      if (providerId === 'log-sheet-ocr') {
        const selectedRows = logSheetRows.filter(row => row.selected);
        if (!logSheetBabyId || !selectedRows.length || selectedRows.some(row => !row.reviewed)) {
          throw new Error(t('Choose a baby, select rows, and mark each selected row as reviewed'));
        }
        response = await fetch('/api/import/log-sheet/execute', {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            babyId: logSheetBabyId,
            timezone: configuration.sourceTimezone,
            rows: selectedRows.map(row => ({
              selected: row.selected,
              reviewed: row.reviewed,
              documentHash: row.documentHash,
              page: row.page,
              line: row.line,
              eventKind: row.eventKind,
              date: row.date,
              time: row.time,
              feedKind: row.feedKind,
              bottleType: row.bottleType,
              amount: row.amount,
              unit: row.unit,
              diaperType: row.diaperType,
            })),
          }),
        });
      } else {
        const formData = new FormData();
        formData.set('providerId', providerId);
        files.forEach(file => formData.append('files', file));
        formData.set('configuration', JSON.stringify(buildExecutionConfiguration()));
        response = await fetch('/api/import/external/execute', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData,
        });
      }

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            t('Failed to execute import'),
        );
      }

      setCompletedResult({
        execution: result.data,
      });
      setStep('result');
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : t('Failed to execute import'),
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handlePreview = async () => {
    if (files.length === 0) {
      setError(t(providerId === 'log-sheet-ocr' ? 'Select at least one image or PDF' : 'Select at least one CSV file'));
      return;
    }

    try {
      setIsPreviewing(true);
      setError('');

      if (providerId === 'log-sheet-ocr') {
        const controller = new AbortController();
        recognitionAbortRef.current = controller;
        setRecognitionProgress(t('Loading local OCR engine'));
        const availableBabies = await loadExistingBabies();
        const result = await recognizeLogSheetFiles(files, {
          signal: controller.signal,
          onProgress: setRecognitionProgress,
        });
        setLogSheetRows([...result.candidates]);
        setLogSheetPages([...result.pages]);
        setLogSheetBabyId(availableBabies[0]?.id || '');
        setConfiguration(current => ({
          ...current,
          sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }));
        setPreview(null);
        setStep('review');
        return;
      }

      const formData = new FormData();
      formData.set('providerId', providerId);

      files.forEach(file => {
        formData.append('files', file);
      });

      const response = await fetch(
        '/api/import/external/preview',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData,
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            t('Failed to preview import files'),
        );
      }

      const previewResult =
        result.data as ExternalImportPreviewResponse;

      setPreview(previewResult);

      const hasUsableFile =
        previewResult.preview.files.some(
          file => file.status === 'detected',
        );

      const cannotContinue = providerId === 'huckleberry'
        ? !previewResult.preview.ready
        : !hasUsableFile;

      if (cannotContinue) {
        setError(
          t('None of the uploaded files match the selected import provider'),
        );
        return;
      }

      initialiseConfiguration(previewResult);
      await loadExistingBabies();
      setStep('configure');
    } catch (previewError) {
      if ((previewError instanceof DOMException && previewError.name === 'AbortError') ||
        (providerId === 'log-sheet-ocr' && recognitionAbortRef.current?.signal.aborted)) {
        setError('');
        setLogSheetRows([]);
        setLogSheetPages([]);
        setStep('select');
        return;
      }
      setPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : t('Failed to preview import files'),
      );
    } finally {
      recognitionAbortRef.current = null;
      setRecognitionProgress('');
      setIsPreviewing(false);
    }
  };

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={t('Import from another platform')}
      description={t(
        'Import historical data without replacing existing Sprout Track data',
      )}
    >
      <FormPageContent>
        {step === 'select' && (
          <div className="space-y-6">
          {isPreviewing && providerId !== 'log-sheet-ocr' && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 rounded-lg border border-teal-600 bg-teal-950/40 p-4 text-teal-100"
            >
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-slate-100">
                  {t('Analysing import files...')}
                </p>
                <p className="text-sm text-teal-200">
                  {t(
                    'Detecting file types, records, children, units and warnings',
                  )}
                </p>
              </div>
            </div>
          )}

          <section className="rounded-lg border border-slate-600 p-4">
            <h3 className="font-medium text-slate-100">
              {t('Import source')}
            </h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {providerOptions.map(provider => (
                  <button
                  key={provider.id}
                  type="button"
                  aria-pressed={providerId === provider.id}
                  disabled={isPreviewing}
                  onClick={() => {
                    setProviderId(provider.id);
                    setFiles([]);
                    setPreview(null);
                    setLogSheetRows([]);
                    setLogSheetPages([]);
                    setError('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    providerId === provider.id
                      ? 'border-teal-500 bg-teal-950/40'
                      : 'border-slate-600 hover:border-slate-400'
                  }`}
                >
                  <span className="font-medium text-slate-100">
                    {t(provider.name)}
                  </span>
                  <span className="mt-1 block text-sm text-slate-300">
                    {t(provider.description)}
                  </span>
                </button>
              ))}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={providerId === 'log-sheet-ocr' ? 'application/pdf,image/jpeg,image/png,image/webp,image/bmp' : '.csv,text/csv'}
              disabled={isPreviewing}
              multiple={
                providerOptions.find(
                  provider => provider.id === providerId,
                )!.multiple
              }
              onChange={handleFilesSelected}
              className="sr-only"
            />

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                fileInputRef.current?.click()
              }
              className="mt-4"
            >
              <Upload
                className="mr-2 h-4 w-4"
                aria-hidden="true"
              />
              {providerId === 'log-sheet-ocr' ? t('Select photos or PDF') : t('Select CSV files')}
            </Button>

            {providerId === 'log-sheet-ocr' && <p className="mt-3 text-sm text-slate-400">{t('Files stay in this browser and are processed with bundled local OCR. Handwriting recognition is experimental and requires row-by-row review.')}</p>}

            {isPreviewing && providerId === 'log-sheet-ocr' && <div className="mt-3 rounded-md border border-teal-700 p-3 text-sm text-teal-100" role="status" aria-live="polite">{recognitionProgress || t('Processing locally...')} <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => recognitionAbortRef.current?.abort()}>{t('Cancel processing')}</Button></div>}

            {files.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm text-slate-300">
                {files.map(file => (
                  <li key={`${file.name}-${file.size}`}>
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {preview && (
            <section className="rounded-lg border border-slate-600 p-4">
              <h3 className="font-medium text-slate-100">
                {t('Import preview')}
              </h3>

              <p className="mt-1 text-sm text-slate-300">
                {preview.preview.totalRows}{' '}
                {t('records detected')}
              </p>

              <ul className="mt-4 divide-y divide-gray-200">
                {preview.preview.files.map(file => (
                  <li
                    key={file.fileName}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span>{file.fileName}</span>
                    <span>
                      {file.status === 'detected'
                        ? `${file.entityType}: ${file.rowCount}`
                        : file.error || file.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          </div>
        )}

        {step === 'configure' && preview && (
          <ConfigureStep
            preview={preview}
            babies={babies}
            isLoadingBabies={isLoadingBabies}
            configuration={configuration}
            onConfigurationChange={setConfiguration}
          />
        )}

        {step === 'review' && providerId === 'log-sheet-ocr' && (
          <LogSheetReview
            rows={logSheetRows}
            pages={logSheetPages}
            babies={babies}
            babyId={logSheetBabyId}
            timezone={configuration.sourceTimezone}
            onRowsChange={setLogSheetRows}
            onBabyChange={setLogSheetBabyId}
            onTimezoneChange={timezone => {
              setConfiguration(current => ({ ...current, sourceTimezone: timezone }));
              setLogSheetRows(current => current.map(row => row.selected ? { ...row, reviewed: false } : row));
            }}
          />
        )}

        {step === 'review' && providerId !== 'log-sheet-ocr' && preview && (
          <ReviewStep
            preview={preview}
            babies={babies}
            configuration={configuration}
          />
        )}

        {step === 'review' && error && <div role="alert" className="rounded-md border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}

        {step === 'result' && completedResult && (
          <div className="space-y-6">
            <section className="rounded-lg border border-green-700 bg-green-950/40 p-4">
              <h3 className="font-medium text-green-100">
                {t('Import completed')}
              </h3>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-green-100">
                <div>
                  <dt>{t('Created')}</dt>
                  <dd className="font-medium text-slate-100">
                    {completedResult.execution.created}
                  </dd>
                </div>
                <div>
                  <dt>{t('Already imported')}</dt>
                  <dd className="font-medium text-slate-100">
                    {completedResult.execution.duplicates}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </FormPageContent>

      <FormPageFooter>
        {step === 'select' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => isPreviewing && providerId === 'log-sheet-ocr' ? recognitionAbortRef.current?.abort() : onClose()}
              disabled={isPreviewing && providerId !== 'log-sheet-ocr'}
            >
              {isPreviewing && providerId === 'log-sheet-ocr' ? t('Cancel processing') : t('Cancel')}
            </Button>

            <Button
              type="button"
              onClick={handlePreview}
              disabled={
                files.length === 0 ||
                isPreviewing
              }
            >
              {isPreviewing
                ? t('Previewing...')
                : preview
                  ? t('Refresh preview')
                  : t('Preview import')}
            </Button>
          </>
        )}

        {step === 'configure' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError('');
                setStep('select');
              }}
            >
              {t('Back')}
            </Button>

            <Button
              type="button"
              onClick={() => {
                setError('');
                setStep('review');
              }}
              disabled={
                !configuration.sourceTimezone.trim() ||
                Object.values(
                  configuration.childDestinations,
                ).some(
                  destination =>
                    (destination.mode ===
                      'existing' &&
                      !destination.targetBabyId) ||
                    (destination.mode === 'new' &&
                      !destination.gender),
                )
              }
            >
              {t('Continue')}
            </Button>
          </>
        )}

        {step === 'review' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(providerId === 'log-sheet-ocr' ? 'select' : 'configure')}
              disabled={isImporting}
            >
              {t('Back')}
            </Button>

            <Button
              type="button"
              onClick={handleImport}
              disabled={isImporting || (providerId === 'log-sheet-ocr' && (
                !logSheetBabyId ||
                logSheetRows.filter(row => row.selected).length === 0 ||
                logSheetRows.some(row => row.selected && (!row.reviewed || !row.eventKind || !row.date || !row.time || (row.eventKind === 'feeding' && (!row.feedKind || (row.feedKind === 'BOTTLE' && (!row.amount || !row.unit)))) || (row.eventKind === 'diaper' && !row.diaperType)))
              ))}
            >
              {isImporting
                ? t('Importing...')
                : t('Import records')}
            </Button>
          </>
        )}

        {step === 'result' && (
          <Button
            type="button"
            onClick={onClose}
          >
            {t('Close')}
          </Button>
        )}
      </FormPageFooter>
    </FormPage>
  );
}
