import { View } from 'react-native';
import { Card } from '@/components/Card';
import { SheetOption } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';
import { goStep, wizardHref } from './nav';
import { fileSort, formatBytes } from './upload';
import { useWizardClose, WizardScreen, WizardTitle } from './WizardScreen';

/**
 * Step 3 when the free rules can't help (CantRead mockup): a photo / scanned PDF (UNREADABLE),
 * or text with neither marks nor a list (NO_STRUCTURE, titled 「这份要求拆不了」).
 */
export function CantReadStep({
  id,
  reason,
  fileName,
  size,
  mime,
}: {
  id: string;
  reason: 'UNREADABLE' | 'NO_STRUCTURE';
  fileName: string | null;
  size: number | null;
  mime: string | null;
}) {
  const { t } = useI18n();
  const w = t.wizard.cantRead;
  const { c } = useTheme();
  const { show } = useToast();
  const close = useWizardClose({ needsConfirm: true, copy: { body: t.wizard.close.bodyDraft } });
  const sort = fileSort(fileName, mime);
  const unreadable = reason === 'UNREADABLE';
  const sortLabel = sort === 'image' ? w.photo : sort === 'pdf' ? w.pdf : w.file;

  return (
    // No 上一步 here (as in the prototype's step 3); Android Back returns to step 2.
    <WizardScreen step={3} onClose={close.requestClose} onHardwareBack={() => goStep(wizardHref.input(id, fileName ? 'upload' : 'text'))}>
      <WizardTitle
        parts={unreadable ? [w.unreadablePre, { hl: 'lemon', text: w.unreadableHl }] : [w.noStructurePre, { hl: 'lemon', text: w.noStructureHl }]}
      />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.hl.sky.tile, alignItems: 'center', justifyContent: 'center' }}
            aria-hidden>
            <Txt v="body" size={19} style={{ lineHeight: 24 }}>
              {fileName ? (sort === 'image' ? '🖼️' : '📄') : '⌨️'}
            </Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt v="rowTitle" numberOfLines={2}>
              {fileName ?? w.typed}
            </Txt>
            {fileName ? <Txt v="meta">{size != null ? `${sortLabel} · ${formatBytes(size)}` : sortLabel}</Txt> : null}
          </View>
        </View>
        <Txt v="text" color="ink2">
          {unreadable ? w.unreadableBody : w.noStructureBody}
        </Txt>
      </Card>
      <View style={{ gap: 10 }}>
        <SheetOption emoji="🔑" title={w.optKey} sub={w.optKeySub} onPress={() => show(w.optKeySoon)} />
        <SheetOption emoji="⌨️" title={w.optText} sub={w.optTextSub} onPress={() => goStep(wizardHref.input(id, 'text'))} />
        <SheetOption emoji="✍️" title={w.optManual} sub={w.optManualSub} onPress={() => goStep(wizardHref.input(id, 'manual'))} />
      </View>
      {close.closeSheet}
    </WizardScreen>
  );
}
