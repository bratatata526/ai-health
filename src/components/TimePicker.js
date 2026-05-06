import React, { useState } from 'react';
import { View, Platform, TouchableOpacity } from 'react-native';
import { TextInput, Button, Dialog, Portal, Text } from 'react-native-paper';
import { theme, textStyles, appFontFamilies } from '../theme';
import { parseHHMM } from '../utils/validation';

function clampHour(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(23, Math.round(x)));
}

function clampMinute(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(59, Math.round(x)));
}

function splitHHMM(v) {
  const p = parseHHMM(v);
  if (!p) return { hour: '08', minute: '00' };
  const [h, m] = p.split(':');
  return { hour: h, minute: m };
}

function formatHHMM(hour, minute) {
  return `${String(clampHour(hour)).padStart(2, '0')}:${String(clampMinute(minute)).padStart(2, '0')}`;
}

/**
 * 时间选择（HH:MM）
 * Web：原生 input[type=time]
 * 移动端：对话框输入时、分
 * @param {() => void} [onRemove] 可选：显示在输入框内右侧的删除（×），置于时钟图标右侧
 * @param {boolean} [removeDisabled]
 */
export default function TimePicker({ label, value, onChange, style, onRemove, removeDisabled }) {
  const [dialogVisible, setDialogVisible] = useState(false);
  const [tempHour, setTempHour] = useState('08');
  const [tempMinute, setTempMinute] = useState('00');

  const displayValue = parseHHMM(value) || '';

  const openDialog = () => {
    const { hour, minute } = splitHHMM(value);
    setTempHour(hour);
    setTempMinute(minute);
    setDialogVisible(true);
  };

  const confirmTime = () => {
    const formatted = formatHHMM(tempHour, tempMinute);
    onChange(formatted);
    setDialogVisible(false);
  };

  if (Platform.OS === 'web') {
    const webVal = displayValue || '08:00';
    const showRemove = typeof onRemove === 'function';
    return (
      <View style={style}>
        {label ? (
          <label
            style={{
              display: 'block',
              marginBottom: 4,
              fontSize: '14px',
              color: theme.colors.text,
              fontWeight: '500',
              fontFamily: appFontFamilies.regular,
            }}
          >
            {label}
          </label>
        ) : null}
        <View style={{ position: 'relative', width: '100%' }}>
          <input
            type="time"
            value={webVal}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const normalized = parseHHMM(v);
              if (normalized) onChange(normalized);
            }}
            style={{
              width: '100%',
              padding: '12px',
              paddingRight: showRemove ? 40 : 12,
              border: `1px solid ${theme.colors.outline}`,
              borderRadius: theme.borderRadius.md,
              fontSize: '16px',
              fontFamily: appFontFamilies.regular,
              backgroundColor: '#fff',
              boxSizing: 'border-box',
            }}
          />
          {showRemove ? (
            <button
              type="button"
              disabled={removeDisabled}
              aria-label="删除该时间点"
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!removeDisabled) onRemove();
              }}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'transparent',
                cursor: removeDisabled ? 'not-allowed' : 'pointer',
                opacity: removeDisabled ? 0.35 : 0.75,
                fontSize: 22,
                lineHeight: 1,
                color: theme.colors.textSecondary,
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          ) : null}
        </View>
      </View>
    );
  }

  const rightAdornment = (
    <>
      <TextInput.Icon icon="clock-outline" onPress={openDialog} />
      {typeof onRemove === 'function' ? (
        <TextInput.Icon
          icon="close"
          disabled={removeDisabled}
          onPress={() => {
            if (!removeDisabled) onRemove();
          }}
        />
      ) : null}
    </>
  );

  return (
    <View style={style}>
      <TouchableOpacity onPress={openDialog} activeOpacity={0.7}>
        <TextInput
          label={label || undefined}
          placeholder={label ? undefined : '选择时间'}
          value={displayValue}
          mode="outlined"
          editable={false}
          right={rightAdornment}
        />
      </TouchableOpacity>

      <Portal>
        <Dialog visible={dialogVisible} onDismiss={() => setDialogVisible(false)}>
          <Dialog.Title>选择时间</Dialog.Title>
          <Dialog.Content>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
              <TextInput
                label="时（0-23）"
                value={tempHour}
                onChangeText={(text) => {
                  const d = text.replace(/\D/g, '').slice(0, 2);
                  setTempHour(d);
                }}
                mode="outlined"
                keyboardType="numeric"
                style={{ flex: 1 }}
              />
              <TextInput
                label="分（0-59）"
                value={tempMinute}
                onChangeText={(text) => {
                  const d = text.replace(/\D/g, '').slice(0, 2);
                  setTempMinute(d);
                }}
                mode="outlined"
                keyboardType="numeric"
                style={{ flex: 1 }}
              />
            </View>
            <Text style={[textStyles.body, { fontSize: 12, color: theme.colors.textSecondary }]}>
              将设为 {formatHHMM(tempHour, tempMinute)}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogVisible(false)}>取消</Button>
            <Button mode="contained" onPress={confirmTime}>
              确定
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
