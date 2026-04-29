import React, { useState } from 'react';
import { View, Platform, TouchableOpacity } from 'react-native';
import { TextInput, Button, Dialog, Portal, Text } from 'react-native-paper';
import { theme, textStyles, appFontFamilies } from '../theme';

/**
 * 日期选择器组件
 * Web端使用原生date input，移动端使用对话框选择
 */
export default function DatePicker({ label, value, onChange, required = false, style, minimumDate, maximumDate }) {
  const [dialogVisible, setDialogVisible] = useState(false);
  const [tempDate, setTempDate] = useState({ year: '', month: '', day: '' });

  // 解析日期字符串为年月日
  const parseDate = (dateStr) => {
    if (!dateStr) return { year: '', month: '', day: '' };
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return { year: match[1], month: match[2], day: match[3] };
    }
    return { year: '', month: '', day: '' };
  };

  // 格式化年月日为日期字符串
  const formatDate = ({ year, month, day }) => {
    if (!year || !month || !day) return '';
    const y = String(year).padStart(4, '0');
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // 获取今天的日期
  const getToday = () => {
    const today = new Date();
    return {
      year: String(today.getFullYear()),
      month: String(today.getMonth() + 1).padStart(2, '0'),
      day: String(today.getDate()).padStart(2, '0'),
    };
  };

  // 计算指定年月的天数
  const getDaysInMonth = (year, month) => {
    if (!year || !month) return 31; // 默认返回31天
    const y = parseInt(year);
    const m = parseInt(month);
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return 31;
    // 使用 Date 对象计算：下个月的第0天就是当前月的最后一天
    return new Date(y, m, 0).getDate();
  };

  // 根据年月调整日期，确保日期不超过当月最大天数
  const adjustDayForMonth = (year, month, day) => {
    if (!year || !month || !day) return day;
    const maxDays = getDaysInMonth(year, month);
    const dayNum = parseInt(day) || 1;
    if (dayNum > maxDays) {
      return String(maxDays).padStart(2, '0');
    }
    return day;
  };

  // 打开对话框
  const openDialog = () => {
    const parsed = parseDate(value);
    if (parsed.year) {
      setTempDate(parsed);
    } else {
      setTempDate(getToday());
    }
    setDialogVisible(true);
  };

  // 确认选择
  const confirmDate = () => {
    const dateStr = formatDate(tempDate);
    if (dateStr) {
      onChange(dateStr);
    }
    setDialogVisible(false);
  };

  // Web端使用原生date input
  if (Platform.OS === 'web') {
    return (
      <View style={style}>
        {label && (
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
            {label} {required && <span style={{ color: theme.colors.error }}>*</span>}
          </label>
        )}
        <input
          type="date"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          min={minimumDate}
          max={maximumDate}
          style={{
            width: '100%',
            padding: '12px',
            border: `1px solid ${theme.colors.outline}`,
            borderRadius: theme.borderRadius.md,
            fontSize: '16px',
            fontFamily: appFontFamilies.regular,
            backgroundColor: '#fff',
            boxSizing: 'border-box',
          }}
        />
      </View>
    );
  }

  // 移动端使用对话框
  return (
    <View style={style}>
      <TouchableOpacity onPress={openDialog}>
        <TextInput
          label={label + (required ? ' *' : '')}
          value={value || ''}
          mode="outlined"
          editable={false}
          right={<TextInput.Icon icon="calendar" />}
        />
      </TouchableOpacity>

      <Portal>
        <Dialog visible={dialogVisible} onDismiss={() => setDialogVisible(false)}>
          <Dialog.Title>选择日期</Dialog.Title>
          <Dialog.Content>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
              <TextInput
                label="年"
                value={tempDate.year}
                onChangeText={(text) => {
                  const newYear = text.replace(/\D/g, '').slice(0, 4);
                  const updated = { ...tempDate, year: newYear };
                  // 当年份改变时，调整日期以适应新的年月组合
                  updated.day = adjustDayForMonth(newYear, updated.month, updated.day);
                  setTempDate(updated);
                }}
                mode="outlined"
                keyboardType="numeric"
                style={{ flex: 1 }}
              />
              <TextInput
                label="月"
                value={tempDate.month}
                onChangeText={(text) => {
                  const month = text.replace(/\D/g, '').slice(0, 2);
                  const num = parseInt(month) || 0;
                  const validMonth = num > 12 ? '12' : num < 1 ? '01' : month.padStart(2, '0');
                  const updated = { ...tempDate, month: validMonth };
                  // 当月份改变时，调整日期以适应新的年月组合
                  updated.day = adjustDayForMonth(updated.year, validMonth, updated.day);
                  setTempDate(updated);
                }}
                mode="outlined"
                keyboardType="numeric"
                style={{ flex: 1 }}
              />
              <TextInput
                label="日"
                value={tempDate.day}
                onChangeText={(text) => {
                  const day = text.replace(/\D/g, '').slice(0, 2);
                  const num = parseInt(day) || 0;
                  const maxDays = getDaysInMonth(tempDate.year, tempDate.month);
                  const validDay = num > maxDays ? String(maxDays).padStart(2, '0') : num < 1 ? '01' : day.padStart(2, '0');
                  setTempDate({ ...tempDate, day: validDay });
                }}
                mode="outlined"
                keyboardType="numeric"
                style={{ flex: 1 }}
                placeholder={`1-${getDaysInMonth(tempDate.year, tempDate.month)}`}
              />
            </View>
            {tempDate.year && tempDate.month && (
            <Text style={[textStyles.body, { fontSize: 12, color: theme.colors.textSecondary, marginTop: -8, marginBottom: theme.spacing.sm }]}>
                {tempDate.year}年{parseInt(tempDate.month)}月共有 {getDaysInMonth(tempDate.year, tempDate.month)} 天
              </Text>
            )}
            <Button
              mode="outlined"
              onPress={() => {
                setTempDate(getToday());
                confirmDate();
              }}
              style={{ marginBottom: theme.spacing.sm }}
            >
              选择今天
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogVisible(false)}>取消</Button>
            <Button mode="contained" onPress={confirmDate}>确定</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
