import React from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { theme } from '../theme';

export default function TongueScreen() {
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>舌苔诊断功能仅支持 Web 端</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <iframe
        src="http://localhost:5173"
        style={styles.iframe}
        title="舌苔诊断"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
  },
  text: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 100,
  },
});
