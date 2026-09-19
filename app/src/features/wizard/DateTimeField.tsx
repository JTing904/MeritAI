import { useState } from 'react';
import { Keyboard } from 'react-native';
import { DateFace, type DateTimeFieldProps } from './DateFace';
import { DatePickerSheet } from './DatePickerSheet';

/** A date field on every platform: the face shows the value, tapping it opens the in-app picker sheet. */
export function DateTimeField(props: DateTimeFieldProps) {
  const { value, onChange, tz, mode, min, max, label, placeholder, format, variant, clearLabel, invalid, presets, onChangeZone } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <DateFace
        variant={variant}
        text={value ? format(value) : placeholder}
        empty={!value}
        invalid={invalid}
        focused={open}
        label={label}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        clear={clearLabel ? { label: clearLabel, onPress: () => onChange(null) } : null}
      />
      {/* Rendered while closed too. On the web a modal stacks by when it was first rendered, so a sheet
          rendered after this field (the time-zone list behind 改时区) still opens above the picker. */}
      <DatePickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        value={value}
        onPick={onChange}
        tz={tz}
        mode={mode}
        min={min}
        max={max}
        presets={presets ?? (max ? 'task' : 'project')}
        clearable={!!clearLabel}
        onChangeZone={onChangeZone}
      />
    </>
  );
}
